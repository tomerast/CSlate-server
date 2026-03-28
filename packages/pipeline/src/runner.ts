import { PipelineContext, PipelineResult, StageResult, ProgressCallback } from './types'
import { manifestValidation } from './stages/1-manifest-validation'
import { securityScan } from './stages/2-security-scan'
import { dependencyCheck } from './stages/3-dependency-check'
import { qualityReview } from './stages/4-quality-review'
import { testRender } from './stages/5-test-render'
import { cataloging } from './stages/6-cataloging'
import { embeddingAndStore } from './stages/7-embedding'

const STAGES = [
  { name: 'manifest_validation', fn: manifestValidation },
  { name: 'security_scan', fn: securityScan },
  { name: 'dependency_check', fn: dependencyCheck },
  { name: 'quality_review', fn: qualityReview },
  { name: 'test_render', fn: testRender },
  { name: 'cataloging', fn: cataloging },
  { name: 'embedding', fn: embeddingAndStore },
]

export async function runPipeline(
  ctx: PipelineContext,
  onProgress: ProgressCallback
): Promise<PipelineResult> {
  // Smart retry: skip already-completed stages
  const completedStageNames = new Set(ctx.previousResults.map(r => r.stage))

  for (const stage of STAGES) {
    if (completedStageNames.has(stage.name)) continue

    await onProgress({ stage: stage.name, status: 'in_progress' })

    const result = await stage.fn(ctx)
    ctx.previousResults.push(result)

    await onProgress({
      stage: stage.name,
      status: result.status === 'failed' ? 'failed' : 'complete',
      result,
      completedStages: ctx.previousResults,
    })

    if (result.status === 'failed') {
      return {
        status: 'rejected',
        completedStages: ctx.previousResults,
      }
    }
  }

  return {
    status: 'approved',
    completedStages: ctx.previousResults,
  }
}
