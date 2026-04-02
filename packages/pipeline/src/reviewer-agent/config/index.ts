import { eq } from 'drizzle-orm'
import { reviewerConfig } from '@cslate/db'
import type { Db } from '@cslate/db'
import type { ReviewerConfig } from '../types'
import { DEFAULT_REVIEWER_CONFIG } from '../types'

function mapToRow(config: Partial<ReviewerConfig>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (config.maxConcurrentReviews !== undefined) row.maxConcurrentReviews = config.maxConcurrentReviews
  if (config.maxReviewsPerHour !== undefined) row.maxReviewsPerHour = config.maxReviewsPerHour
  if (config.reviewThrottleSeconds !== undefined) row.reviewThrottleSeconds = config.reviewThrottleSeconds
  if (config.pauseReviews !== undefined) row.pauseReviews = config.pauseReviews
  if (config.maxLLMCostPerDay !== undefined) row.maxLlmCostPerDay = config.maxLLMCostPerDay
  if (config.maxExpertAgentIterations !== undefined) row.maxExpertAgentIterations = config.maxExpertAgentIterations
  if (config.maxRedTeamIterations !== undefined) row.maxRedTeamIterations = config.maxRedTeamIterations
  if (config.maxJudgeIterations !== undefined) row.maxJudgeIterations = config.maxJudgeIterations
  if (config.qualityThreshold !== undefined) row.qualityThreshold = config.qualityThreshold
  if (config.maxWarnings !== undefined) row.maxWarnings = config.maxWarnings
  if (config.modelOverrides !== undefined) row.modelOverrides = config.modelOverrides
  return row
}

export async function getReviewerConfig(db: Db): Promise<ReviewerConfig> {
  const rows = await db.select().from(reviewerConfig).where(eq(reviewerConfig.id, 'default'))
  if (rows.length === 0) return DEFAULT_REVIEWER_CONFIG

  const row = rows[0]!
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
    modelOverrides: (row.modelOverrides as ReviewerConfig['modelOverrides']) ?? DEFAULT_REVIEWER_CONFIG.modelOverrides,
  }
}

export async function updateReviewerConfig(db: Db, updates: Partial<ReviewerConfig>): Promise<ReviewerConfig> {
  await db
    .insert(reviewerConfig)
    .values({ id: 'default', ...mapToRow(updates), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewerConfig.id,
      set: { ...mapToRow(updates), updatedAt: new Date() },
    })
  return getReviewerConfig(db)
}
