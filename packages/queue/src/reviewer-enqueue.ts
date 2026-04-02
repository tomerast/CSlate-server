import { getBoss } from './client'
import { JOB_NAMES } from './jobs'

/**
 * Minimal subset of ReviewerConfig fields needed for rate-limiting decisions.
 * Mirrors ReviewerConfig from @cslate/pipeline without creating a circular dependency.
 */
interface ReviewLimitsConfig {
  pauseReviews: boolean
  maxReviewsPerHour: number
  maxLLMCostPerDay: number
  reviewThrottleSeconds: number
}

/**
 * Enqueue a review job with cost-control guardrails applied:
 *  1. Kill switch — throws if pauseReviews is true
 *  2. Hourly rate cap — defers to next slot if over limit
 *  3. Daily cost cap — defers to tomorrow UTC midnight if over daily budget
 *  4. Throttled enqueue — otherwise sends with per-second throttle
 *
 * @param data        Job payload containing the upload ID
 * @param config      Reviewer config with rate/cost limits
 * @param recentCount Number of reviews tracked in the last hour
 * @param todayCost   Total estimated LLM cost accrued today (UTC)
 * @returns           pg-boss job ID, or null if throttle deduplicated the send
 */
export async function enqueueReviewWithLimits(
  data: { uploadId: string },
  config: ReviewLimitsConfig,
  recentCount: number,
  todayCost: number,
): Promise<string | null> {
  const boss = await getBoss()

  // 1. Kill switch
  if (config.pauseReviews) {
    throw new Error('Reviews are paused by admin')
  }

  // 2. Hourly rate limit — defer to next available slot
  if (recentCount >= config.maxReviewsPerHour) {
    const delaySeconds = Math.ceil(3600 / config.maxReviewsPerHour)
    return boss.send(JOB_NAMES.REVIEW_COMPONENT, data, { startAfter: delaySeconds })
  }

  // 3. Daily cost cap — defer to tomorrow midnight UTC
  if (todayCost >= config.maxLLMCostPerDay) {
    const now = new Date()
    const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    const delaySeconds = Math.ceil((tomorrowUtc.getTime() - now.getTime()) / 1000)
    return boss.send(JOB_NAMES.REVIEW_COMPONENT, data, { startAfter: delaySeconds })
  }

  // 4. Throttled enqueue
  return boss.sendThrottled(JOB_NAMES.REVIEW_COMPONENT, data, {}, config.reviewThrottleSeconds)
}
