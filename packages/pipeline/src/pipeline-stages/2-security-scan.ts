import { callAnthropic } from '@cslate/llm'
import type { PipelineReviewContext, StageResult, Issue } from '../pipeline-types'

const BLOCKED_PATTERNS = [
  { pattern: /eval\s*\(/, message: 'eval() is not allowed', severity: 'critical' as const },
  { pattern: /child_process/, message: 'child_process is not allowed', severity: 'critical' as const },
  { pattern: /fs\.writeFileSync|fs\.appendFileSync/, message: 'Synchronous file writes not allowed', severity: 'critical' as const },
  { pattern: /fs\.rmSync|fs\.unlinkSync/, message: 'File deletion not allowed', severity: 'critical' as const },
  { pattern: /process\.env/, message: 'Direct env access not allowed — use getSecret()', severity: 'critical' as const },
  { pattern: /require\s*\(\s*['"]child_process['"]/, message: 'child_process import not allowed', severity: 'critical' as const },
  { pattern: /require\s*\(\s*['"]cluster['"]/, message: 'cluster module not allowed', severity: 'critical' as const },
  { pattern: /\.exec\s*\(/, message: 'shell exec not allowed', severity: 'warning' as const },
]

const SECRET_VALUE_PATTERNS = [
  { pattern: /['"]sk-[a-zA-Z0-9]{32,}['"]/, message: 'Possible hardcoded API key detected' },
  { pattern: /['"][a-f0-9]{64}['"]/, message: 'Possible hardcoded secret hash detected' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/, message: 'Possible hardcoded bearer token' },
]

const PIPELINE_SECURITY_SYSTEM = `You are a security auditor reviewing data pipeline TypeScript code.

Your job is to identify CRITICAL security issues only. Focus on:
1. Obfuscation: string concatenation building dynamic calls, base64-encoded payloads
2. Data exfiltration disguised as normal pipeline logic
3. Hardcoded credentials not caught by static analysis
4. Intent mismatch: pipeline code that doesn't match its stated purpose

Respond with JSON only:
{
  "verdict": "pass" | "fail",
  "issues": [
    {
      "severity": "critical",
      "file": "filename",
      "line": 42,
      "pattern": "the suspicious code",
      "message": "explanation",
      "fix": "suggested fix"
    }
  ]
}

If no issues found: { "verdict": "pass", "issues": [] }`

export async function scanPipelineSecurity(
  ctx: PipelineReviewContext,
): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []

  for (const [filename, content] of Object.entries(ctx.files)) {
    if (!filename.endsWith('.ts') && !filename.endsWith('.js')) continue

    const lines = content.split('\n')

    for (const { pattern, message, severity } of BLOCKED_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i] ?? '')) {
          issues.push({
            severity,
            file: filename,
            line: i + 1,
            pattern: pattern.source,
            message,
          })
        }
      }
    }

    for (const { pattern, message } of SECRET_VALUE_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i] ?? '')) {
          issues.push({
            severity: 'critical',
            file: filename,
            line: i + 1,
            pattern: pattern.source,
            message,
          })
        }
      }
    }
  }

  // Fail fast on static critical issues — skip LLM
  if (issues.some((i) => i.severity === 'critical')) {
    return {
      stage: 'security-scan',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }

  // LLM review for obfuscation detection
  try {
    const model = process.env.LLM_CATALOG_MODEL ?? 'claude-haiku-4-5-20251001'
    const fileContents = Object.entries(ctx.files)
      .filter(([n]) => n.endsWith('.ts') || n.endsWith('.js'))
      .map(([n, c]) => `\`\`\`${n}\n${c}\n\`\`\``)
      .join('\n\n')

    const prompt = `Pipeline: "${ctx.manifest.name}"
Description: "${ctx.manifest.description}"

Files:
${fileContents}

Review this pipeline for security issues.`

    const responseText = await callAnthropic({ model, system: PIPELINE_SECURITY_SYSTEM, prompt })
    const response = JSON.parse(responseText) as { verdict: string; issues: Issue[] }

    if (response.issues?.length) {
      issues.push(...response.issues)
    }

    const hasCritical = issues.some((i) => i.severity === 'critical')
    return {
      stage: 'security-scan',
      status: response.verdict === 'fail' || hasCritical ? 'failed' : 'passed',
      duration: Date.now() - start,
      issues: issues.length > 0 ? issues : undefined,
    }
  } catch (err) {
    issues.push({
      severity: 'critical',
      message: `Security scan LLM error: ${err instanceof Error ? err.message : String(err)}`,
    })
    return {
      stage: 'security-scan',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }
}
