import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import {
  getDb,
  getPool,
  getPipelineById,
  getPopularPipelines,
  searchPipelines,
  updatePipeline,
  pipelineUploads,
} from '@cslate/db'
import { pipelines, ratings, reports } from '@cslate/db'
import { eq, and } from 'drizzle-orm'
import { getEmbedding } from '@cslate/llm'
import { getPipelineFiles } from '@cslate/storage'
import { authMiddleware } from '../middleware/auth'
import { rateLimitMiddleware } from '../middleware/rate-limit'

export const pipelineRoutes = new Hono()

// GET /api/v1/pipelines/search
pipelineRoutes.get(
  '/search',
  rateLimitMiddleware('search'),
  zValidator('query', z.object({
    q: z.string().min(1),
    tags: z.string().optional(),
    category: z.string().optional(),
    strategyType: z.enum(['on-demand', 'polling', 'streaming']).optional(),
    minRating: z.coerce.number().min(1).max(5).optional(),
    sortBy: z.enum(['relevance', 'rating', 'downloads', 'recent']).optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  })),
  async (c) => {
    const q = c.req.valid('query')
    const queryEmbedding = await getEmbedding(q.q)
    const tags = q.tags ? q.tags.split(',').map(t => t.trim()) : undefined

    const { results, total } = await searchPipelines({
      queryEmbedding,
      tags,
      category: q.category,
      strategyType: q.strategyType,
      minRating: q.minRating,
      sortBy: q.sortBy,
      limit: q.limit,
      offset: q.offset,
    })

    return c.json({ results, total, offset: q.offset, limit: q.limit })
  }
)

// GET /api/v1/pipelines/popular
pipelineRoutes.get(
  '/popular',
  rateLimitMiddleware('search'),
  zValidator('query', z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
  })),
  async (c) => {
    const { limit } = c.req.valid('query')
    const results = await getPopularPipelines(limit)
    return c.json({ results })
  }
)

// GET /api/v1/pipelines/:id
pipelineRoutes.get(
  '/:id',
  rateLimitMiddleware('component_read'),
  async (c) => {
    const id = c.req.param('id')
    const pipeline = await getPipelineById(id)
    if (!pipeline || pipeline.revoked) {
      throw new HTTPException(404, { message: 'NOT_FOUND' })
    }
    return c.json(pipeline)
  }
)

// GET /api/v1/pipelines/:id/source
pipelineRoutes.get(
  '/:id/source',
  rateLimitMiddleware('component_read'),
  async (c) => {
    const id = c.req.param('id')
    const pipeline = await getPipelineById(id)
    if (!pipeline || pipeline.revoked) {
      throw new HTTPException(404, { message: 'NOT_FOUND' })
    }

    if (!pipeline.storageKey) {
      throw new HTTPException(404, { message: 'SOURCE_NOT_AVAILABLE' })
    }

    const files = await getPipelineFiles(pipeline.storageKey)

    const pool = getPool()
    const user = c.get('user' as never) as { id?: string } | undefined
    await pool.query(
      `UPDATE pipelines SET download_count = download_count + 1 WHERE id = $1`,
      [id]
    )

    return c.json({
      id: pipeline.id,
      manifest: pipeline.manifest,
      files,
      summary: pipeline.summary,
      version: pipeline.version,
      updatedAt: pipeline.updatedAt,
    })
  }
)

// GET /api/v1/pipelines/:id/versions
pipelineRoutes.get(
  '/:id/versions',
  rateLimitMiddleware('component_read'),
  async (c) => {
    const id = c.req.param('id')
    const pool = getPool()

    const res = await pool.query(
      `WITH RECURSIVE versions AS (
         SELECT id, version, summary, created_at, parent_id FROM pipelines WHERE id = $1
         UNION ALL
         SELECT p.id, p.version, p.summary, p.created_at, p.parent_id
         FROM pipelines p JOIN versions v ON p.id = v.parent_id
       )
       SELECT id, version, summary, created_at FROM versions ORDER BY created_at DESC`,
      [id]
    )

    return c.json({ versions: res.rows })
  }
)

// POST /api/v1/pipelines/:id/rate (authenticated)
pipelineRoutes.post(
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

    const pipeline = await getPipelineById(id)
    if (!pipeline || pipeline.revoked) throw new HTTPException(404, { message: 'NOT_FOUND' })

    const existing = await db.query.ratings.findFirst({
      where: and(eq(ratings.componentId, id), eq(ratings.userId, user.id)),
    })

    if (existing) {
      const delta = rating - existing.rating
      await db.update(ratings).set({ rating, comment, updatedAt: new Date() })
        .where(and(eq(ratings.componentId, id), eq(ratings.userId, user.id)))
      if (delta !== 0) {
        await pool.query(
          `UPDATE pipelines SET rating_sum = rating_sum + $1 WHERE id = $2`,
          [delta, id]
        )
      }
    } else {
      await db.insert(ratings).values({ componentId: id, userId: user.id, rating, comment })
      await pool.query(
        `UPDATE pipelines SET rating_sum = rating_sum + $1, rating_count = rating_count + 1 WHERE id = $2`,
        [rating, id]
      )
    }

    const updated = await getPipelineById(id)
    const avgRating = updated && updated.ratingCount > 0
      ? updated.ratingSum / updated.ratingCount
      : 0

    return c.json({ rating: avgRating, ratingCount: updated?.ratingCount ?? 0 })
  }
)

// POST /api/v1/pipelines/:id/report (authenticated)
pipelineRoutes.post(
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

    const pipeline = await getPipelineById(id)
    if (!pipeline) throw new HTTPException(404, { message: 'NOT_FOUND' })

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
      `UPDATE pipelines SET flagged = true
       WHERE id = $1 AND (SELECT COUNT(*) FROM reports WHERE component_id = $1) >= 3`,
      [id]
    )

    return c.json({ reportId: report?.id }, 201)
  }
)

// POST /api/v1/pipelines/:id/revoke (authenticated — uploader only)
pipelineRoutes.post(
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

    const pipeline = await getPipelineById(id)
    if (!pipeline) throw new HTTPException(404, { message: 'NOT_FOUND' })
    if (pipeline.authorId !== user.id) throw new HTTPException(403, { message: 'FORBIDDEN' })

    const updated = await updatePipeline(id, {
      revoked: true,
      revokeReason: reason,
      revokedAt: new Date(),
    })

    return c.json({ id: updated.id, revokedAt: updated.revokedAt })
  }
)
