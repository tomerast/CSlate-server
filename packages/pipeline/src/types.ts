import { z } from 'zod'

// ─── ComponentManifest ────────────────────────────────────────────────────────
// This mirrors @cslate/shared ComponentManifest schema.
// When @cslate/shared is published, import from there instead.

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

// ─── PipelineManifest ─────────────────────────────────────────────────────────

const SecretFieldSchema = z.object({
  description: z.string(),
  required: z.boolean(),
})

const ParamFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object']),
  description: z.string(),
  required: z.boolean(),
  default: z.unknown().optional(),
})

const OutputFieldSchema = z.object({
  type: z.string(),
  description: z.string(),
})

const StrategySchema = z.object({
  type: z.enum(['on-demand', 'polling', 'streaming']),
  intervalMs: z.number().int().positive().optional(),
  cacheTtlMs: z.number().int().positive().optional(),
})

export const PipelineManifestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  tags: z.array(z.string()).min(1).max(20),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  files: z.array(z.string()).min(1),
  secrets: z.record(SecretFieldSchema).optional().default({}),
  params: z.record(ParamFieldSchema).optional().default({}),
  outputSchema: z.record(OutputFieldSchema).optional().default({}),
  strategy: StrategySchema,
})

export type PipelineManifest = z.infer<typeof PipelineManifestSchema>
