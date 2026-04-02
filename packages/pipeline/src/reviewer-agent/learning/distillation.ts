import { gte } from 'drizzle-orm'
import type { Db } from '@cslate/db'
import { reviewOutcomes, reviewerStandards, reviewerKnowledgeVersions } from '@cslate/db'
import type { VerifiedFinding } from '../types'

export async function runDistillation(db: Db, windowDays = 30): Promise<void> {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000)
  const outcomes = await db.select().from(reviewOutcomes).where(gte(reviewOutcomes.createdAt, since))

  // Count how many rejected reviews contain each finding (keyed by dimension:title)
  const candidates = new Map<string, { count: number; dimension: number; title: string; description: string }>()

  for (const outcome of outcomes) {
    if (outcome.verdict !== 'rejected') continue
    const findings = outcome.findings as VerifiedFinding[]
    for (const finding of findings) {
      const key = `${finding.dimension}:${finding.title}`
      const existing = candidates.get(key)
      if (existing) {
        existing.count++
      } else {
        candidates.set(key, {
          count: 1,
          dimension: finding.dimension,
          title: finding.title,
          description: finding.description,
        })
      }
    }
  }

  // Safety rail: minimum 3 confirming reviews before learning a new standard
  for (const candidate of candidates.values()) {
    if (candidate.count < 3) continue

    const id = crypto.randomUUID()
    await db.insert(reviewerStandards).values({
      id,
      dimension: candidate.dimension,
      rule: candidate.title,
      rationale: candidate.description,
      source: 'learned',
      confidence: 50,
    })

    // Every mutation creates a version record
    const versionId = crypto.randomUUID()
    await db.insert(reviewerKnowledgeVersions).values({
      id: versionId,
      version: Date.now(),
      changeType: 'standard_added',
      changeDescription: `Learned from ${candidate.count} rejected reviews: ${candidate.title}`,
    })
  }
}
