import { pgTable, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const reviewerPatterns = pgTable('reviewer_patterns', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  patternDesc: text('pattern_desc').notNull(),
  regex: text('regex'),
  dimension: integer('dimension').notNull(),
  occurrences: integer('occurrences').notNull().default(0),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  examples: jsonb('examples').default([]),
})

export type ReviewerPattern = typeof reviewerPatterns.$inferSelect
export type NewReviewerPattern = typeof reviewerPatterns.$inferInsert
