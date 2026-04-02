import { PipelineManifestSchema } from '../pipeline-types'
import type { PipelineReviewContext, StageResult, Issue } from '../pipeline-types'

export async function validatePipelineManifest(
  ctx: PipelineReviewContext,
): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []

  // 1. Validate manifest schema
  const result = PipelineManifestSchema.safeParse(ctx.manifest)
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        severity: 'critical',
        message: `${issue.path.join('.')}: ${issue.message}`,
      })
    }
    return {
      stage: 'manifest-validation',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }

  // 2. Verify pipeline.ts entry point exists
  if (!('pipeline.ts' in ctx.files)) {
    issues.push({
      severity: 'critical',
      file: 'pipeline.ts',
      message: 'pipeline.ts is required — it is the pipeline entry point',
    })
  }

  // 3. Verify all declared files are uploaded
  for (const declaredFile of ctx.manifest.files) {
    if (!(declaredFile in ctx.files) && declaredFile !== 'manifest.json') {
      issues.push({
        severity: 'warning',
        file: declaredFile,
        message: `Declared file "${declaredFile}" not found in upload`,
      })
    }
  }

  // 4. Check context.md length if present
  if (ctx.files['context.md'] && ctx.files['context.md'].length > 2000) {
    issues.push({
      severity: 'warning',
      file: 'context.md',
      message: 'context.md exceeds 2000 characters',
    })
  }

  // 5. Verify secret names don't look like actual values
  for (const [name] of Object.entries(ctx.manifest.secrets)) {
    if (name.length > 50 || name.includes('=') || name.includes(':')) {
      issues.push({
        severity: 'critical',
        message: `Secret name "${name}" looks like a value — secret names should be identifiers, not values`,
      })
    }
  }

  const hasCritical = issues.some((i) => i.severity === 'critical')
  return {
    stage: 'manifest-validation',
    status: hasCritical ? 'failed' : issues.length > 0 ? 'warning' : 'passed',
    duration: Date.now() - start,
    issues: issues.length > 0 ? issues : undefined,
  }
}
