import { gte, sum, count, sql } from 'drizzle-orm'
import type { Db } from '@cslate/db'
import { reviewCosts } from '@cslate/db'

// Cost per 1M tokens (input/output) by model
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'moonshotai/kimi-k2.6': { input: 0.5, output: 2.0 },
}

const DEFAULT_COST = { input: 3.0, output: 15.0 } // default to sonnet pricing

export function estimateCost(
  model: string,
  tokens: { input: number; output: number },
): number {
  const rates = MODEL_COSTS[model] ?? DEFAULT_COST
  return (tokens.input / 1_000_000) * rates.input + (tokens.output / 1_000_000) * rates.output
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
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const rows = await db
    .select({ total: sum(reviewCosts.estimatedCost) })
    .from(reviewCosts)
    .where(gte(reviewCosts.createdAt, startOfDay))

  return Number(rows[0]?.total ?? 0)
}

export async function countReviewsInLastHour(db: Db): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const rows = await db
    .select({ count: count(reviewCosts.uploadId) })
    .from(reviewCosts)
    .where(gte(reviewCosts.createdAt, oneHourAgo))

  return Number(rows[0]?.count ?? 0)
}
