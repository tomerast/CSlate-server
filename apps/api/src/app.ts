import { Hono } from 'hono'
import { logger as honoLogger } from 'hono/logger'
import { authRoutes } from './routes/auth'
import { componentRoutes } from './routes/components'
import { uploadRoutes } from './routes/uploads'
import { checkpointRoutes } from './routes/checkpoints'
import { userRoutes } from './routes/users'
import { pipelineRoutes } from './routes/pipelines'
import { pipelineUploadRoutes } from './routes/pipeline-uploads'
import { searchRoutes } from './routes/search'
import { adminRoutes } from './routes/admin'
import { log } from './lib/logger'

/**
 * Build the Hono application with every route + middleware wired up.
 *
 * Split from `index.ts` so tests (and any programmatic host) can import the
 * app without starting the listener. The concrete `serve()` call lives in
 * `index.ts` where it belongs.
 */
export function createApp(): Hono {
  const app = new Hono()

  // Global middleware — every response advertises the API version
  app.use('*', async (c, next) => {
    c.header('API-Version', '1')
    await next()
  })

  app.use('*', honoLogger())

  // Health check — no auth, no DB — used by load balancers + tests
  app.get('/health', (c) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString() }),
  )

  // Versioned API
  const api = new Hono()
  api.route('/auth', authRoutes)
  api.route('/components', uploadRoutes)
  api.route('/components', componentRoutes)
  api.route('/checkpoints', checkpointRoutes)
  api.route('/users', userRoutes)
  api.route('/pipelines/upload', pipelineUploadRoutes)
  api.route('/pipelines', pipelineRoutes)
  api.route('/search', searchRoutes)
  api.route('/admin', adminRoutes)

  app.route('/api/v1', api)

  // Unified error envelope: `{ error: { code, message } }`
  app.onError((err, c) => {
    log.error({ err }, 'Unhandled error')
    const status = (err as { status?: number }).status ?? 500
    const code = (err as { code?: string }).code ?? 'SERVER_ERROR'
    return c.json(
      { error: { code, message: err.message } },
      status as 500,
    )
  })

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404),
  )

  return app
}

export type AppType = ReturnType<typeof createApp>
