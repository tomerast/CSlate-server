import { pgTable, uuid, text, integer, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const checkpoints = pgTable('checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull(),
  componentLocalId: text('component_local_id').notNull(),
  componentName: text('component_name').notNull(),
  version: integer('version').notNull(),
  manifest: jsonb('manifest').notNull(),
  storageKey: text('storage_key').notNull(),
  description: text('description').notNull(),
  trigger: text('trigger').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_checkpoints_version').on(table.userId, table.projectId, table.componentLocalId, table.version),
  index('idx_checkpoints_user_project').on(table.userId, table.projectId),
  index('idx_checkpoints_component').on(table.userId, table.componentLocalId),
])

export type Checkpoint = typeof checkpoints.$inferSelect
export type NewCheckpoint = typeof checkpoints.$inferInsert
