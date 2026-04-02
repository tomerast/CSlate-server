import { callAnthropic } from '@cslate/llm'
import type { PipelineReviewContext, StageResult, Issue } from '../pipeline-types'

const PIPELINE_QUALITY_SYSTEM = `You are a senior TypeScript code reviewer for a data pipeline library.

Review the pipeline code for quality issues. Focus on:
1. Error handling: Does execute() handle API failures gracefully?
2. Secret usage: Are secrets accessed via getSecret(), never hardcoded?
3. Output format: Does it return proper PipelineOutput with data + metadata?
4. Resource cleanup: If stream() is implemented, does dispose() clean up?
5. Rate limiting: Does it respect API rate limits?
6. Input validation: Does it validate params before use?
7. Type safety: Are types explicit, no unnecessary 'any'?

Respond with JSON only:
{
  "verdict": "pass" | "fail" | "warning",
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "file": "filename",
      "line": 42,
      "message": "explanation",
      "fix": "suggested fix"
    }
  ]
}

A "fail" verdict means the pipeline cannot be approved. "warning" means minor issues that don't block approval.`

export async function reviewPipelineQuality(
  ctx: PipelineReviewContext,
): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []

  try {
    const model = process.env.LLM_QUALITY_MODEL ?? 'claude-sonnet-4-6'

    const fileContents = Object.entries(ctx.files)
      .filter(([name]) => name.endsWith('.ts') || name.endsWith('.js'))
      .map(([name, content]) => `\`\`\`${name}\n${content}\n\`\`\``)
      .join('\n\n')

    const prompt = `Pipeline: "${ctx.manifest.name}"

Manifest (declared contract):
\`\`\`json
${JSON.stringify(ctx.manifest, null, 2)}
\`\`\`

Files:
${fileContents}

Review this pipeline for code quality.`

    const responseText = await callAnthropic({ model, system: PIPELINE_QUALITY_SYSTEM, prompt })
    const response = JSON.parse(responseText) as { verdict: string; issues: Issue[] }

    if (response.issues?.length) {
      issues.push(...response.issues)
    }

    const hasCritical = issues.some((i) => i.severity === 'critical')
    return {
      stage: 'quality-review',
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
      stage: 'quality-review',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }
}
