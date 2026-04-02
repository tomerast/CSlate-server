# Ralph Loop: Admin Cost Control + Rate Limiting

## Mission

Build the admin-configurable cost control and rate limiting system for the CSlate reviewer agent. Admins can increase/decrease review throughput and spending via a config table. Uses pg-boss queue with throttled enqueueing.

## Scope

Build DB schema in `packages/db/src/schema/reviewer-config.ts`, config/cost logic in `packages/pipeline/src/reviewer-agent/config/`, and rate-limited enqueue in `packages/queue/src/reviewer-enqueue.ts`.

## Key Files

**Create:**
- `packages/db/src/schema/reviewer-config.ts` — Drizzle schema for `reviewer_config` + `review_costs` tables
- Update `packages/db/src/schema/index.ts` to export new schemas
- `packages/pipeline/src/reviewer-agent/config/index.ts` — `getReviewerConfig()` + `updateReviewerConfig()`
- `packages/pipeline/src/reviewer-agent/config/cost-tracker.ts` — `trackReviewCost()`, `getTodayLLMCost()`
- `packages/pipeline/src/reviewer-agent/config/rate-limiter.ts` — `enqueueReviewWithLimits()`
- `packages/queue/src/reviewer-enqueue.ts` — Rate-limited enqueue wrapper
- Tests for each module

**Read (do NOT modify):**
- `packages/pipeline/src/reviewer-agent/types.ts` — ReviewerConfig, DEFAULT_REVIEWER_CONFIG
- `packages/db/src/schema/uploads.ts` — Drizzle schema pattern to follow (use same column types)
- `packages/db/src/client.ts` — `type Db = ReturnType<typeof getDb>`
- `packages/queue/src/client.ts` — `getBoss()` pg-boss singleton
- `packages/queue/src/jobs.ts` — `JOB_NAMES`, `enqueueReviewJob` pattern

## DB Schema (reviewer-config.ts)

Follow the EXACT Drizzle pattern from `packages/db/src/schema/uploads.ts`:

```typescript
import { pgTable, text, integer, real, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core'

// Singleton config table — always has exactly one row with id='default'
export const reviewerConfig = pgTable('reviewer_config', {
  id: text('id').primaryKey().default('default'),
  maxConcurrentReviews: integer('max_concurrent_reviews').default(5),
  maxReviewsPerHour: integer('max_reviews_per_hour').default(30),
  reviewThrottleSeconds: integer('review_throttle_seconds').default(10),
  pauseReviews: boolean('pause_reviews').default(false),
  maxLlmCostPerDay: real('max_llm_cost_per_day').default(50),
  maxExpertAgentIterations: integer('max_expert_agent_iterations').default(12),
  maxRedTeamIterations: integer('max_red_team_iterations').default(10),
  maxJudgeIterations: integer('max_judge_iterations').default(12),
  qualityThreshold: integer('quality_threshold').default(70),
  maxWarnings: integer('max_warnings').default(5),
  modelOverrides: jsonb('model_overrides').default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export type ReviewerConfigRow = typeof reviewerConfig.$inferSelect

// Per-review cost tracking
export const reviewCosts = pgTable('review_costs', {
  id: text('id').primaryKey(),
  uploadId: text('upload_id').notNull(),
  phase: text('phase').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  estimatedCost: real('estimated_cost').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ReviewCostRow = typeof reviewCosts.$inferSelect
export type NewReviewCostRow = typeof reviewCosts.$inferInsert
```

## Interface Contracts

```typescript
import type { Db } from '@cslate/db'
import { ReviewerConfig } from '../types'

// Load config from DB (with DEFAULT_REVIEWER_CONFIG fallback if row missing)
export async function getReviewerConfig(db: Db): Promise<ReviewerConfig>

// Update config (admin API)
export async function updateReviewerConfig(db: Db, updates: Partial<ReviewerConfig>): Promise<ReviewerConfig>

// Track cost after each phase
export async function trackReviewCost(
  db: Db,
  uploadId: string,
  phase: string,
  model: string,
  tokens: { input: number; output: number },
): Promise<void>

// Get today's total LLM cost (UTC day)
export async function getTodayLLMCost(db: Db): Promise<number>

// Count reviews enqueued in last hour
export async function countReviewsInLastHour(db: Db): Promise<number>
```

## Cost Estimation (cost-tracker.ts)

```typescript
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 },
  'claude-opus-4-6': { input: 0.015, output: 0.075 },
}

export function estimateCost(model: string, tokens: { input: number; output: number }): number {
  const rates = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS['claude-sonnet-4-6']
  return (tokens.input / 1000) * rates.input + (tokens.output / 1000) * rates.output
}

export async function trackReviewCost(
  db: Db, uploadId: string, phase: string, model: string,
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
```

## Rate Limiter (rate-limiter.ts + packages/queue/src/reviewer-enqueue.ts)

```typescript
// packages/queue/src/reviewer-enqueue.ts
import { getBoss } from './client'
import type { ReviewerConfig } from '@cslate/pipeline' // or from the types

export async function enqueueReviewWithLimits(
  data: { uploadId: string },
  config: ReviewerConfig,
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
    return boss.send('review-component', data, { startAfterSeconds: delaySeconds })
  }

  // 3. Daily cost cap — defer to tomorrow midnight UTC
  if (todayCost >= config.maxLLMCostPerDay) {
    const now = new Date()
    const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    const delaySeconds = Math.ceil((tomorrowUtc.getTime() - now.getTime()) / 1000)
    return boss.send('review-component', data, { startAfterSeconds: delaySeconds })
  }

  // 4. Throttled enqueue
  return boss.sendThrottled('review-component', data, {}, config.reviewThrottleSeconds)
}
```

## getReviewerConfig (index.ts)

```typescript
import { DEFAULT_REVIEWER_CONFIG } from '../types'

export async function getReviewerConfig(db: Db): Promise<ReviewerConfig> {
  const rows = await db.select().from(reviewerConfig).where(eq(reviewerConfig.id, 'default'))
  if (rows.length === 0) return DEFAULT_REVIEWER_CONFIG

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
    modelOverrides: (row.modelOverrides as ReviewerConfig['modelOverrides']) ?? DEFAULT_REVIEWER_CONFIG.modelOverrides,
  }
}

export async function updateReviewerConfig(db: Db, updates: Partial<ReviewerConfig>): Promise<ReviewerConfig> {
  await db.insert(reviewerConfig)
    .values({ id: 'default', ...mapToRow(updates), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewerConfig.id,
      set: { ...mapToRow(updates), updatedAt: new Date() },
    })
  return getReviewerConfig(db)
}
```

## TDD Approach

1. **cost-tracker.test.ts**: Test `estimateCost` formula with known values. Test `getTodayLLMCost` returns sum only for today.
2. **index.test.ts**: Test `getReviewerConfig` with empty DB → returns DEFAULT_REVIEWER_CONFIG. Test `updateReviewerConfig` stores and returns updated config.
3. **rate-limiter.test.ts**: Mock pg-boss → test pause throws, hourly limit defers, cost cap defers, normal path uses sendThrottled.

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/config/__tests__/ --reporter verbose`

## When You're Done

DB schema defined, `getReviewerConfig` returns defaults when DB empty, `updateReviewerConfig` persists changes, cost tracking accumulates correctly, rate limiting logic correct for all 4 cases (pause, hourly, daily, throttled), tests pass.

<promise>COST CONTROL COMPLETE</promise>
