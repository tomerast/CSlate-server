import { PipelineContext, StageResult, Issue } from '../types'
import { callAnthropic, buildQualityReviewPrompt, QUALITY_REVIEW_SYSTEM } from '@cslate/llm'
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:quality-review')

const TAILWIND_COLOR_REGEX = /\b(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g

export async function qualityReview(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []
  log.debug({ uploadId: ctx.uploadId }, 'quality review start')

  // Static pre-check: Tailwind raw color utilities
  for (const [filename, content] of Object.entries(ctx.files)) {
    if (!filename.endsWith('.tsx') && !filename.endsWith('.ts')) continue
    const matches = content.match(TAILWIND_COLOR_REGEX)
    if (matches) {
      const unique = [...new Set(matches)]
      issues.push({
        severity: 'critical',
        file: filename,
        pattern: 'STYLING_TOKEN_VIOLATION',
        message: `Component uses raw color utilities instead of semantic design tokens: ${unique.join(', ')}. Use bg-primary, text-muted, border-border etc. — not bg-blue-500, text-gray-900.`,
        fix: 'Replace raw color utilities with semantic design tokens from your Tailwind config.',
      })
    }
  }

  const tokenViolations = issues.filter(i => i.pattern === 'STYLING_TOKEN_VIOLATION').length
  log.debug({ uploadId: ctx.uploadId, tokenViolations }, 'tailwind token scan done')

  // Hard reject if token violation found — no need for LLM
  if (issues.length > 0) {
    return {
      stage: 'quality_review',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }

  // LLM quality review
  try {
    const model = process.env.LLM_QUALITY_MODEL ?? 'claude-sonnet-4-6'
    const prompt = buildQualityReviewPrompt({
      componentName: ctx.manifest.name,
      manifest: ctx.manifest as Record<string, unknown>,
      files: ctx.files,
    })

    const responseText = await callAnthropic({ model, system: QUALITY_REVIEW_SYSTEM, prompt })
    const response = JSON.parse(responseText) as { verdict: string; issues: Issue[] }
    log.debug({ uploadId: ctx.uploadId, model, verdict: response.verdict, newIssues: response.issues?.length ?? 0 }, 'quality llm review done')

    if (response.issues?.length) {
      issues.push(...response.issues)
    }

    const hasCritical = issues.some(i => i.severity === 'critical')
    log.debug({ uploadId: ctx.uploadId, criticalCount: issues.filter(i => i.severity === 'critical').length, durationMs: Date.now() - start }, 'quality review done')
    return {
      stage: 'quality_review',
      status: response.verdict === 'fail' || hasCritical ? 'failed' : response.verdict === 'warning' ? 'warning' : 'passed',
      duration: Date.now() - start,
      issues: issues.length > 0 ? issues : undefined,
    }
  } catch (err) {
    issues.push({
      severity: 'critical',
      message: `Quality review LLM error: ${err instanceof Error ? err.message : String(err)}`,
    })
    return {
      stage: 'quality_review',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }
}
