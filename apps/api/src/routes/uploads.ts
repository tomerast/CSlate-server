import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { createUpload, getUploadById, updateUpload } from '@cslate/db'
import { storeUploadFiles } from '@cslate/storage'
import { enqueueReviewJob } from '@cslate/queue'
import { ComponentManifestSchema } from '@cslate/pipeline'
import { authMiddleware } from '../middleware/auth'
import { rateLimitMiddleware } from '../middleware/rate-limit'
import { streamUploadProgress } from '../lib/sse'

export const uploadRoutes = new Hono()

// POST /api/v1/components/upload
uploadRoutes.post(
  '/upload',
  authMiddleware,
  rateLimitMiddleware('upload'),
  zValidator('json', z.object({
    manifest: ComponentManifestSchema,
    files: z.record(z.string(), z.string()),
  })),
  async (c) => {
    const user = c.get('user')
    const { manifest, files } = c.req.valid('json')

    // Check total size (~2MB)
    const totalSize = Object.values(files).reduce((acc, content) => acc + content.length, 0)
    if (totalSize > 2 * 1024 * 1024) {
      throw new HTTPException(413, { message: 'UPLOAD_TOO_LARGE' })
    }

    // Store files in R2
    const upload = await createUpload({
      authorId: user.id,
      manifest,
      storageKey: '', // temporary, will update after we have the ID
    })

    const storageKey = await storeUploadFiles(upload.id, files)
    await updateUpload(upload.id, { storageKey })

    // Enqueue review job
    await enqueueReviewJob({ uploadId: upload.id })

    return c.json({ uploadId: upload.id, status: 'pending' }, 202)
  }
)

// GET /api/v1/components/upload/:id/status
uploadRoutes.get(
  '/upload/:id/status',
  authMiddleware,
  async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    const upload = await getUploadById(id)
    if (!upload) throw new HTTPException(404, { message: 'NOT_FOUND' })
    if (upload.authorId !== user.id) throw new HTTPException(403, { message: 'FORBIDDEN' })

    return c.json({
      uploadId: upload.id,
      status: upload.status,
      currentStage: upload.currentStage,
      completedStages: upload.completedStages,
      rejectionReasons: upload.rejectionReasons ?? undefined,
      componentId: upload.componentId ?? undefined,
    })
  }
)

// GET /api/v1/components/upload/:id/stream (SSE)
uploadRoutes.get(
  '/upload/:id/stream',
  authMiddleware,
  async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    const upload = await getUploadById(id)
    if (!upload) throw new HTTPException(404, { message: 'NOT_FOUND' })
    if (upload.authorId !== user.id) throw new HTTPException(403, { message: 'FORBIDDEN' })

    // If already terminal, return status immediately
    if (upload.status === 'approved' || upload.status === 'rejected') {
      return c.json({
        status: upload.status,
        componentId: upload.componentId,
        rejectionReasons: upload.rejectionReasons,
      })
    }

    return streamUploadProgress(c, id)
  }
)
