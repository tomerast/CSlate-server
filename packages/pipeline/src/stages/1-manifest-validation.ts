import { PipelineContext, StageResult, Issue, ComponentManifestSchema } from '../types'

const REQUIRED_FILES = ['ui.tsx', 'logic.ts', 'types.ts', 'index.ts']
const OPTIONAL_FILES = ['context.md']
const MAX_CONTEXT_MD_LENGTH = 2000
const MAX_DATA_SOURCES = 5

const TAILWIND_COLOR_REGEX = /\b(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

export async function manifestValidation(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()
  const issues: Issue[] = []

  // 1. Validate manifest schema with Zod
  const parseResult = ComponentManifestSchema.safeParse(ctx.manifest)
  if (!parseResult.success) {
    const zodIssues: Issue[] = parseResult.error.issues.map(issue => ({
      severity: 'critical' as const,
      message: `Manifest validation: ${issue.path.join('.')} — ${issue.message}`,
    }))
    return {
      stage: 'manifest_validation',
      status: 'failed',
      duration: Date.now() - start,
      issues: zodIssues,
    }
  }

  const manifest = parseResult.data

  // 2. Check all declared files exist in uploaded files
  for (const filename of manifest.files) {
    if (!ctx.files[filename]) {
      issues.push({
        severity: 'critical',
        file: filename,
        message: `File declared in manifest.files but not uploaded: ${filename}`,
      })
    }
  }

  // 3. Check required files exist
  for (const required of REQUIRED_FILES) {
    if (!ctx.files[required]) {
      issues.push({
        severity: 'critical',
        file: required,
        message: `Required file missing: ${required}`,
      })
    }
  }

  // 4. Check index.ts has barrel exports (basic check)
  const indexTs = ctx.files['index.ts']
  if (indexTs && !indexTs.includes('export')) {
    issues.push({
      severity: 'critical',
      file: 'index.ts',
      message: 'index.ts must contain barrel exports',
    })
  }

  // 5. Validate defaultSize and minSize use {width, height} format
  if (manifest.defaultSize) {
    const s = manifest.defaultSize
    if (typeof s.width !== 'number' || typeof s.height !== 'number') {
      issues.push({
        severity: 'critical',
        message: 'defaultSize must use { width: number, height: number } format (grid units ×8px)',
      })
    }
  }

  // 6. Check dataSources count
  if (manifest.dataSources && manifest.dataSources.length > MAX_DATA_SOURCES) {
    issues.push({
      severity: 'critical',
      message: `TOO_MANY_DATA_SOURCES: dataSources count (${manifest.dataSources.length}) exceeds maximum of ${MAX_DATA_SOURCES}`,
      pattern: 'TOO_MANY_DATA_SOURCES',
    })
  }

  // 7. Check context.md length
  const contextMd = ctx.files['context.md']
  if (contextMd && contextMd.length > MAX_CONTEXT_MD_LENGTH) {
    issues.push({
      severity: 'critical',
      file: 'context.md',
      message: `context.md exceeds maximum length of ${MAX_CONTEXT_MD_LENGTH} characters (got ${contextMd.length}). It should be an AI-generated summary, not raw chat history.`,
    })
  }

  // 8. Check for no unknown files (warn only)
  const allKnownFiles = new Set([...REQUIRED_FILES, ...OPTIONAL_FILES])
  for (const filename of Object.keys(ctx.files)) {
    if (!allKnownFiles.has(filename) && !manifest.files.includes(filename)) {
      issues.push({
        severity: 'warning',
        file: filename,
        message: `Unexpected file not declared in manifest.files: ${filename}`,
      })
    }
  }

  const criticalIssues = issues.filter(i => i.severity === 'critical')
  return {
    stage: 'manifest_validation',
    status: criticalIssues.length > 0 ? 'failed' : issues.some(i => i.severity === 'warning') ? 'warning' : 'passed',
    duration: Date.now() - start,
    issues: issues.length > 0 ? issues : undefined,
  }
}
