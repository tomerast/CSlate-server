import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { getDb, getPool, getComponentById, getPopularComponents, getTrendingComponents, checkComponentRevocations, updateComponent } from '@cslate/db'
import { components, ratings, reports } from '@cslate/db'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { getEmbedding } from '@cslate/llm'
import { searchComponents } from '@cslate/db'
import { authMiddleware } from '../middleware/auth'
import { rateLimitMiddleware } from '../middleware/rate-limit'

export const componentRoutes = new Hono()

// GET /api/v1/components/search
componentRoutes.get(
  '/search',
  rateLimitMiddleware('search'),
  zValidator('query', z.object({
    q: z.string().min(1),
    tags: z.string().optional(),
    category: z.string().optional(),
    complexity: z.enum(['simple', 'moderate', 'complex']).optional(),
    minRating: z.coerce.number().min(1).max(5).optional(),
    sortBy: z.enum(['relevance', 'rating', 'downloads', 'recent']).optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  })),
  async (c) => {
    const q = c.req.valid('query')
    const queryEmbedding = await getEmbedding(q.q)
    const tags = q.tags ? q.tags.split(',').map(t => t.trim()) : undefined

    const { results, total } = await searchComponents({
      queryEmbedding,
      tags,
      category: q.category,
      complexity: q.complexity,
      minRating: q.minRating,
      sortBy: q.sortBy,
      limit: q.limit,
      offset: q.offset,
    })

    return c.json({ results, total, offset: q.offset, limit: q.limit })
  }
)

// GET /api/v1/components/trending
componentRoutes.get(
  '/trending',
  rateLimitMiddleware('search'),
  zValidator('query', z.object({
    period: z.enum(['day', 'week', 'month']).default('week'),
    limit: z.coerce.number().min(1).max(100).default(20),
  })),
  async (c) => {
    const { period, limit } = c.req.valid('query')
    const results = await getTrendingComponents(period, limit)
    return c.json({ results })
  }
)

// GET /api/v1/components/popular
componentRoutes.get(
  '/popular',
  rateLimitMiddleware('search'),
  zValidator('query', z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
  })),
  async (c) => {
    const { limit } = c.req.valid('query')
    const results = await getPopularComponents(limit)
    return c.json({ results })
  }
)

// GET /api/v1/components/tags
componentRoutes.get('/tags', rateLimitMiddleware('search'), async (c) => {
  const pool = getPool()
  const res = await pool.query<{ name: string; count: number }>(
    `SELECT unnest(tags) AS name, COUNT(*) AS count
     FROM components WHERE flagged = false AND revoked = false
     GROUP BY name ORDER BY count DESC LIMIT 200`
  )
  return c.json({ tags: res.rows })
})

// GET /api/v1/components/categories
componentRoutes.get('/categories', rateLimitMiddleware('search'), async (c) => {
  const pool = getPool()
  const res = await pool.query<{ name: string; subcategories: string[]; count: number }>(
    `SELECT category AS name, array_agg(DISTINCT subcategory) FILTER (WHERE subcategory IS NOT NULL) AS subcategories, COUNT(*) AS count
     FROM components WHERE flagged = false AND revoked = false AND category IS NOT NULL
     GROUP BY category ORDER BY count DESC`
  )
  return c.json({ categories: res.rows })
})

// POST /api/v1/components/check-updates
componentRoutes.post(
  '/check-updates',
  authMiddleware,
  zValidator('json', z.object({ componentIds: z.array(z.string().uuid()) })),
  async (c) => {
    const { componentIds } = c.req.valid('json')
    const db = getDb()

    // Check for newer versions
    const comps = await db.query.components.findMany({
      where: inArray(components.id, componentIds),
      columns: { id: true, version: true, updatedAt: true, parentId: true },
    })

    const revocations = (await checkComponentRevocations(componentIds)).map(c => ({
      id: c.id,
      reason: c.revokeReason,
      message: undefined as string | undefined,
    }))

    return c.json({ updates: [], revocations })
  }
)

// GET /api/v1/components/:id
componentRoutes.get(
  '/:id',
  rateLimitMiddleware('component_read'),
  async (c) => {
    const id = c.req.param('id')
    const component = await getComponentById(id)
    if (!component || component.revoked) {
      throw new HTTPException(404, { message: 'NOT_FOUND' })
    }
    return c.json(component)
  }
)

// GET /api/v1/components/:id/source
componentRoutes.get(
  '/:id/source',
  rateLimitMiddleware('component_read'),
  async (c) => {
    const id = c.req.param('id')
    const component = await getComponentById(id)
    if (!component || component.revoked) {
      throw new HTTPException(404, { message: 'NOT_FOUND' })
    }

    const { getComponentFiles } = await import('@cslate/storage')
    const files = await getComponentFiles(component.storageKey)

    // Track download event
    const pool = getPool()
    const user = c.get('user' as never) as { id?: string } | undefined
    await pool.query(
      `INSERT INTO download_events (component_id, user_id) VALUES ($1, $2)`,
      [id, user?.id ?? null]
    )
    await pool.query(
      `UPDATE components SET download_count = download_count + 1 WHERE id = $1`,
      [id]
    )

    return c.json({
      id: component.id,
      manifest: component.manifest,
      files,
      summary: component.summary,
      version: component.version,
      updatedAt: component.updatedAt,
    })
  }
)

