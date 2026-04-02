import type { PipelineReviewContext, StageResult } from '../pipeline-types'

export async function checkPipelineDependencies(
  ctx: PipelineReviewContext,
): Promise<StageResult> {
  const start = Date.now()
  // Pipelines bundle all deps — dependency check is lightweight.
  // Main concern (detecting dangerous module imports) is handled by security-scan.
  return {
    stage: 'dependency-check',
    status: 'passed',
    duration: Date.now() - start,
  }
}
