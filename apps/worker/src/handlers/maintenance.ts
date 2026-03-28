import type { Job } from 'pg-boss'
import { log } from '../index'
import { getPool } from '@cslate/db'
import { deleteUploadFiles } from '@cslate/storage'

export async function cleanupHandler(_job: Job): Promise<void> {
  log.info('Running cleanup: failed/rejected uploads')
  const pool = getPool()

  // Find failed uploads older than 24 hours with storage keys
  const res = await pool.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM uploads
     WHERE status = 'rejected'
       AND storage_key LIKE 'packages/uploads/%'
       AND created_at < NOW() - INTERVAL '24 hours'
     LIMIT 100`
  )

  let cleaned = 0
  for (const row of res.rows) {
    try {
      await deleteUploadFiles(row.storage_key)
      // Mark storage key as cleaned
      await pool.query(
        `UPDATE uploads SET storage_key = 'cleaned:' || id WHERE id = $1`,
        [row.id]
      )
      cleaned++
    } catch (err) {
      log.warn({ uploadId: row.id, err }, 'Failed to clean upload files')
    }
  }

  log.info({ cleaned }, 'Cleanup complete')
}
