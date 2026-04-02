import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users'

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  pipelineId: text('pipeline_id').notNull(),
  description: text('description').notNull(),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  version: text('version').notNull().default('1.0.0'),
  category: text('category'),
  subcategory: text('subcategory'),
  complexity: text('complexity'),

  // Pipeline-specific fields
  strategyType: text('strategy_type').notNull(),
  secretNames: text('secret_names').array().notNull().default(sql`'{}'::text[]`),
  outputSchema: jsonb('output_schema'),

  // AI-generated enrichment
  summary: text('summary'),
  contextSummary: text('context_summary'),

  // Ownership
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Full manifest
  manifest: jsonb('manifest').notNull(),

  // embedding vector(1536) — managed via raw SQL migration (pgvector not in drizzle-orm core)

  // Storage
  storageKey: text('storage_key'),

  // Metrics
  downloadCount: integer('download_count').notNull().default(0),
  ratingSum: integer('rating_sum').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),

  // Versioning
  parentId: uuid('parent_id'),

  // Moderation
  flagged: boolean('flagged').notNull().default(false),
  revoked: boolean('revoked').notNull().default(false),
  revokeReason: text('revoke_reason'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_pipelines_tags').on(table.tags),
  index('idx_pipelines_category').on(table.category),
  index('idx_pipelines_author').on(table.authorId),
  index('idx_pipelines_name_author').on(table.name, table.authorId),
  index('idx_pipelines_download').on(table.downloadCount),
  index('idx_pipelines_strategy').on(table.strategyType),
  uniqueIndex('idx_pipelines_pipeline_id').on(table.pipelineId),
])

export type Pipeline = typeof pipelines.$inferSelect
export type NewPipeline = typeof pipelines.$inferInsert
