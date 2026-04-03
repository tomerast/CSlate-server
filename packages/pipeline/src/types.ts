import { z } from 'zod'

// ─── ComponentManifest (upload/catalog schema) ────────────────────────────────
// This is the server-side upload contract, intentionally different from
// @cslate/shared ComponentManifestSchema (the client-side source format).
//
// Key differences from the shared schema:
//   - inputs/outputs/events/actions: arrays here (shared uses records)
//   - dataSources: simple array (shared uses a record with endpoint detail)
//   - files: array of filename strings (shared uses FileEntry objects)
//   - title: added for catalog display (shared only has `name` as slug)
//   - version: required semver (shared treats it as optional)
//
// The client normalizes its manifest.json to this format before uploading
// (see CSlateServerClient.normalizeManifest).

const DataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  baseUrl: z.string().url(),
  authType: z.enum(['none', 'apiKey', 'oauth2']).optional(),
})

const InputSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
})

const OutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
})

const SizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const UserConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'secret']),
  description: z.string().optional(),
  required: z.boolean().optional(),
})

export const ComponentManifestSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  files: z.array(z.string()).min(1),
  defaultSize: SizeSchema,
  minSize: SizeSchema.optional(),
  tags: z.array(z.string()).min(1).max(20),
  dataSources: z.array(DataSourceSchema).optional(),
  inputs: z.array(InputSchema).optional(),
  outputs: z.array(OutputSchema).optional(),
  events: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  actions: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  userConfig: z.array(UserConfigFieldSchema).optional(),
  dependencies: z.object({
    npmPackages: z.record(z.string()).optional(),
    cslateComponents: z.array(z.string()).optional(),
  }).optional(),
  ai: z.object({
    modificationHints: z.array(z.string()).optional(),
    extensionPoints: z.array(z.string()).optional(),
    similarTo: z.array(z.string()).optional(),
  }).optional(),
})

export type ComponentManifest = z.infer<typeof ComponentManifestSchema>

// ─── Pipeline Types ───────────────────────────────────────────────────────────

export interface PipelineContext {
  uploadId: string
  manifest: ComponentManifest
  files: Record<string, string>  // filename → content
  previousResults: StageResult[]
}

export interface Issue {
  severity: 'critical' | 'warning' | 'info'
  file?: string
  line?: number
  pattern?: string
  message: string
  fix?: string
}

export interface StageResult {
  stage: string
  status: 'passed' | 'failed' | 'warning'
  duration: number  // ms
  issues?: Issue[]
  data?: Record<string, unknown>
}

export interface PipelineResult {
  status: 'approved' | 'rejected'
  completedStages: StageResult[]
}

export interface StageProgress {
  stage: string
  status: 'in_progress' | 'complete' | 'failed'
  completedStages?: StageResult[]
  result?: StageResult
  issues?: Issue[]
}

export type StageFunction = (ctx: PipelineContext) => Promise<StageResult>
export type ProgressCallback = (progress: StageProgress) => Promise<void>

// PipelineManifest types are in pipeline-types.ts — import from there
