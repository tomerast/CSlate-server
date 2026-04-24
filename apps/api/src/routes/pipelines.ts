import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import {
  getPool,
  getPipelineById,
  getPopularPipelines,
  searchPipelines,
  updatePipeline,
} from '@cslate/db'
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
    throw new HTTPException(501, { message: 'PIPELINE_RATINGS_NOT_IMPLEMENTED' })
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
    throw new HTTPException(501, { message: 'PIPELINE_REPORTS_NOT_IMPLEMENTED' })
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
