import { eq, and, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { checkpoints, type Checkpoint, type NewCheckpoint } from '../schema'

export async function createCheckpoint(data: NewCheckpoint): Promise<Checkpoint> {
  const db = getDb()
  const [cp] = await db.insert(checkpoints).values(data).returning()
  if (!cp) throw new Error('Failed to create checkpoint')
  return cp
}

export async function getCheckpoints(userId: string, projectId: string, componentLocalId: string): Promise<Checkpoint[]> {
  const db = getDb()
  return db.query.checkpoints.findMany({
    where: and(
      eq(checkpoints.userId, userId),
      eq(checkpoints.projectId, projectId),
      eq(checkpoints.componentLocalId, componentLocalId),
    ),
    orderBy: (cp, { desc }) => [desc(cp.version)],
  })
}

export async function getCheckpoint(userId: string, projectId: string, componentLocalId: string, version: number): Promise<Checkpoint | undefined> {
  const db = getDb()
  return db.query.checkpoints.findFirst({
    where: and(
      eq(checkpoints.userId, userId),
      eq(checkpoints.projectId, projectId),
      eq(checkpoints.componentLocalId, componentLocalId),
      eq(checkpoints.version, version),
    ),
  })
}

export async function deleteCheckpoint(userId: string, projectId: string, componentLocalId: string, version: number): Promise<void> {
  const db = getDb()
  await db.delete(checkpoints).where(
    and(
      eq(checkpoints.userId, userId),
      eq(checkpoints.projectId, projectId),
      eq(checkpoints.componentLocalId, componentLocalId),
      eq(checkpoints.version, version),
    )
  )
}

export async function countUserCheckpoints(userId: string): Promise<number> {
  const db = getDb()
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(checkpoints).where(eq(checkpoints.userId, userId))
  return result[0]?.count ?? 0
}
