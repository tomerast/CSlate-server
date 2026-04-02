import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { components } from './components'

export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  manifest: jsonb('manifest').notNull(),
  storageKey: text('storage_key').notNull(),
  status: text('status').notNull().default('pending'),
  currentStage: text('current_stage'),
  completedStages: jsonb('completed_stages').notNull().default([]),
  rejectionReasons: jsonb('rejection_reasons'),
  componentId: uuid('component_id').references(() => components.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_uploads_author').on(table.authorId),
  index('idx_uploads_status').on(table.status),
])

export type Upload = typeof uploads.$inferSelect
export type NewUpload = typeof uploads.$inferInsert
