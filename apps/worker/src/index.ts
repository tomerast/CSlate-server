import 'dotenv/config'
import pino from 'pino'
import { getBoss, stopBoss, JOB_NAMES, registerMaintenanceSchedules, PIPELINE_REVIEW_JOB } from '@cslate/queue'
import { reviewHandler } from './handlers/review'
import { cleanupHandler } from './handlers/maintenance'
import { pipelineReviewHandler } from './handlers/pipeline-review'

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

  // Register pipeline review handler
  await boss.work(
    PIPELINE_REVIEW_JOB,
    { teamConcurrency: 3 },
    pipelineReviewHandler,
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
  const startStr = start.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)
  const year = String(start.getFullYear())
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const partitionName = `download_events_${year}_${month}`

  // Safe: name is constructed from date arithmetic, pattern validated
  if (!/^download_events_\d{4}_\d{2}$/.test(partitionName)) {
    log.error({ partitionName }, 'Invalid partition name — skipping')
    return
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF download_events FOR VALUES FROM ($1) TO ($2)`,
    [startStr, endStr]
  )
  log.info({ partition: partitionName }, 'Created next month partition')
}

async function dropOldPartitions() {
  const { getPool } = await import('@cslate/db')
  const pool = getPool()
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)

  const res = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE tablename ~ '^download_events_\\d{4}_\\d{2}$' AND schemaname = 'public'`
  )

  for (const row of res.rows) {
    // Validate pattern before using as identifier
    if (!/^download_events_\d{4}_\d{2}$/.test(row.tablename)) continue

    const match = row.tablename.match(/download_events_(\d{4})_(\d{2})/)
    if (!match) continue
    const year = parseInt(match[1] ?? '0', 10)
    const month = parseInt(match[2] ?? '0', 10)
    const partitionDate = new Date(year, month - 1, 1)

    if (partitionDate < cutoff) {
      // Use quoted identifier — tablename is validated above
      await pool.query(`DROP TABLE IF EXISTS "${row.tablename}"`)
      log.info({ partition: row.tablename }, 'Dropped old partition')
    }
  }
}

main().catch((err) => {
  log.error({ err }, 'Worker failed to start')
  process.exit(1)
})
