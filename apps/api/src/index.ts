import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { log } from './lib/logger'

export { log } from './lib/logger'
export { createApp } from './app'
export type { AppType } from './app'

const app = createApp()
const port = parseInt(process.env.PORT ?? '3000', 10)

serve({ fetch: app.fetch, port }, (info) => {
  log.info(`API server listening on http://localhost:${info.port}`)
})

export default app
