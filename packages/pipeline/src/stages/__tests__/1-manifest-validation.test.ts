import { describe, it, expect } from 'vitest'
import { manifestValidation } from '../1-manifest-validation'
import type { PipelineContext } from '../../types'

const validManifest = {
  name: 'test-component',
  title: 'Test Component',
  description: 'A test component',
  version: '1.0.0',
  files: ['ui.tsx', 'logic.ts', 'types.ts', 'index.ts'],
  defaultSize: { width: 4, height: 3 },
  tags: ['test'],
}

const validFiles = {
  'ui.tsx': 'export function TestComponent() { return <div /> }',
  'logic.ts': 'export function useTestLogic() { return {} }',
  'types.ts': 'export interface TestProps {}',
  'index.ts': 'export { TestComponent } from "./ui"',
}

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    uploadId: 'test-upload-id',
    manifest: validManifest as PipelineContext['manifest'],
    files: validFiles,
    previousResults: [],
    ...overrides,
  }
}

describe('manifestValidation', () => {
  it('passes a valid component', async () => {
    const result = await manifestValidation(makeCtx())
    expect(result.status).toBe('passed')
    expect(result.issues).toBeUndefined()
  })

  it('fails when a declared file is missing', async () => {
    const ctx = makeCtx({
      files: { ...validFiles, 'logic.ts': undefined as unknown as string },
    })
    // Remove the key
    const files = { ...validFiles }
    delete (files as Record<string, string | undefined>)['logic.ts']
    const result = await manifestValidation(makeCtx({ files }))
    expect(result.status).toBe('failed')
    expect(result.issues?.some(i => i.message.includes('logic.ts'))).toBe(true)
  })

  it('fails when dataSources exceeds 5', async () => {
    const ctx = makeCtx({
      manifest: {
        ...validManifest,
        dataSources: Array.from({ length: 6 }, (_, i) => ({
          id: `ds${i}`,
          name: `Source ${i}`,
          baseUrl: `https://api.example${i}.com`,
        })),
      } as PipelineContext['manifest'],
    })
    const result = await manifestValidation(ctx)
    expect(result.status).toBe('failed')
    expect(result.issues?.some(i => i.message.includes('TOO_MANY_DATA_SOURCES'))).toBe(true)
  })

  it('fails when context.md exceeds 2000 characters', async () => {
    const ctx = makeCtx({
      files: { ...validFiles, 'context.md': 'x'.repeat(2001) },
    })
    const result = await manifestValidation(ctx)
    expect(result.status).toBe('failed')
    expect(result.issues?.some(i => i.file === 'context.md')).toBe(true)
  })

  it('fails manifest with invalid Zod schema', async () => {
    const ctx = makeCtx({
      manifest: { name: '', title: 'T', description: 'D', version: '1.0.0', files: ['ui.tsx'], defaultSize: { width: 4, height: 3 }, tags: [] } as unknown as PipelineContext['manifest'],
    })
    const result = await manifestValidation(ctx)
    expect(result.status).toBe('failed')
  })
})
