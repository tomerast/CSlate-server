import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core'

// Partitioned table — actual partitions created by worker maintenance job.
// This schema definition is for TypeScript types only; the real DDL is in the initial migration.
export const downloadEvents = pgTable('download_events', {
  id: uuid('id').defaultRandom().notNull(),
  componentId: uuid('component_id').notNull(),
  userId: uuid('user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type DownloadEvent = typeof downloadEvents.$inferSelect
export type NewDownloadEvent = typeof downloadEvents.$inferInsert
