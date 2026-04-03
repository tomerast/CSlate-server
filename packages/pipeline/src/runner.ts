import { createLogger } from '@cslate/logger'
import { PipelineContext, PipelineResult, StageResult, ProgressCallback } from './types'
import { manifestValidation } from './stages/1-manifest-validation'
import { securityScan } from './stages/2-security-scan'
import { dependencyCheck } from './stages/3-dependency-check'
import { qualityReview } from './stages/4-quality-review'
import { testRender } from './stages/5-test-render'
import { cataloging } from './stages/6-cataloging'
import { embeddingAndStore } from './stages/7-embedding'
import { agentReview } from './reviewer-agent'

const log = createLogger('pipeline:runner')

const STAGES = [
  { name: 'manifest_validation', fn: manifestValidation },
  { name: 'dependency_check', fn: dependencyCheck },
  { name: 'agent_review', fn: agentReview },
  { name: 'cataloging', fn: cataloging },
  { name: 'embedding', fn: embeddingAndStore },
]

export async function runPipeline(
  ctx: PipelineContext,
  onProgress: ProgressCallback
): Promise<PipelineResult> {
  const pipelineStart = Date.now()

  // Smart retry: skip already-completed stages
  const completedStageNames = new Set(ctx.previousResults.map(r => r.stage))
  // Backward compatibility: old stage names count as agent_review already done
  if (completedStageNames.has('security_scan') || completedStageNames.has('quality_review')) {
    completedStageNames.add('agent_review')
  }

  const skipped = [...completedStageNames]
  const toRun = STAGES.filter(s => !completedStageNames.has(s.name)).map(s => s.name)
  log.info({ uploadId: ctx.uploadId, toRun, skipped }, 'pipeline start')

  for (const stage of STAGES) {
    if (completedStageNames.has(stage.name)) {
      log.debug({ uploadId: ctx.uploadId, stage: stage.name }, 'stage skipped (already complete)')
      continue
    }

    log.debug({ uploadId: ctx.uploadId, stage: stage.name }, 'stage start')
    await onProgress({ stage: stage.name, status: 'in_progress' })

    const result = await stage.fn(ctx)
    ctx.previousResults.push(result)

    log.debug({
      uploadId: ctx.uploadId,
      stage: stage.name,
      status: result.status,
      durationMs: result.duration,
      issueCount: result.issues?.length ?? 0,
    }, 'stage done')

    await onProgress({
      stage: stage.name,
      status: result.status === 'failed' ? 'failed' : 'complete',
      result,
      completedStages: ctx.previousResults,
    })

    if (result.status === 'failed') {
      const failedIssues = result.issues?.map(i => i.message) ?? []
      log.warn({ uploadId: ctx.uploadId, stage: stage.name, issues: failedIssues }, 'stage failed — pipeline rejected')
      log.info({ uploadId: ctx.uploadId, status: 'rejected', totalDurationMs: Date.now() - pipelineStart }, 'pipeline done')
      return {
        status: 'rejected',
        completedStages: ctx.previousResults,
      }
    }
  }

  log.info({ uploadId: ctx.uploadId, status: 'approved', totalDurationMs: Date.now() - pipelineStart }, 'pipeline done')
  return {
    status: 'approved',
    completedStages: ctx.previousResults,
  }
}
