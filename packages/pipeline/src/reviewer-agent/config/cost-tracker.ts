import { sum, gte, count } from 'drizzle-orm'
import { reviewCosts } from '@cslate/db'
import type { Db } from '@cslate/db'

const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 },
  'claude-opus-4-6': { input: 0.015, output: 0.075 },
}

export function estimateCost(model: string, tokens: { input: number; output: number }): number {
  const rates = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS['claude-sonnet-4-6']!
  return (tokens.input / 1000) * rates.input + (tokens.output / 1000) * rates.output
}

export async function trackReviewCost(
  db: Db,
  uploadId: string,
  phase: string,
  model: string,
  tokens: { input: number; output: number },
): Promise<void> {
  await db.insert(reviewCosts).values({
    id: crypto.randomUUID(),
    uploadId,
    phase,
    model,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    estimatedCost: estimateCost(model, tokens),
    createdAt: new Date(),
  })
}

export async function getTodayLLMCost(db: Db): Promise<number> {
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)
  const result = await db
    .select({ total: sum(reviewCosts.estimatedCost) })
    .from(reviewCosts)
    .where(gte(reviewCosts.createdAt, todayUtc))
  return Number(result[0]?.total ?? 0)
}

// Counts cost records inserted in the last hour as a proxy for reviews processed.
// Note: this tracks completed review phases, not enqueued jobs. Under heavy load
// where jobs queue faster than they complete, this may undercount active throughput.
// Callers should account for this when using the result to enforce rate limits.
export async function countReviewsInLastHour(db: Db): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 3600 * 1000)
  const result = await db
    .select({ count: count() })
    .from(reviewCosts)
    .where(gte(reviewCosts.createdAt, oneHourAgo))
  return Number(result[0]?.count ?? 0)
}
