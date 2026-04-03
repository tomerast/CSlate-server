import { PipelineContext, StageResult, Issue } from '../types'
import { callAnthropic, buildSecurityReviewPrompt, SECURITY_REVIEW_SYSTEM } from '@cslate/llm'
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:security-scan')
import securityPatterns from '../../config/security-patterns.json'
import urlAllowlist from '../../config/url-allowlist.json'
import urlBlocklist from '../../config/url-blocklist.json'

interface SecurityPatternsConfig {
  blocked: Array<{ pattern: string; message: string; allowExceptions?: string[] }>
}

interface UrlConfig {
  domains: string[]
}

const patterns = securityPatterns as SecurityPatternsConfig
const allowedDomains = (urlAllowlist as UrlConfig).domains
const blockedPatterns = (urlBlocklist as UrlConfig).domains

export async function securityScan(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []
  log.debug({ uploadId: ctx.uploadId }, 'security scan start')

  // Static pattern scan across all files
  for (const [filename, content] of Object.entries(ctx.files)) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      for (const rule of patterns.blocked) {
        if (line.includes(rule.pattern)) {
          // Check if it's an allowed exception
          const isException = rule.allowExceptions?.some(ex => line.includes(ex)) ?? false
          if (!isException) {
            issues.push({
              severity: 'critical',
              file: filename,
              line: i + 1,
              pattern: rule.pattern,
              message: rule.message,
            })
          }
        }
      }
    }
  }

  const patternHits = issues.filter(i => i.severity === 'critical').length
  log.debug({ uploadId: ctx.uploadId, patternHits }, 'static pattern scan done')

  // URL validation for dataSources
  const flaggedUrls: string[] = []
  for (const ds of ctx.manifest.dataSources ?? []) {
    const url = ds.baseUrl
    const isTier1 = allowedDomains.some(d => url.includes(d))
    const isTier3 = blockedPatterns.some(p => url.includes(p))

    if (isTier3) {
      issues.push({
        severity: 'critical',
        message: `Blocked URL in dataSources: ${url}`,
        pattern: url,
      })
    } else if (!isTier1) {
      flaggedUrls.push(url) // Tier 2: unknown, needs LLM review
    }
  }

  log.debug({ uploadId: ctx.uploadId, flaggedUrlCount: flaggedUrls.length }, 'url validation done')

  // If critical static issues found, fail immediately (skip LLM)
  const staticCritical = issues.filter(i => i.severity === 'critical')
  if (staticCritical.length > 0) {
    return {
      stage: 'security_scan',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }

  // LLM review for obfuscation + flagged URLs
  try {
    const model = process.env.LLM_CATALOG_MODEL ?? 'claude-haiku-4-5-20251001' // Use haiku for speed
    const prompt = buildSecurityReviewPrompt({
      componentName: ctx.manifest.name,
      componentDescription: ctx.manifest.description,
      files: ctx.files,
      flaggedUrls,
    })

    const responseText = await callAnthropic({ model, system: SECURITY_REVIEW_SYSTEM, prompt })
    const response = JSON.parse(responseText) as { verdict: string; issues: Issue[] }
    log.debug({ uploadId: ctx.uploadId, flaggedUrlCount: flaggedUrls.length, llmVerdict: response.verdict, newIssues: response.issues?.length ?? 0 }, 'url llm review done')

    if (response.issues?.length) {
      issues.push(...response.issues)
    }

    const hasCritical = issues.some(i => i.severity === 'critical')
    const criticalCount = issues.filter(i => i.severity === 'critical').length
    log.debug({ uploadId: ctx.uploadId, criticalCount, durationMs: Date.now() - start }, 'security scan done')
    return {
      stage: 'security_scan',
      status: response.verdict === 'fail' || hasCritical ? 'failed' : 'passed',
      duration: Date.now() - start,
      issues: issues.length > 0 ? issues : undefined,
    }
  } catch (err) {
    // LLM parse failure — fail safe (reject)
    issues.push({
      severity: 'critical',
      message: `Security scan LLM error: ${err instanceof Error ? err.message : String(err)}`,
    })
    return {
      stage: 'security_scan',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  }
}
