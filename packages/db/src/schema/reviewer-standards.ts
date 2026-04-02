import { pgTable, text, integer, real, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const reviewerStandards = pgTable('reviewer_standards', {
  id: text('id').primaryKey(),
  dimension: integer('dimension').notNull(),
  rule: text('rule').notNull(),
  rationale: text('rationale').notNull(),
  examplesGood: jsonb('examples_good').default([]),
  examplesBad: jsonb('examples_bad').default([]),
  source: text('source').notNull(),
  confidence: real('confidence').default(50),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
}, (table) => [
  index('idx_reviewer_standards_dimension').on(table.dimension),
])

export type ReviewerStandard = typeof reviewerStandards.$inferSelect
export type NewReviewerStandard = typeof reviewerStandards.$inferInsert
