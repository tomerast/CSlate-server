import { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getListenPool } from '@cslate/db'
import type { PoolClient } from 'pg'

export async function streamUploadProgress(c: Context, uploadId: string): Promise<Response> {
  return streamSSE(c, async (stream) => {
    const pgPool = getListenPool()
    let pgClient: PoolClient | null = null

    try {
      pgClient = await pgPool.connect()
      await pgClient.query(`LISTEN "upload:${uploadId}"`)

      const timeout = setTimeout(() => {
        pgClient?.release()
        pgClient = null
      }, 10 * 60 * 1000) // 10 min max

      pgClient.on('notification', async (msg) => {
        if (!msg.payload) return
        const progress = JSON.parse(msg.payload) as Record<string, unknown>
        await stream.writeSSE({ event: 'stage', data: JSON.stringify(progress) })

        if (progress['status'] === 'approved' || progress['status'] === 'rejected') {
          await stream.writeSSE({ event: 'complete', data: JSON.stringify(progress) })
          clearTimeout(timeout)
          pgClient?.release()
          pgClient = null
        }
      })

      await stream.close()
    } finally {
      if (pgClient) pgClient.release()
    }
  })
}
