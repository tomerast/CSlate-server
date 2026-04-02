import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'

export const reviewerKnowledgeVersions = pgTable('reviewer_knowledge_versions', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  changeType: text('change_type').notNull(),
  changeDescription: text('change_description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ReviewerKnowledgeVersion = typeof reviewerKnowledgeVersions.$inferSelect
export type NewReviewerKnowledgeVersion = typeof reviewerKnowledgeVersions.$inferInsert
