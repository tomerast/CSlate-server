import type { Job } from 'pg-boss'
import { sql } from 'drizzle-orm'
import { log } from '../index'
import { getUploadById, updateUpload, getPool, getDb } from '@cslate/db'
import { getComponentFiles } from '@cslate/storage'
import { runPipeline, PipelineContext, StageResult } from '@cslate/pipeline'
import type { AgentReviewProgressCallback } from '@cslate/pipeline'
import type { ReviewJobData } from '@cslate/queue'

export async function reviewHandler(job: Job<ReviewJobData>): Promise<void> {
  const { uploadId } = job.data
  log.info({ uploadId }, 'Starting review pipeline')

  const upload = await getUploadById(uploadId)
  if (!upload) {
    log.error({ uploadId }, 'Upload not found')
    return
  }

  // Mark as in_progress
  await updateUpload(uploadId, { status: 'in_progress' })

  // Load files from R2
  let files: Record<string, string>
  try {
    files = await getComponentFiles(upload.storageKey)
  } catch (err) {
    log.error({ uploadId, err }, 'Failed to load component files from storage')
    await updateUpload(uploadId, { status: 'rejected' })
    return
  }

  // Build context — resume from completed stages if retrying
  const completedStages = (upload.completedStages as StageResult[]) ?? []
  const ctx: PipelineContext = {
    uploadId,
    manifest: upload.manifest as PipelineContext['manifest'],
    files,
    previousResults: completedStages,
  }

  // Sub-phase progress streaming for agent_review stage.
  // This callback can be passed directly to agentReview() when calling outside runPipeline.
  const drizzleDb = getDb()
  const agentReviewProgressCallback: AgentReviewProgressCallback = async (progress) => {
    await drizzleDb.execute(sql`SELECT pg_notify('review_progress', ${JSON.stringify({
      uploadId: ctx.uploadId,
      ...progress,
    })})`)
  }

  try {
    const result = await runPipeline(ctx, async (progress) => {
      // Update upload record
      await updateUpload(uploadId, {
        currentStage: progress.stage,
        completedStages: progress.completedStages ?? completedStages,
      })

      // Notify SSE listeners via pg_notify
      const pool = getPool()
      await pool.query(
        `SELECT pg_notify($1, $2)`,
        [`upload:${uploadId}`, JSON.stringify(progress)]
      )
    })

    if (result.status === 'approved') {
      log.info({ uploadId }, 'Component approved')
      // component_id is set by embedding stage's updateUpload call
    } else {
      log.info({ uploadId, stages: result.completedStages.map(s => s.stage) }, 'Component rejected')
      const rejectionReasons = result.completedStages
        .filter(s => s.status === 'failed')
        .map(s => ({ stage: s.stage, issues: s.issues ?? [] }))

      await updateUpload(uploadId, {
        status: 'rejected',
        rejectionReasons,
      })

      // Notify final status
      const pool = getPool()
      await pool.query(
        `SELECT pg_notify($1, $2)`,
        [`upload:${uploadId}`, JSON.stringify({ status: 'rejected', rejectionReasons })]
      )
    }
  } catch (err) {
    log.error({ uploadId, err }, 'Pipeline threw unexpected error')
    await updateUpload(uploadId, { status: 'rejected' })

    const pool = getPool()
    await pool.query(
      `SELECT pg_notify($1, $2)`,
      [`upload:${uploadId}`, JSON.stringify({ status: 'rejected', error: String(err) })]
    )

    throw err // Let pg-boss retry
  }
}
