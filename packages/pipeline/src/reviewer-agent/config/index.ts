import { eq } from 'drizzle-orm'
import type { Db } from '@cslate/db'
import { reviewerConfig } from '@cslate/db'
import { type ReviewerConfig, DEFAULT_REVIEWER_CONFIG } from '../types'

export async function getReviewerConfig(db: Db): Promise<ReviewerConfig> {
  const rows = await db.select().from(reviewerConfig).where(eq(reviewerConfig.id, 'default'))
  if (rows.length === 0 || !rows[0]) return { ...DEFAULT_REVIEWER_CONFIG }

  const row = rows[0]
  return {
    maxConcurrentReviews: row.maxConcurrentReviews ?? DEFAULT_REVIEWER_CONFIG.maxConcurrentReviews,
    maxReviewsPerHour: row.maxReviewsPerHour ?? DEFAULT_REVIEWER_CONFIG.maxReviewsPerHour,
    reviewThrottleSeconds: row.reviewThrottleSeconds ?? DEFAULT_REVIEWER_CONFIG.reviewThrottleSeconds,
    pauseReviews: row.pauseReviews ?? DEFAULT_REVIEWER_CONFIG.pauseReviews,
    maxLLMCostPerDay: row.maxLlmCostPerDay ?? DEFAULT_REVIEWER_CONFIG.maxLLMCostPerDay,
    maxExpertAgentIterations: row.maxExpertAgentIterations ?? DEFAULT_REVIEWER_CONFIG.maxExpertAgentIterations,
    maxRedTeamIterations: row.maxRedTeamIterations ?? DEFAULT_REVIEWER_CONFIG.maxRedTeamIterations,
    maxJudgeIterations: row.maxJudgeIterations ?? DEFAULT_REVIEWER_CONFIG.maxJudgeIterations,
    qualityThreshold: row.qualityThreshold ?? DEFAULT_REVIEWER_CONFIG.qualityThreshold,
    maxWarnings: row.maxWarnings ?? DEFAULT_REVIEWER_CONFIG.maxWarnings,
    tierWeights: DEFAULT_REVIEWER_CONFIG.tierWeights,
    modelOverrides: (row.modelOverrides as ReviewerConfig['modelOverrides']) ?? DEFAULT_REVIEWER_CONFIG.modelOverrides,
  }
}

export async function updateReviewerConfig(db: Db, updates: Partial<ReviewerConfig>): Promise<ReviewerConfig> {
  await db
    .insert(reviewerConfig)
    .values({ id: 'default', ...updates, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewerConfig.id,
      set: { ...updates, updatedAt: new Date() },
    })
  return getReviewerConfig(db)
}
