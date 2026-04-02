import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { createCheckpoint, getCheckpoints, getCheckpoint, deleteCheckpoint, countUserCheckpoints } from '@cslate/db'
import { storeCheckpointFiles, getCheckpointFiles, deleteCheckpointFiles } from '@cslate/storage'
import { authMiddleware } from '../middleware/auth'
import { rateLimitMiddleware } from '../middleware/rate-limit'

const MAX_CHECKPOINTS = 500

export const checkpointRoutes = new Hono()

// POST /api/v1/checkpoints
checkpointRoutes.post(
  '/',
  authMiddleware,
  rateLimitMiddleware('checkpoint_write'),
  zValidator('json', z.object({
    projectId: z.string().min(1),
    componentLocalId: z.string().min(1),
    componentName: z.string().min(1),
    version: z.number().int().positive(),
    files: z.record(z.string(), z.string()),
    manifest: z.record(z.string(), z.unknown()),
    description: z.string().min(1).max(500),
    trigger: z.enum(['user-accepted', 'manual', 'before-major-change', 'auto-interval']),
  })),
  async (c) => {
    const user = c.get('user')
    const data = c.req.valid('json')

    // Quota check
    const count = await countUserCheckpoints(user.id)
    if (count >= MAX_CHECKPOINTS) {
      throw new HTTPException(413, { message: 'QUOTA_EXCEEDED' })
    }

    const storageKey = await storeCheckpointFiles(
      user.id,
      data.projectId,
      data.componentLocalId,
      data.version,
      data.files
    )

    const checkpoint = await createCheckpoint({
      userId: user.id,
      projectId: data.projectId,
      componentLocalId: data.componentLocalId,
      componentName: data.componentName,
      version: data.version,
      manifest: data.manifest,
      storageKey,
      description: data.description,
      trigger: data.trigger,
    })

    return c.json({ id: checkpoint.id, createdAt: checkpoint.createdAt }, 201)
  }
)

// GET /api/v1/checkpoints/:componentLocalId
checkpointRoutes.get(
  '/:componentLocalId',
  authMiddleware,
  rateLimitMiddleware('checkpoint_read'),
  zValidator('query', z.object({ projectId: z.string().min(1) })),
  async (c) => {
    const user = c.get('user')
    const componentLocalId = c.req.param('componentLocalId')
    const { projectId } = c.req.valid('query')

    const cps = await getCheckpoints(user.id, projectId, componentLocalId)
    const componentName = cps[0]?.componentName ?? componentLocalId

    return c.json({
      componentName,
      checkpoints: cps.map(cp => ({
        id: cp.id,
        version: cp.version,
        description: cp.description,
        trigger: cp.trigger,
        createdAt: cp.createdAt,
      })),
    })
  }
)

// GET /api/v1/checkpoints/:componentLocalId/:version
checkpointRoutes.get(
  '/:componentLocalId/:version',
  authMiddleware,
  rateLimitMiddleware('checkpoint_read'),
  zValidator('query', z.object({ projectId: z.string().min(1) })),
  async (c) => {
    const user = c.get('user')
    const componentLocalId = c.req.param('componentLocalId')
    const version = parseInt(c.req.param('version') ?? '0', 10)
    const { projectId } = c.req.valid('query')

    const cp = await getCheckpoint(user.id, projectId, componentLocalId, version)
    if (!cp) throw new HTTPException(404, { message: 'NOT_FOUND' })

    const files = await getCheckpointFiles(cp.storageKey)

    return c.json({ ...cp, files })
  }
)

// DELETE /api/v1/checkpoints/:componentLocalId/:version
checkpointRoutes.delete(
  '/:componentLocalId/:version',
  authMiddleware,
  zValidator('query', z.object({ projectId: z.string().min(1) })),
  async (c) => {
    const user = c.get('user')
    const componentLocalId = c.req.param('componentLocalId')
    const version = parseInt(c.req.param('version') ?? '0', 10)
    const { projectId } = c.req.valid('query')

    const cp = await getCheckpoint(user.id, projectId, componentLocalId, version)
    if (!cp) throw new HTTPException(404, { message: 'NOT_FOUND' })

    await deleteCheckpointFiles(cp.storageKey)
    await deleteCheckpoint(user.id, projectId, componentLocalId, version)

    return c.body(null, 204)
  }
)
