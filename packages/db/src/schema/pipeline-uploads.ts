import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { pipelines } from './pipelines'

export const pipelineUploads = pgTable('pipeline_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  manifest: jsonb('manifest').notNull(),
  storageKey: text('storage_key'),
  status: text('status').notNull().default('pending'),
  currentStage: text('current_stage'),
  completedStages: jsonb('completed_stages').notNull().default([]),
  rejectionReasons: jsonb('rejection_reasons'),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_pipeline_uploads_author').on(table.authorId),
  index('idx_pipeline_uploads_status').on(table.status),
])

export type PipelineUpload = typeof pipelineUploads.$inferSelect
export type NewPipelineUpload = typeof pipelineUploads.$inferInsert
