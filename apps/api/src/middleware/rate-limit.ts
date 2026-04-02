import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getPool } from '@cslate/db'
import type { User } from '@cslate/db'

interface RateLimitConfig {
  group: string
  limit: number
  windowSeconds: number
}

const CONFIGS: Record<string, RateLimitConfig> = {
  search: { group: 'search', limit: 100, windowSeconds: 60 },
  component_read: { group: 'component_read', limit: 120, windowSeconds: 60 },
  upload: { group: 'upload', limit: 10, windowSeconds: 3600 },
  checkpoint_write: { group: 'checkpoint_write', limit: 60, windowSeconds: 3600 },
  checkpoint_read: { group: 'checkpoint_read', limit: 120, windowSeconds: 60 },
  report: { group: 'report', limit: 10, windowSeconds: 3600 },
  rating: { group: 'rating', limit: 30, windowSeconds: 60 },
}

export function rateLimitMiddleware(configKey: keyof typeof CONFIGS) {
  const config = CONFIGS[configKey]
  if (!config) throw new Error(`Unknown rate limit config: ${configKey}`)

  return createMiddleware<{ Variables: { user: User } }>(async (c, next) => {
    const user = c.get('user')
    if (!user) return next()

    const pool = getPool()
    const windowStart = new Date(
      Math.floor(Date.now() / (config.windowSeconds * 1000)) * config.windowSeconds * 1000
    )

    const result = await pool.query<{ count: number }>(
      `INSERT INTO rate_limits (user_id, endpoint_group, window_start, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, endpoint_group, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [user.id, config.group, windowStart]
    )

    const count = result.rows[0]?.count ?? 1
    const remaining = Math.max(0, config.limit - count)
    const resetAt = Math.floor(windowStart.getTime() / 1000) + config.windowSeconds

    c.header('X-RateLimit-Limit', String(config.limit))
    c.header('X-RateLimit-Remaining', String(remaining))
    c.header('X-RateLimit-Reset', String(resetAt))

    if (count > config.limit) {
      c.header('X-RateLimit-RetryAfter', String(resetAt - Math.floor(Date.now() / 1000)))
      throw new HTTPException(429, { message: 'RATE_LIMITED' })
    }

    await next()
  })
}
