import { describe, it, expect, vi } from 'vitest'

// Silence pino in tests
vi.mock('../lib/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

import { createApp } from '../app'

describe('createApp — smoke', () => {
  const app = createApp()

  it('builds without throwing', () => {
    expect(app).toBeDefined()
  })

  it('serves /health without auth', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; timestamp: string }
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow()
  })

  it('sets the API-Version header on every response', async () => {
    const res = await app.request('/health')
    expect(res.headers.get('API-Version')).toBe('1')
  })

  it('returns a uniform error envelope for unknown routes', async () => {
    const res = await app.request('/does-not-exist')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code: string; message: string } }
    expect(body.error?.code).toBe('NOT_FOUND')
    expect(typeof body.error?.message).toBe('string')
  })

  it('rejects protected routes with a structured error when unauthenticated', async () => {
    // /api/v1/components/upload requires auth; no Authorization header here.
    const res = await app.request('/api/v1/components/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: {}, files: {} }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})
