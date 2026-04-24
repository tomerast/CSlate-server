import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { log } from '../lib/logger'

const ADMIN_API_KEY = process.env.ADMIN_API_KEY

export const adminMiddleware = createMiddleware(async (c, next) => {
  if (!ADMIN_API_KEY) {
    log.warn({ path: c.req.path }, 'admin access denied: ADMIN_API_KEY not configured')
    throw new HTTPException(503, { message: 'ADMIN_NOT_CONFIGURED' })
  }

  const header = c.req.header('X-Admin-Key')
  if (!header) {
    log.warn({ path: c.req.path }, 'admin access denied: missing X-Admin-Key header')
    throw new HTTPException(401, { message: 'ADMIN_AUTH_REQUIRED' })
  }

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(ADMIN_API_KEY)
  const provided = Buffer.from(header)
  let match = expected.length === provided.length
  if (match) {
    for (let i = 0; i < expected.length; i++) {
      match &&= expected[i] === provided[i]
    }
  }

  if (!match) {
    log.warn({ path: c.req.path }, 'admin access denied: invalid key')
    throw new HTTPException(401, { message: 'ADMIN_AUTH_REQUIRED' })
  }

  await next()
})
