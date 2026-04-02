import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger as honoLogger } from 'hono/logger'
import { authRoutes } from './routes/auth'
import { componentRoutes } from './routes/components'
import { uploadRoutes } from './routes/uploads'
import { checkpointRoutes } from './routes/checkpoints'
import { userRoutes } from './routes/users'

import { log } from './lib/logger'
export { log } from './lib/logger'

const app = new Hono()

// Global middleware
app.use('*', async (c, next) => {
  c.header('API-Version', '1')
  await next()
})

app.use('*', honoLogger())

// Health check (no auth)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// API routes
const api = new Hono()
api.route('/auth', authRoutes)
api.route('/components', uploadRoutes)
api.route('/components', componentRoutes)
api.route('/checkpoints', checkpointRoutes)
api.route('/users', userRoutes)

app.route('/api/v1', api)

// Global error handler
app.onError((err, c) => {
  log.error({ err }, 'Unhandled error')
  const status = (err as { status?: number }).status ?? 500
  const code = (err as { code?: string }).code ?? 'SERVER_ERROR'
  return c.json(
    { error: { code, message: err.message } },
    status as 500
  )
})

// 404 handler
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))

const port = parseInt(process.env.PORT ?? '3000', 10)

serve({ fetch: app.fetch, port }, (info) => {
  log.info(`API server listening on http://localhost:${info.port}`)
})

export type AppType = typeof app
export default app
