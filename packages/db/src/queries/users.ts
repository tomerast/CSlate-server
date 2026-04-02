import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { users, type NewUser, type User } from '../schema'

export async function getUserByApiKeyHash(hash: string): Promise<User | undefined> {
  const db = getDb()
  return db.query.users.findFirst({ where: eq(users.apiKeyHash, hash) })
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = getDb()
  return db.query.users.findFirst({ where: eq(users.email, email) })
}

export async function getUserById(id: string): Promise<User | undefined> {
  const db = getDb()
  return db.query.users.findFirst({ where: eq(users.id, id) })
}

export async function createUser(data: NewUser): Promise<User> {
  const db = getDb()
  const [user] = await db.insert(users).values(data).returning()
  if (!user) throw new Error('Failed to create user')
  return user
}

export async function updateUser(id: string, data: Partial<Pick<User, 'displayName' | 'apiKeyHash'>>): Promise<User> {
  const db = getDb()
  const [user] = await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning()
  if (!user) throw new Error('User not found')
  return user
}

export async function deleteUser(id: string): Promise<void> {
  const db = getDb()
  await db.delete(users).where(eq(users.id, id))
}
