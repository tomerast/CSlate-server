import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { getPool } from '@cslate/db'
import { getUserByEmail, createUser, updateUser, deleteUser } from '@cslate/db'
import { generateApiKey, hashApiKey, generateVerificationToken } from '../lib/auth-token'
import { sendVerificationEmail, sendRecoveryEmail } from '../lib/email'
import { authMiddleware } from '../middleware/auth'

// In-memory store for pending tokens (use Redis/DB in prod, fine for MVP)
const pendingRegistrations = new Map<string, { email: string; expiresAt: number }>()
const pendingRecoveries = new Map<string, { email: string; expiresAt: number }>()

// Clean expired tokens every 5 minutes to prevent memory accumulation
setInterval(() => {
  const now = Date.now()
  for (const [token, data] of pendingRegistrations) {
    if (data.expiresAt < now) pendingRegistrations.delete(token)
  }
  for (const [token, data] of pendingRecoveries) {
    if (data.expiresAt < now) pendingRecoveries.delete(token)
  }
}, 5 * 60 * 1000).unref() // .unref() so this doesn't prevent process exit

const TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes

export const authRoutes = new Hono()

// POST /api/v1/auth/register
authRoutes.post(
  '/register',
  zValidator('json', z.object({ email: z.string().email() })),
  async (c) => {
    const { email } = c.req.valid('json')

    // Dev shortcut: skip email flow
    if (process.env.DEV_SKIP_EMAIL_VERIFY === 'true') {
      const existing = await getUserByEmail(email)
      if (existing) {
        const apiKey = generateApiKey()
        const user = await updateUser(existing.id, { apiKeyHash: hashApiKey(apiKey) })
        return c.json({ apiKey, user: { id: user.id, email: user.email, displayName: user.displayName } }, 200)
      }
      const apiKey = generateApiKey()
      const user = await createUser({ email, apiKeyHash: hashApiKey(apiKey) })
      return c.json({ apiKey, user: { id: user.id, email: user.email, displayName: user.displayName } }, 201)
    }

    // Check if already registered
    const existing = await getUserByEmail(email)
    if (existing) {
      // Treat as re-registration (resend verification)
    }

    const token = generateVerificationToken()
    pendingRegistrations.set(token, { email, expiresAt: Date.now() + TOKEN_TTL_MS })
    await sendVerificationEmail(email, token)

    return c.json({ message: 'Verification email sent' }, 200)
  }
)

// POST /api/v1/auth/verify
authRoutes.post(
  '/verify',
  zValidator('json', z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid('json')
    const pending = pendingRegistrations.get(token)

    if (!pending || pending.expiresAt < Date.now()) {
      throw new HTTPException(400, { message: 'INVALID_OR_EXPIRED_TOKEN' })
    }

    pendingRegistrations.delete(token)

    const apiKey = generateApiKey()
    const existing = await getUserByEmail(pending.email)
    let user
    if (existing) {
      user = await updateUser(existing.id, { apiKeyHash: hashApiKey(apiKey) })
    } else {
      user = await createUser({ email: pending.email, apiKeyHash: hashApiKey(apiKey) })
    }

    return c.json({ apiKey, user: { id: user.id, email: user.email, displayName: user.displayName } }, 200)
  }
)

// POST /api/v1/auth/recover
authRoutes.post(
  '/recover',
  zValidator('json', z.object({ email: z.string().email() })),
  async (c) => {
    const { email } = c.req.valid('json')
    const user = await getUserByEmail(email)

    // Always return success to prevent email enumeration
    if (user) {
      const token = generateVerificationToken()
      pendingRecoveries.set(token, { email, expiresAt: Date.now() + TOKEN_TTL_MS })
      await sendRecoveryEmail(email, token)
    }

    return c.json({ message: 'Recovery email sent if account exists' }, 200)
  }
)

// POST /api/v1/auth/recover/confirm
authRoutes.post(
  '/recover/confirm',
  zValidator('json', z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid('json')
    const pending = pendingRecoveries.get(token)

    if (!pending || pending.expiresAt < Date.now()) {
      throw new HTTPException(400, { message: 'INVALID_OR_EXPIRED_TOKEN' })
    }

    pendingRecoveries.delete(token)

    const user = await getUserByEmail(pending.email)
    if (!user) throw new HTTPException(404, { message: 'NOT_FOUND' })

    const apiKey = generateApiKey()
    await updateUser(user.id, { apiKeyHash: hashApiKey(apiKey) })

    return c.json({ apiKey }, 200)
  }
)

// POST /api/v1/auth/regenerate (authenticated)
authRoutes.post('/regenerate', authMiddleware, async (c) => {
  const user = c.get('user')
  const apiKey = generateApiKey()
  await updateUser(user.id, { apiKeyHash: hashApiKey(apiKey) })
  return c.json({ apiKey }, 200)
})

// DELETE /api/v1/auth/account (authenticated)
authRoutes.delete('/account', authMiddleware, async (c) => {
  const user = c.get('user')
  await deleteUser(user.id)
  return c.body(null, 204)
})
