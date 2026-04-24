import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { getDb } from '@cslate/db'
import { uploads, reviewCosts, reviewerConfig } from '@cslate/db'
import { desc, gte, sum, count, eq } from 'drizzle-orm'
import { adminMiddleware } from '../middleware/admin'
import { log } from '../lib/logger'

export const adminRoutes = new Hono()

// All admin routes require the admin API key
adminRoutes.use('*', adminMiddleware)

// GET /api/v1/admin/status
// Returns a snapshot of server health, queue state, uploads, and costs.
adminRoutes.get('/status', async (c) => {
  const db = getDb()

  // Upload counts by status
  const uploadCounts = await db
    .select({ status: uploads.status, count: count() })
    .from(uploads)
    .groupBy(uploads.status)

  // Recent uploads (last 10)
  const recentUploads = await db
    .select({
      id: uploads.id,
      status: uploads.status,
      currentStage: uploads.currentStage,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .orderBy(desc(uploads.createdAt))
    .limit(10)

  // Queue depth from pg-boss tables (created by pg-boss library, not in Drizzle schema)
  const queueState = await db.execute(sql`
    SELECT
      name AS job_name,
      state,
      COUNT(*)::int AS count
    FROM pgboss.job
    WHERE state IN ('created', 'retry', 'active', 'cancelled', 'failed')
    GROUP BY name, state
    ORDER BY name, state
  `)

  // Today's LLM cost
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const todayCostRows = await db
    .select({ total: sum(reviewCosts.estimatedCost) })
    .from(reviewCosts)
    .where(gte(reviewCosts.createdAt, startOfDay))
  const todayCost = Number(todayCostRows[0]?.total ?? 0)

  // Today's token usage
  const todayTokens = await db
    .select({
      totalInput: sum(reviewCosts.inputTokens),
      totalOutput: sum(reviewCosts.outputTokens),
    })
    .from(reviewCosts)
    .where(gte(reviewCosts.createdAt, startOfDay))

  // Reviewer config snapshot
  const configRows = await db.select().from(reviewerConfig).where(eq(reviewerConfig.id, 'default'))
  const config = configRows[0] ?? null

  log.info({ path: c.req.path }, 'admin status served')

  return c.json({
    uploads: {
      counts: uploadCounts.reduce(
        (acc, row) => {
          acc[row.status] = row.count
          return acc
        },
        {} as Record<string, number>,
      ),
      recent: recentUploads,
    },
    queue: queueState.rows as Array<{ job_name: string; state: string; count: number }>,
    costs: {
      todayUsd: todayCost,
      todayInputTokens: Number(todayTokens[0]?.totalInput ?? 0),
      todayOutputTokens: Number(todayTokens[0]?.totalOutput ?? 0),
    },
    config: config
      ? {
          pauseReviews: config.pauseReviews,
          maxReviewsPerHour: config.maxReviewsPerHour,
          maxLlmCostPerDay: config.maxLlmCostPerDay,
          reviewThrottleSeconds: config.reviewThrottleSeconds,
          maxConcurrentReviews: config.maxConcurrentReviews,
          modelOverrides: config.modelOverrides,
        }
      : null,
    timestamp: new Date().toISOString(),
  })
})

// GET /api/v1/admin/health
// Quick health check of all dependencies (DB, queue, storage).
adminRoutes.get('/health', async (c) => {
  const db = getDb()
  const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {}

  // DB health
  const dbStart = Date.now()
  try {
    await db.execute(sql`SELECT 1`)
    checks.database = { ok: true, latencyMs: Date.now() - dbStart }
  } catch (err) {
    checks.database = { ok: false, latencyMs: Date.now() - dbStart, error: (err as Error).message }
  }

  // Queue health (pg-boss table accessibility)
  const queueStart = Date.now()
  try {
    await db.execute(sql`SELECT 1 FROM pgboss.job LIMIT 1`)
    checks.queue = { ok: true, latencyMs: Date.now() - queueStart }
  } catch (err) {
    checks.queue = { ok: false, latencyMs: Date.now() - queueStart, error: (err as Error).message }
  }

  const allOk = Object.values(checks).every((c) => c.ok)
  const status = allOk ? 200 : 503

  log.info({ path: c.req.path, allOk, checks }, 'admin health served')

  return c.json(
    {
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    status as 200 | 503,
  )
})
