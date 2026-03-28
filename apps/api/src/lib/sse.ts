import { getListenPool } from '@cslate/db'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

export async function streamUploadProgress(c: Context, uploadId: string): Promise<Response> {
  return streamSSE(c, async (stream) => {
    const pgPool = getListenPool()
    const pgClient = await pgPool.connect()

    try {
      await pgClient.query(`LISTEN "upload:${uploadId}"`)

      await new Promise<void>((resolve) => {
        // 10-minute hard timeout
        const timeout = setTimeout(() => {
          resolve()
        }, 10 * 60 * 1000)

        pgClient.on('notification', async (msg) => {
          if (!msg.payload) return
          const progress = JSON.parse(msg.payload) as Record<string, unknown>
          await stream.writeSSE({ event: 'stage', data: JSON.stringify(progress) })

          if (progress['status'] === 'approved' || progress['status'] === 'rejected') {
            await stream.writeSSE({ event: 'complete', data: JSON.stringify(progress) })
            clearTimeout(timeout)
            resolve()
          }
        })
      })
    } finally {
      await pgClient.query('UNLISTEN *')
      pgClient.release()
    }
  })
}
