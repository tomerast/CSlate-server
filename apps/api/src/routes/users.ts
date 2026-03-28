import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getDb, getUserById, updateUser, countUserCheckpoints } from '@cslate/db'
import { components, checkpoints, uploads } from '@cslate/db'
import { eq, desc, count, sum, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

export const userRoutes = new Hono()

// GET /api/v1/users/me
userRoutes.get('/me', authMiddleware, async (c) => {
  const user = c.get('user')
  const db = getDb()

  const [componentCount, uploadCount] = await Promise.all([
    db.select({ count: count() }).from(components).where(eq(components.authorId, user.id)),
    db.select({ count: count() }).from(uploads).where(eq(uploads.authorId, user.id)),
  ])

  return c.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
    stats: {
      componentsPublished: componentCount[0]?.count ?? 0,
      uploadsTotal: uploadCount[0]?.count ?? 0,
    },
  })
})

// PATCH /api/v1/users/me
userRoutes.patch(
  '/me',
  authMiddleware,
  zValidator('json', z.object({ displayName: z.string().min(1).max(100).optional() })),
  async (c) => {
    const user = c.get('user')
    const { displayName } = c.req.valid('json')
    const updated = await updateUser(user.id, { displayName: displayName ?? undefined })
    return c.json({ id: updated.id, email: updated.email, displayName: updated.displayName })
  }
)

// GET /api/v1/users/me/components
userRoutes.get(
  '/me/components',
  authMiddleware,
  zValidator('query', z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  })),
  async (c) => {
    const user = c.get('user')
    const { limit, offset } = c.req.valid('query')
    const db = getDb()

    const userComponents = await db.query.components.findMany({
      where: eq(components.authorId, user.id),
      orderBy: [desc(components.createdAt)],
      limit,
      offset,
    })

    const totalRes = await db.select({ count: count() }).from(components).where(eq(components.authorId, user.id))

    return c.json({ components: userComponents, total: totalRes[0]?.count ?? 0 })
  }
)

// GET /api/v1/users/me/checkpoints
userRoutes.get(
  '/me/checkpoints',
  authMiddleware,
  zValidator('query', z.object({ projectId: z.string().optional() })),
  async (c) => {
    const user = c.get('user')
    const { projectId } = c.req.valid('query')
    const db = getDb()

    const where = projectId
      ? and(eq(checkpoints.userId, user.id), eq(checkpoints.projectId, projectId))
      : eq(checkpoints.userId, user.id)

    const userCheckpoints = await db.query.checkpoints.findMany({
      where,
      orderBy: [desc(checkpoints.createdAt)],
    })

    // Group by component
    const grouped = new Map<string, typeof userCheckpoints>()
    for (const cp of userCheckpoints) {
      if (!grouped.has(cp.componentLocalId)) grouped.set(cp.componentLocalId, [])
      grouped.get(cp.componentLocalId)!.push(cp)
    }

    return c.json({
      components: Array.from(grouped.entries()).map(([componentLocalId, cps]) => ({
        componentLocalId,
        componentName: cps[0]?.componentName ?? componentLocalId,
        checkpoints: cps.map(cp => ({
          id: cp.id,
          version: cp.version,
          description: cp.description,
          trigger: cp.trigger,
          createdAt: cp.createdAt,
        })),
      })),
    })
  }
)

// GET /api/v1/users/me/quota
userRoutes.get('/me/quota', authMiddleware, async (c) => {
  const user = c.get('user')
  const checkpointCount = await countUserCheckpoints(user.id)

  return c.json({
    checkpoints: {
      used: checkpointCount,
      max: 500,
    },
    uploads: {
      used: 0, // TODO: count recent uploads from rate_limits
      max: 10,
      resetAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  })
})
