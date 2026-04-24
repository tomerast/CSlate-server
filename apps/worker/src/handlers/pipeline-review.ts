import { log } from '../index'
import { getPipelineUploadById, updatePipelineUpload, getPool } from '@cslate/db'
import { getPipelineFiles } from '@cslate/storage'
import { runPipelineReview } from '@cslate/pipeline'
import type { PipelineReviewContext, StageResult, PipelineReviewProgressCallback } from '@cslate/pipeline'
import type { PipelineReviewJobData } from '@cslate/queue'

type Job<T> = { data: T }

export async function pipelineReviewHandler(job: Job<PipelineReviewJobData>): Promise<void> {
  const { uploadId } = job.data
  log.info({ uploadId }, 'Starting pipeline review')

  const upload = await getPipelineUploadById(uploadId)
  if (!upload) {
    log.error({ uploadId }, 'Pipeline upload not found')
    return
  }

  await updatePipelineUpload(uploadId, { status: 'in_progress' })

  // Load files from R2
  let files: Record<string, string>
  try {
    if (!upload.storageKey) {
      throw new Error('Pipeline upload is missing storageKey')
    }
    files = await getPipelineFiles(upload.storageKey)
  } catch (err) {
    log.error({ uploadId, err }, 'Failed to load pipeline files from storage')
    await updatePipelineUpload(uploadId, { status: 'rejected' })
    return
  }

  // Build context — resume from completed stages if retrying
  const completedStages = (upload.completedStages as StageResult[]) ?? []
  const ctx: PipelineReviewContext = {
    uploadId,
    manifest: upload.manifest as PipelineReviewContext['manifest'],
    files,
    previousResults: completedStages,
  }

  try {
    const onProgress: PipelineReviewProgressCallback = async (stage, status, stageResult) => {
      await updatePipelineUpload(uploadId, {
        currentStage: stage,
        completedStages: ctx.previousResults,
      })

      const pool = getPool()
      const notifyPayload = JSON.stringify({
        stage,
        status,
        completedStageCount: ctx.previousResults.length,
        currentResult: stageResult ? {
          stage: stageResult.stage,
          status: stageResult.status,
          duration: stageResult.duration,
          issueCount: stageResult.issues?.length ?? 0,
        } : null,
      })
      const safePayload = notifyPayload.length > 7900 ? JSON.stringify({ stage, status, completedStageCount: ctx.previousResults.length, truncated: true }) : notifyPayload
      await pool.query(
        `SELECT pg_notify($1, $2)`,
        [`upload:${uploadId}`, safePayload],
      )
    }
    const result = await runPipelineReview(ctx, onProgress)

    if (result.status === 'approved') {
      log.info({ uploadId }, 'Pipeline approved')
      // pipeline_id is set by embedding stage
    } else {
      log.info({ uploadId, stages: result.stages.map((s) => s.stage) }, 'Pipeline rejected')
      const rejectionReasons = result.stages
        .filter((s) => s.status === 'failed')
        .map((s) => ({ stage: s.stage, issues: s.issues ?? [] }))

      await updatePipelineUpload(uploadId, {
        status: 'rejected',
        rejectionReasons,
      })

      const pool = getPool()
      await pool.query(
        `SELECT pg_notify($1, $2)`,
        [`upload:${uploadId}`, JSON.stringify({ status: 'rejected', rejectionReasons })],
      )
    }
  } catch (err) {
    log.error({ uploadId, err }, 'Pipeline review threw unexpected error')
    await updatePipelineUpload(uploadId, { status: 'rejected' })

    const pool = getPool()
    await pool.query(
      `SELECT pg_notify($1, $2)`,
      [`upload:${uploadId}`, JSON.stringify({ status: 'rejected', error: String(err) })],
    )

    throw err // Let pg-boss retry
  }
}
