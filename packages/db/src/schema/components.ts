import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users'

export const components = pgTable('components', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  version: text('version').notNull().default('1.0.0'),
  category: text('category'),
  subcategory: text('subcategory'),
  complexity: text('complexity'),
  summary: text('summary'),
  contextSummary: text('context_summary'),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  manifest: jsonb('manifest').notNull(),
  // embedding stored as raw vector string — pgvector not in drizzle-orm core yet
  // Actual VECTOR(1536) column managed via raw SQL migration
  storageKey: text('storage_key').notNull(),
  downloadCount: integer('download_count').notNull().default(0),
  ratingSum: integer('rating_sum').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  parentId: uuid('parent_id'),
  flagged: boolean('flagged').notNull().default(false),
  revoked: boolean('revoked').notNull().default(false),
  revokeReason: text('revoke_reason'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_components_tags').on(table.tags),
  index('idx_components_category').on(table.category),
  index('idx_components_author').on(table.authorId),
  index('idx_components_name_author').on(table.name, table.authorId),
  index('idx_components_download').on(table.downloadCount),
])

export type Component = typeof components.$inferSelect
export type NewComponent = typeof components.$inferInsert
