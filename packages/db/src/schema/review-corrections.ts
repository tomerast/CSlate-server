import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'

export const reviewCorrections = pgTable('review_corrections', {
  id: text('id').primaryKey(),
  reviewId: text('review_id').notNull(),
  findingId: text('finding_id').notNull(),
  correctionType: text('correction_type').notNull(),
  originalSeverity: text('original_severity').notNull(),
  originalDimension: integer('original_dimension').notNull(),
  correctedSeverity: text('corrected_severity').notNull(),
  correctedDimension: integer('corrected_dimension').notNull(),
  reason: text('reason').notNull(),
  correctedBy: text('corrected_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ReviewCorrection = typeof reviewCorrections.$inferSelect
export type NewReviewCorrection = typeof reviewCorrections.$inferInsert
