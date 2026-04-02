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
export type NewReviewerConfigRow = typeof reviewerConfig.$inferInsert

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
