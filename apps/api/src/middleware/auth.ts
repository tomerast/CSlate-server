import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getUserByApiKeyHash } from '@cslate/db'
import { hashApiKey } from '../lib/auth-token'
import { log } from '../lib/logger'
import type { User } from '@cslate/db'

type Variables = {
  user: User
}

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('ApiKey ')) {
    log.warn({ path: c.req.path }, 'auth failed: missing or malformed Authorization header')
    throw new HTTPException(401, { message: 'AUTH_REQUIRED' })
  }
  const key = header.slice(7)
  const keyPrefix = key.slice(0, 12) + '...'
  const hash = hashApiKey(key)
  const user = await getUserByApiKeyHash(hash)
  if (!user) {
    log.warn({ path: c.req.path, keyPrefix }, 'auth failed: key not found')
    throw new HTTPException(401, { message: 'AUTH_REQUIRED' })
  }
  log.debug({ userId: user.id, keyPrefix, path: c.req.path }, 'auth ok')
  c.set('user', user)
  await next()
})
