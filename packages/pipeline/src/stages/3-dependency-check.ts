import { PipelineContext, StageResult, Issue } from '../types'
import { createLogger } from '@cslate/logger'
import { getDb } from '@cslate/db'
const log = createLogger('pipeline:dependency-check')
import { components } from '@cslate/db'
import { eq, and, inArray } from 'drizzle-orm'
import npmAllowlist from '../../config/npm-allowlist.json'

interface NpmAllowlist {
  packages: string[]
}

const allowedPackages = new Set((npmAllowlist as NpmAllowlist).packages)

export async function dependencyCheck(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []

  const npmDeps = ctx.manifest.dependencies?.npmPackages ?? {}
  const cslateDeps = ctx.manifest.dependencies?.cslateComponents ?? []
  log.debug({
    uploadId: ctx.uploadId,
    npmDepCount: Object.keys(npmDeps).length,
    cslateDepCount: cslateDeps.length,
  }, 'dependency check start')

  // Check npm packages against allowlist
  for (const pkg of Object.keys(npmDeps)) {
    if (!allowedPackages.has(pkg)) {
      issues.push({
        severity: 'critical',
        message: `npm package not in allowlist: ${pkg}. Submit a request to add it.`,
        pattern: pkg,
      })
    }
  }

  const blockedNpm = issues.filter(i => i.pattern && !i.message.includes('cslate')).map(i => i.pattern)
  log.debug({ uploadId: ctx.uploadId, blockedNpm }, 'npm allowlist check done')

  // Check cslate component dependencies exist in DB
  if (cslateDeps.length > 0) {
    const db = getDb()
    const found = await db.query.components.findMany({
      where: and(
        inArray(components.name, cslateDeps),
        eq(components.revoked, false),
        eq(components.flagged, false),
      ),
      columns: { name: true },
    })

    const foundNames = new Set(found.map(c => c.name))
    for (const dep of cslateDeps) {
      if (!foundNames.has(dep)) {
        issues.push({
          severity: 'critical',
          message: `CSlate component dependency not found or not approved: ${dep}`,
          pattern: dep,
        })
      }
    }
  }

  const criticalIssues = issues.filter(i => i.severity === 'critical')
  log.debug({ uploadId: ctx.uploadId, issueCount: criticalIssues.length, durationMs: Date.now() - start }, 'dependency check done')
  return {
    stage: 'dependency_check',
    status: criticalIssues.length > 0 ? 'failed' : issues.some(i => i.severity === 'warning') ? 'warning' : 'passed',
    duration: Date.now() - start,
    issues: issues.length > 0 ? issues : undefined,
  }
}
