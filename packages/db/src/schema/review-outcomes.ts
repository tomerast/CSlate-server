import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const reviewOutcomes = pgTable('review_outcomes', {
  id: text('id').primaryKey(),
  uploadId: text('upload_id').notNull(),
  verdict: text('verdict').notNull(),
  dimensionScores: jsonb('dimension_scores').notNull(),
  findings: jsonb('findings').notNull(),
  postReviewSignals: jsonb('post_review_signals'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_review_outcomes_upload').on(table.uploadId),
  index('idx_review_outcomes_verdict').on(table.verdict),
])

export type ReviewOutcome = typeof reviewOutcomes.$inferSelect
export type NewReviewOutcome = typeof reviewOutcomes.$inferInsert
