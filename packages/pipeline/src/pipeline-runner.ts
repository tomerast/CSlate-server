import type { PipelineReviewContext, StageResult } from './pipeline-types'
import { validatePipelineManifest } from './pipeline-stages/1-manifest-validation'
import { checkPipelineDependencies } from './pipeline-stages/3-dependency-check'
import { catalogPipeline } from './pipeline-stages/5-cataloging'
import { embedAndStorePipeline } from './pipeline-stages/6-embedding'
import { agentReview } from './reviewer-agent'

export type PipelineReviewProgressCallback = (
  stage: string,
  status: 'in_progress' | 'complete' | 'failed',
  result?: StageResult,
) => Promise<void>

export async function runPipelineReview(
  ctx: PipelineReviewContext,
  onProgress: PipelineReviewProgressCallback,
): Promise<{ status: 'approved' | 'rejected'; stages: StageResult[] }> {
  const completedStageNames = new Set(ctx.previousResults.map((r) => r.stage))
  // Backward compatibility: old stage names count as agent_review already done
  if (completedStageNames.has('security-scan') || completedStageNames.has('quality-review')) {
    completedStageNames.add('agent-review')
  }

  const stages = [
    { name: 'manifest-validation', fn: () => validatePipelineManifest(ctx) },
    { name: 'dependency-check', fn: () => checkPipelineDependencies(ctx) },
    { name: 'agent-review', fn: () => agentReview(ctx as unknown as import('./types').PipelineContext) },
    { name: 'cataloging', fn: () => catalogPipeline(ctx) },
    { name: 'embedding-store', fn: () => embedAndStorePipeline(ctx) },
  ]

  for (const stage of stages) {
    if (completedStageNames.has(stage.name)) continue

    await onProgress(stage.name, 'in_progress')

    const result = await stage.fn()
    ctx.previousResults.push(result)

    await onProgress(
      stage.name,
      result.status === 'failed' ? 'failed' : 'complete',
      result,
    )

    if (result.status === 'failed') {
      return { status: 'rejected', stages: ctx.previousResults }
    }
  }

  return { status: 'approved', stages: ctx.previousResults }
}
