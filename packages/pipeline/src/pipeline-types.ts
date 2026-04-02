import { z } from 'zod'
import type { StageResult, Issue } from './types'

// Re-export shared types so pipeline stages only import from pipeline-types
export type { StageResult, Issue }

// ─── PipelineManifest ────────────────────────────────────────────────────────

export const PipelineManifestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  tags: z.array(z.string()).min(1).max(20),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),

  secrets: z.record(
    z.object({
      description: z.string(),
      required: z.boolean(),
    }),
  ),

  params: z.record(
    z.object({
      type: z.enum(['string', 'number', 'boolean', 'object']),
      description: z.string(),
      required: z.boolean(),
      default: z.unknown().optional(),
    }),
  ),

  outputSchema: z.record(
    z.object({
      type: z.string(),
      description: z.string(),
    }),
  ),

  strategy: z.object({
    type: z.enum(['on-demand', 'polling', 'streaming']),
    intervalMs: z.number().int().positive().optional(),
    cacheTtlMs: z.number().int().min(0).optional(),
  }),

  files: z.array(z.string()).min(1),
})

export type PipelineManifest = z.infer<typeof PipelineManifestSchema>

// ─── PipelineReviewContext ────────────────────────────────────────────────────

export interface PipelineReviewContext {
  uploadId: string
  manifest: PipelineManifest
  files: Record<string, string>
  previousResults: StageResult[]
}
