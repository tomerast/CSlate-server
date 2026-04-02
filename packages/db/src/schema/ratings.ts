import { pgTable, uuid, integer, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { components } from './components'
import { users } from './users'

export const ratings = pgTable('ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  componentId: uuid('component_id').notNull().references(() => components.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_ratings_user_component').on(table.componentId, table.userId),
])

export type Rating = typeof ratings.$inferSelect
export type NewRating = typeof ratings.$inferInsert
