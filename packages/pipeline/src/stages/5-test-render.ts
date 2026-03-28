import { PipelineContext, StageResult, Issue } from '../types'
import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Bridge type stubs injected into each test compile
const BRIDGE_STUB = `
declare const bridge: {
  fetch: (sourceId: string, params?: Record<string, unknown>) => Promise<unknown>
  subscribe: (sourceId: string, callback: (data: unknown) => void) => () => void
  getConfig: (key: string) => string | undefined
}
`

const TSCONFIG_TEST = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['ES2022', 'DOM'],
    allowSyntheticDefaultImports: true,
  },
  include: ['**/*.ts', '**/*.tsx'],
}

export async function testRender(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()
  const tmpDir = join(tmpdir(), `cslate-render-${randomUUID()}`)

  try {
    mkdirSync(tmpDir, { recursive: true })

    // Write all uploaded files
    for (const [filename, content] of Object.entries(ctx.files)) {
      writeFileSync(join(tmpDir, filename), content)
    }

    // Write bridge type stubs
    writeFileSync(join(tmpDir, 'bridge.d.ts'), BRIDGE_STUB)

    // Write tsconfig
    writeFileSync(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify(TSCONFIG_TEST, null, 2)
    )

    // Run TypeScript compilation
    execSync('npx tsc --noEmit', { cwd: tmpDir, stdio: 'pipe' })

    return {
      stage: 'test_render',
      status: 'passed',
      duration: Date.now() - start,
    }
  } catch (err: unknown) {
    const output = (err as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString()
      ?? (err as { stderr?: Buffer; stdout?: Buffer }).stdout?.toString()
      ?? String(err)

    // Parse TypeScript error output into issues
    const issues: Issue[] = parseTypeScriptErrors(output)

    return {
      stage: 'test_render',
      status: 'failed',
      duration: Date.now() - start,
      issues,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function parseTypeScriptErrors(output: string): Issue[] {
  const issues: Issue[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    // Match: filename.tsx(42,10): error TS2345: message
    const match = line.match(/^(.+?)\((\d+),\d+\): error (TS\d+): (.+)$/)
    if (match) {
      const [, file, lineNum, , message] = match
      issues.push({
        severity: 'critical',
        file: file?.replace(/^.*\//, ''), // strip tmp dir path
        line: lineNum ? parseInt(lineNum, 10) : undefined,
        message: message ?? line,
      })
    }
  }

  if (issues.length === 0 && output.trim()) {
    issues.push({ severity: 'critical', message: output.trim() })
  }

  return issues
}
