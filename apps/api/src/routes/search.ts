import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { searchComponents, searchPipelines } from '@cslate/db'
import { getEmbedding } from '@cslate/llm'
import { rateLimitMiddleware } from '../middleware/rate-limit'

export const searchRoutes = new Hono()

// GET /api/v1/search?q=...&type=all|component|pipeline
searchRoutes.get(
  '/',
  rateLimitMiddleware('search'),
  zValidator(
    'query',
    z.object({
      q: z.string().min(1),
      type: z.enum(['all', 'component', 'pipeline']).optional().default('all'),
      limit: z.coerce.number().int().min(1).max(50).optional().default(10),
    }),
  ),
  async (c) => {
    const { q, type, limit } = c.req.valid('query')
    const queryEmbedding = await getEmbedding(q)

    let components: unknown[] = []
    let pipelines: unknown[] = []

    if (type === 'all' || type === 'component') {
      const result = await searchComponents({ queryEmbedding, limit })
      components = result.results
    }

    if (type === 'all' || type === 'pipeline') {
      const result = await searchPipelines({ queryEmbedding, limit })
      pipelines = result.results
    }

    return c.json({ components, pipelines })
  },
)
