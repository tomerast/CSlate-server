import { isNull, desc, max } from 'drizzle-orm'
import type { Db } from '@cslate/db'
import {
  reviewerStandards,
  reviewerPatterns,
  reviewerDimensionWeights,
  reviewerKnowledgeVersions,
  type ReviewerStandard,
  type ReviewerPattern,
  type ReviewerDimensionWeight,
} from '@cslate/db'
import type {
  ReviewerKnowledgeBase,
  LearnedStandard,
  PatternEntry,
  DimensionWeight,
  CodeExample,
} from '../types'

export { injectKnowledge } from './knowledge-injector'
export { recordReviewOutcome } from './outcome-recorder'
export { runDistillation } from './distillation'

function mapStandard(row: ReviewerStandard): LearnedStandard {
  return {
    id: row.id,
    dimension: row.dimension,
    rule: row.rule,
    rationale: row.rationale,
    examples: {
      good: (row.examplesGood as CodeExample[]) ?? [],
      bad: (row.examplesBad as CodeExample[]) ?? [],
    },
    source: row.source as 'manual' | 'learned',
    confidence: row.confidence ?? 50,
    createdAt: row.createdAt ?? new Date(),
    lastConfirmedAt: row.lastConfirmedAt ?? new Date(),
  }
}

function mapPattern(row: ReviewerPattern): PatternEntry {
  return {
    id: row.id,
    type: row.type as 'approved' | 'rejected' | 'suspicious',
    patternDesc: row.patternDesc,
    regex: row.regex ?? undefined,
    dimension: row.dimension,
    occurrences: row.occurrences,
    lastSeen: row.lastSeen,
    examples: (row.examples as CodeExample[]) ?? [],
  }
}

function deduplicateWeights(rows: ReviewerDimensionWeight[]): DimensionWeight[] {
  const seen = new Set<number>()
  const result: DimensionWeight[] = []
  for (const row of rows) {
    if (seen.has(row.dimension)) continue
    seen.add(row.dimension)
    result.push({
      dimension: row.dimension,
      weight: row.weight,
      strictnessLevel: row.strictnessLevel as DimensionWeight['strictnessLevel'],
      adjustedAt: row.adjustedAt,
      reason: row.reason,
    })
  }
  return result
}

export async function loadKnowledgeBase(db: Db): Promise<ReviewerKnowledgeBase> {
  const [standards, patterns, weights, versionRow] = await Promise.all([
    db.select().from(reviewerStandards).where(isNull(reviewerStandards.retiredAt)),
    db.select().from(reviewerPatterns),
    db.select().from(reviewerDimensionWeights).orderBy(desc(reviewerDimensionWeights.adjustedAt)),
    db.select({ version: max(reviewerKnowledgeVersions.version) }).from(reviewerKnowledgeVersions),
  ])

  return {
    version: versionRow[0]?.version ?? 0,
    updatedAt: new Date(),
    codeStandards: standards.map(mapStandard),
    patternLibrary: patterns.map(mapPattern),
    dimensionWeights: deduplicateWeights(weights),
  }
}
