import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { components } from './components'
import { users } from './users'

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  componentId: uuid('component_id').notNull().references(() => components.id, { onDelete: 'cascade' }),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_reports_user_component').on(table.componentId, table.reporterId),
  index('idx_reports_component').on(table.componentId),
])

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
