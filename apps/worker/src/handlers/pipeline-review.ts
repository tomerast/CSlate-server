import type { Job } from 'pg-boss'
import { log } from '../index'
import { getUploadById, updateUpload, getPool } from '@cslate/db'
import { getComponentFiles } from '@cslate/storage'
import { runPipelineReview } from '@cslate/pipeline'
import type { PipelineReviewContext, StageResult, PipelineReviewProgressCallback } from '@cslate/pipeline'
import type { PipelineReviewJobData } from '@cslate/queue'

export async function pipelineReviewHandler(job: Job<PipelineReviewJobData>): Promise<void> {
  const { uploadId } = job.data
  log.info({ uploadId }, 'Starting pipeline review')

  const upload = await getUploadById(uploadId)
  if (!upload) {
    log.error({ uploadId }, 'Upload not found')
    return
  }

  await updateUpload(uploadId, { status: 'in_progress' })

  // Load files from R2
  let files: Record<string, string>
  try {
    files = await getComponentFiles(upload.storageKey)
  } catch (err) {
    log.error({ uploadId, err }, 'Failed to load pipeline files from storage')
    await updateUpload(uploadId, { status: 'rejected' })
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
      await updateUpload(uploadId, {
        currentStage: stage,
        completedStages: ctx.previousResults,
      })

      const pool = getPool()
      await pool.query(
        `SELECT pg_notify($1, $2)`,
        [
          `upload:${uploadId}`,
          JSON.stringify({ stage, status, result: stageResult, completedStages: ctx.previousResults }),
        ],
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

      await updateUpload(uploadId, {
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
    await updateUpload(uploadId, { status: 'rejected' })

    const pool = getPool()
    await pool.query(
      `SELECT pg_notify($1, $2)`,
      [`upload:${uploadId}`, JSON.stringify({ status: 'rejected', error: String(err) })],
    )

    throw err // Let pg-boss retry
  }
}