// GET /api/v1/components/:id/versions
componentRoutes.get('/:id/versions', rateLimitMiddleware('component_read'), async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  // Walk parent_id chain to find all versions
  const pool = getPool()
  const res = await pool.query(
    `WITH RECURSIVE versions AS (
       SELECT id, version, summary, created_at, parent_id FROM components WHERE id = $1
       UNION ALL
       SELECT c.id, c.version, c.summary, c.created_at, c.parent_id
       FROM components c JOIN versions v ON c.id = v.parent_id
     )
     SELECT id, version, summary, created_at FROM versions ORDER BY created_at DESC`,
    [id]
  )

  return c.json({ versions: res.rows })
})

// POST /api/v1/components/:id/rate (authenticated)
componentRoutes.post(
  '/:id/rate',
  authMiddleware,
  rateLimitMiddleware('rating'),
  zValidator('json', z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(500).optional(),
  })),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')
    const { rating, comment } = c.req.valid('json')
    const db = getDb()
    const pool = getPool()

    const component = await getComponentById(id)
    if (!component || component.revoked) throw new HTTPException(404, { message: 'NOT_FOUND' })

    // Upsert rating
    const existing = await db.query.ratings.findFirst({
      where: and(eq(ratings.componentId, id), eq(ratings.userId, user.id)),
    })

    if (existing) {
      // Update: adjust rating_sum delta
      const delta = rating - existing.rating
      await db.update(ratings).set({ rating, comment, updatedAt: new Date() })
        .where(and(eq(ratings.componentId, id), eq(ratings.userId, user.id)))
      if (delta !== 0) {
        await pool.query(
          `UPDATE components SET rating_sum = rating_sum + $1 WHERE id = $2`,
          [delta, id]
        )
      }
    } else {
      await db.insert(ratings).values({ componentId: id, userId: user.id, rating, comment })
      await pool.query(
        `UPDATE components SET rating_sum = rating_sum + $1, rating_count = rating_count + 1 WHERE id = $2`,
        [rating, id]
      )
    }

    const updated = await getComponentById(id)
    const avgRating = updated && updated.ratingCount > 0
      ? updated.ratingSum / updated.ratingCount
      : 0

    return c.json({ rating: avgRating, ratingCount: updated?.ratingCount ?? 0 })
  }
)

// POST /api/v1/components/:id/report (authenticated)
componentRoutes.post(
  '/:id/report',
  authMiddleware,
  rateLimitMiddleware('report'),
  zValidator('json', z.object({
    reason: z.enum(['malicious', 'broken', 'inappropriate', 'copyright', 'other']),
    description: z.string().max(1000).optional(),
  })),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')
    const { reason, description } = c.req.valid('json')
    const db = getDb()
    const pool = getPool()

    const component = await getComponentById(id)
    if (!component) throw new HTTPException(404, { message: 'NOT_FOUND' })

    // Check for duplicate
    const existing = await db.query.reports.findFirst({
      where: and(eq(reports.componentId, id), eq(reports.reporterId, user.id)),
    })
    if (existing) throw new HTTPException(409, { message: 'DUPLICATE_REPORT' })

    const [report] = await db.insert(reports).values({
      componentId: id,
      reporterId: user.id,
      reason,
      description,
    }).returning({ id: reports.id })

    // Auto-flag if 3+ reports
    await pool.query(
      `UPDATE components SET flagged = true
       WHERE id = $1 AND (SELECT COUNT(*) FROM reports WHERE component_id = $1) >= 3`,
      [id]
    )

    return c.json({ reportId: report?.id }, 201)
  }
)

// POST /api/v1/components/:id/revoke (authenticated — uploader only)
componentRoutes.post(
  '/:id/revoke',
  authMiddleware,
  zValidator('json', z.object({
    reason: z.enum(['security', 'abuse', 'legal', 'author-request']),
    message: z.string().max(500).optional(),
  })),
  async (c) => {
    const id = c.req.param('id')
    const user = c.get('user')
    const { reason } = c.req.valid('json')
    const db = getDb()

    const component = await getComponentById(id)
    if (!component) throw new HTTPException(404, { message: 'NOT_FOUND' })
    if (component.authorId !== user.id) throw new HTTPException(403, { message: 'FORBIDDEN' })

    const updated = await updateComponent(id, {
      revoked: true,
      revokeReason: reason,
      revokedAt: new Date(),
    })

    return c.json({ id: updated.id, revokedAt: updated.revokedAt })
  }
)
