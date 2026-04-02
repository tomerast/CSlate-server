import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { getUserByApiKeyHash } from '@cslate/db'
import { hashApiKey } from '../lib/auth-token'
import type { User } from '@cslate/db'

type Variables = {
  user: User
}

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('ApiKey ')) {
    throw new HTTPException(401, { message: 'AUTH_REQUIRED' })
  }
  const key = header.slice(7)
  const hash = hashApiKey(key)
  const user = await getUserByApiKeyHash(hash)
  if (!user) {
    throw new HTTPException(401, { message: 'AUTH_REQUIRED' })
  }
  c.set('user', user)
  await next()
})
