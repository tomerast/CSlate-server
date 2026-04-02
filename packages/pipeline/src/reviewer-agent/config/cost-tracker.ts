import type { Db } from '@cslate/db'

// Cost per 1M tokens (input/output) by model
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
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
  // TODO: Persist cost record to DB for budget tracking and daily limits
}
