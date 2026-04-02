import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core'

export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  endpointGroup: text('endpoint_group').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(1),
}, (table) => [
  unique('uq_rate_limits_window').on(table.userId, table.endpointGroup, table.windowStart),
])

export type RateLimit = typeof rateLimits.$inferSelect
