#!/usr/bin/env tsx
/**
 * Live server monitor — polls the local DB and prints a dashboard.
 *
 * Usage:
 *   pnpm monitor          # start dashboard
 *   pnpm monitor --once   # single snapshot, then exit
 *
 * Press Ctrl+C to stop.
 */

import 'dotenv/config'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Copy .env.local.example to .env.local and fill in values.')
  process.exit(1)
}

const sql = postgres(DATABASE_URL)
const ONCE = process.argv.includes('--once')

interface UploadRow {
  status: string
  count: number
}

interface QueueRow {
  job_name: string
  state: string
  count: number
}

interface CostRow {
  today_usd: number
  today_input_tokens: number
  today_output_tokens: number
}

interface RecentUpload {
  id: string
  status: string
  current_stage: string | null
  created_at: Date
}

async function fetchDashboard(): Promise<{
  uploads: UploadRow[]
  queue: QueueRow[]
  costs: CostRow
  recent: RecentUpload[]
  config: { pause_reviews: boolean; max_reviews_per_hour: number; max_llm_cost_per_day: number } | null
}> {
  const uploadCounts = await sql<UploadRow[]>`
    SELECT status, COUNT(*)::int AS count
    FROM uploads
    GROUP BY status
    ORDER BY status
  `

  const queueState = await sql<QueueRow[]>`
    SELECT name AS job_name, state, COUNT(*)::int AS count
    FROM pgboss.job
    WHERE state IN ('created', 'retry', 'active', 'cancelled', 'failed')
    GROUP BY name, state
    ORDER BY name, state
  `

  const costs = await sql<CostRow[]>`
    SELECT
      COALESCE(SUM(estimated_cost), 0)::float AS today_usd,
      COALESCE(SUM(input_tokens), 0)::int AS today_input_tokens,
      COALESCE(SUM(output_tokens), 0)::int AS today_output_tokens
    FROM review_costs
    WHERE created_at >= CURRENT_DATE
  `

  const recent = await sql<RecentUpload[]>`
    SELECT id, status, current_stage AS current_stage, created_at
    FROM uploads
    ORDER BY created_at DESC
    LIMIT 10
  `

  const config = await sql<{ pause_reviews: boolean; max_reviews_per_hour: number; max_llm_cost_per_day: number }[]>`
    SELECT pause_reviews, max_reviews_per_hour, max_llm_cost_per_day
    FROM reviewer_config
    WHERE id = 'default'
    LIMIT 1
  `

  return {
    uploads: uploadCounts,
    queue: queueState,
    costs: costs[0] ?? { today_usd: 0, today_input_tokens: 0, today_output_tokens: 0 },
    recent,
    config: config[0] ?? null,
  }
}

function clearScreen() {
  process.stdout.write('\x1Bc')
}

function pad(str: string | number, width: number): string {
  return String(str).padEnd(width)
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleTimeString('en-US', { hour12: false })
}

function render(data: Awaited<ReturnType<typeof fetchDashboard>>) {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('  CSLATE SERVER MONITOR')
  lines.push(`  ${new Date().toISOString()}`)
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('')

  // Uploads
  lines.push('  UPLOADS')
  lines.push('  ─────────────────────────────────')
  if (data.uploads.length === 0) {
    lines.push('  No uploads yet.')
  } else {
    lines.push(`  ${pad('Status', 16)} ${pad('Count', 8)}`)
    lines.push(`  ${'─'.repeat(26)}`)
    for (const u of data.uploads) {
      lines.push(`  ${pad(u.status, 16)} ${pad(u.count, 8)}`)
    }
  }
  lines.push('')

  // Queue
  lines.push('  QUEUE')
  lines.push('  ─────────────────────────────────')
  if (data.queue.length === 0) {
    lines.push('  No queue jobs found.')
  } else {
    lines.push(`  ${pad('Job', 32)} ${pad('State', 12)} ${pad('Count', 8)}`)
    lines.push(`  ${'─'.repeat(54)}`)
    for (const q of data.queue) {
      lines.push(`  ${pad(q.job_name, 32)} ${pad(q.state, 12)} ${pad(q.count, 8)}`)
    }
  }
  lines.push('')

  // Costs
  lines.push('  COSTS (today)')
  lines.push('  ─────────────────────────────────')
  lines.push(`  Estimated cost:    $${data.costs.today_usd.toFixed(4)}`)
  lines.push(`  Input tokens:      ${data.costs.today_input_tokens.toLocaleString()}`)
  lines.push(`  Output tokens:     ${data.costs.today_output_tokens.toLocaleString()}`)
  lines.push('')

  // Config
  lines.push('  REVIEWER CONFIG')
  lines.push('  ─────────────────────────────────')
  if (!data.config) {
    lines.push('  No config row found.')
  } else {
    lines.push(`  Pause reviews:     ${data.config.pause_reviews ? 'YES' : 'no'}`)
    lines.push(`  Max/hour:          ${data.config.max_reviews_per_hour}`)
    lines.push(`  Max cost/day:      $${data.config.max_llm_cost_per_day}`)
  }
  lines.push('')

  // Recent uploads
  lines.push('  RECENT UPLOADS')
  lines.push('  ─────────────────────────────────')
  if (data.recent.length === 0) {
    lines.push('  No uploads yet.')
  } else {
    lines.push(`  ${pad('Time', 10)} ${pad('Status', 12)} ${pad('Stage', 18)} ID`)
    lines.push(`  ${'─'.repeat(72)}`)
    for (const r of data.recent) {
      const stage = r.current_stage ?? '—'
      lines.push(`  ${pad(formatDate(r.created_at), 10)} ${pad(r.status, 12)} ${pad(stage, 18)} ${r.id.slice(0, 8)}`)
    }
  }
  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════════════════════════')
  lines.push('  Press Ctrl+C to stop')

  return lines.join('\n')
}

async function tick() {
  try {
    const data = await fetchDashboard()
    if (!ONCE) clearScreen()
    console.log(render(data))
  } catch (err) {
    console.error('Monitor error:', (err as Error).message)
  }
}

async function main() {
  await tick()
  if (ONCE) {
    await sql.end()
    process.exit(0)
  }

  const interval = setInterval(tick, 3000)

  process.on('SIGINT', async () => {
    clearInterval(interval)
    await sql.end()
    console.log('\nMonitor stopped.')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
