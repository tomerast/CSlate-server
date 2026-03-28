import 'dotenv/config'
import pino from 'pino'
import { getBoss, stopBoss, JOB_NAMES, registerMaintenanceSchedules } from '@cslate/queue'
import { reviewHandler } from './handlers/review'
import { cleanupHandler } from './handlers/maintenance'

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
})

async function main() {
  log.info('Starting CSlate worker...')

  const boss = await getBoss()

  // Register review job handler
  await boss.work(
    JOB_NAMES.REVIEW_COMPONENT,
    { teamConcurrency: 5 },
    reviewHandler
  )

  // Register maintenance job handlers
  await boss.work(JOB_NAMES.CLEANUP_FAILED_UPLOADS, cleanupHandler)
  await boss.work(JOB_NAMES.CREATE_PARTITION, async () => {
    await createNextMonthPartition()
  })
  await boss.work(JOB_NAMES.DROP_OLD_PARTITIONS, async () => {
    await dropOldPartitions()
  })

  // Schedule maintenance jobs
  await registerMaintenanceSchedules()

  log.info('Worker ready — listening for jobs')

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    log.info('Received SIGTERM, shutting down worker...')
    await stopBoss()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    log.info('Received SIGINT, shutting down worker...')
    await stopBoss()
    process.exit(0)
  })
}

async function createNextMonthPartition() {
  const { getPool } = await import('@cslate/db')
  const pool = getPool()
  const nextMonth = new Date()
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  const start = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1)
  const end = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 1)
  const name = `download_events_${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, '0')}`

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${name} PARTITION OF download_events
    FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')
  `)
  log.info({ partition: name }, 'Created next month partition')
}

async function dropOldPartitions() {
  const { getPool } = await import('@cslate/db')
  const pool = getPool()
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)

  const res = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE tablename LIKE 'download_events_%' AND schemaname = 'public'`
  )

  for (const row of res.rows) {
    const match = row.tablename.match(/download_events_(\d{4})_(\d{2})/)
    if (!match) continue
    const year = parseInt(match[1] ?? '0', 10)
    const month = parseInt(match[2] ?? '0', 10)
    const partitionDate = new Date(year, month - 1, 1)
    if (partitionDate < cutoff) {
      await pool.query(`DROP TABLE IF EXISTS ${row.tablename}`)
      log.info({ partition: row.tablename }, 'Dropped old partition')
    }
  }
}

main().catch((err) => {
  log.error({ err }, 'Worker failed to start')
  process.exit(1)
})
