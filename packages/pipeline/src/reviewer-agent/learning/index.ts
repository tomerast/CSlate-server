import { isNull } from 'drizzle-orm'
import type { Db } from '@cslate/db'
import { reviewerStandards, reviewerPatterns, reviewerDimensionWeights } from '@cslate/db'
import type { ReviewVerdict, ReviewerKnowledgeBase, LearnedStandard, PatternEntry, DimensionWeight } from '../types'
import { recordReviewOutcome as persistOutcome } from './outcome-recorder'

export async function loadKnowledgeBase(db: Db): Promise<ReviewerKnowledgeBase> {
  const [standardRows, patternRows, weightRows] = await Promise.all([
    db.select().from(reviewerStandards).where(isNull(reviewerStandards.retiredAt)),
    db.select().from(reviewerPatterns),
    db.select().from(reviewerDimensionWeights),
  ])

  const codeStandards: LearnedStandard[] = standardRows.map(r => ({
    id: r.id,
    dimension: r.dimension,
    rule: r.rule,
    rationale: r.rationale,
    examples: {
      good: (r.examplesGood as Array<{ code: string; explanation?: string }>) ?? [],
      bad: (r.examplesBad as Array<{ code: string; explanation?: string }>) ?? [],
    },
    source: r.source as 'manual' | 'learned',
    confidence: r.confidence ?? 50,
  }))

  const patternLibrary: PatternEntry[] = patternRows.map(r => ({
    id: r.id,
    type: r.type as 'approved' | 'rejected' | 'suspicious',
    patternDesc: r.patternDesc,
    regex: r.regex ?? undefined,
    dimension: r.dimension,
    occurrences: r.occurrences,
    lastSeen: r.lastSeen,
    examples: (r.examples as Array<{ code: string; explanation?: string }>) ?? [],
  }))

  const dimensionWeights: DimensionWeight[] = weightRows.map(r => ({
    dimension: r.dimension,
    weight: r.weight,
    strictnessLevel: r.strictnessLevel as 'lenient' | 'standard' | 'strict' | 'paranoid',
    adjustedAt: r.adjustedAt,
    reason: r.reason,
  }))

  const latestUpdate = [...standardRows, ...patternRows]
    .map(r => ('createdAt' in r && r.createdAt ? r.createdAt : new Date(0)))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date()

  return {
    version: codeStandards.length + patternLibrary.length + dimensionWeights.length,
    updatedAt: latestUpdate,
    codeStandards,
    patternLibrary,
    dimensionWeights,
  }
}

export async function recordReviewOutcome(
  db: Db,
  verdict: ReviewVerdict,
  uploadId: string,
): Promise<void> {
  await persistOutcome(db, verdict, uploadId)
}
