import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { createPipelineUpload, getPipelineUploadById, updatePipelineUpload } from '@cslate/db'
import { storePipelineUploadFiles } from '@cslate/storage'
import { enqueuePipelineReviewJob } from '@cslate/queue'
import { PipelineManifestSchema } from '@cslate/pipeline'
import { authMiddleware } from '../middleware/auth'
import { rateLimitMiddleware } from '../middleware/rate-limit'
import { streamUploadProgress } from '../lib/sse'

export const pipelineUploadRoutes = new Hono()

// POST /api/v1/pipelines/upload
pipelineUploadRoutes.post(
  '/',
  authMiddleware,
  rateLimitMiddleware('upload'),
  zValidator('json', z.object({
    manifest: PipelineManifestSchema,
    files: z.record(z.string(), z.string()),
  })),
  async (c) => {
    const user = c.get('user')
    const { manifest, files } = c.req.valid('json')

    // Validate pipeline.ts exists
    if (!('pipeline.ts' in files)) {
      throw new HTTPException(400, { message: 'MISSING_PIPELINE_ENTRY' })
    }

    // Check total size (~2MB)
    const totalSize = Object.values(files).reduce((acc, content) => acc + content.length, 0)
    if (totalSize > 2 * 1024 * 1024) {
      throw new HTTPException(413, { message: 'UPLOAD_TOO_LARGE' })
    }

    const upload = await createPipelineUpload({
      authorId: user.id,
      manifest,
      storageKey: '',
    })

    const storageKey = await storePipelineUploadFiles(upload.id, files)
    await updatePipelineUpload(upload.id, { storageKey })

    await enqueuePipelineReviewJob({ uploadId: upload.id })

    return c.json({ uploadId: upload.id, status: 'pending' }, 202)
  }
)

// GET /api/v1/pipelines/upload/:id/status
pipelineUploadRoutes.get(
  '/:id/status',
  authMiddleware,
  async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    const upload = await getPipelineUploadById(id)
    if (!upload) throw new HTTPException(404, { message: 'NOT_FOUND' })
    if (upload.authorId !== user.id) throw new HTTPException(403, { message: 'FORBIDDEN' })

    return c.json({
      uploadId: upload.id,
      status: upload.status,
      currentStage: upload.currentStage,
      completedStages: upload.completedStages,
      rejectionReasons: upload.rejectionReasons ?? undefined,
      pipelineId: upload.pipelineId ?? undefined,
    })
  }
)

// GET /api/v1/pipelines/upload/:id/stream (SSE)
pipelineUploadRoutes.get(
  '/:id/stream',
  authMiddleware,
  async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    const upload = await getPipelineUploadById(id)
    if (!upload) throw new HTTPException(404, { message: 'NOT_FOUND' })
    if (upload.authorId !== user.id) throw new HTTPException(403, { message: 'FORBIDDEN' })

    if (upload.status === 'approved' || upload.status === 'rejected') {
      return c.json({
        status: upload.status,
        pipelineId: upload.pipelineId,
        rejectionReasons: upload.rejectionReasons,
      })
    }

    return streamUploadProgress(c, id)
  }
)
