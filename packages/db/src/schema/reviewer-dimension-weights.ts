import { pgTable, text, integer, real, timestamp, index } from 'drizzle-orm/pg-core'

export const reviewerDimensionWeights = pgTable('reviewer_dimension_weights', {
  id: text('id').primaryKey(),
  dimension: integer('dimension').notNull(),
  weight: real('weight').notNull().default(1.0),
  strictnessLevel: text('strictness_level').notNull().default('standard'),
  adjustedAt: timestamp('adjusted_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason').notNull(),
}, (table) => [
  index('idx_dimension_weights_dim').on(table.dimension),
])

export type ReviewerDimensionWeight = typeof reviewerDimensionWeights.$inferSelect
export type NewReviewerDimensionWeight = typeof reviewerDimensionWeights.$inferInsert
