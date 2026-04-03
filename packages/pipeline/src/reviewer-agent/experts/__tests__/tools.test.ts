import { describe, it, expect } from 'vitest'
import { buildExpertTools } from '../tools'
import type { StaticAnalysisResult } from '../../types'

const mockFiles: Record<string, string> = {
  'ui.tsx': 'export function App() { return <div>hello</div> }',
  'logic.ts': 'export function getData() { return bridge.fetch("source1") }',
}

const mockManifest = { name: 'TestComponent', version: '1.0.0' }

const mockStaticResult: StaticAnalysisResult = {
  criticalFindings: [
    { analyzer: 'test', dimension: 1, severity: 'critical', file: 'ui.tsx', message: 'eval found', evidence: 'eval(x)' },
  ],
  warnings: [
    { analyzer: 'test', dimension: 2, severity: 'warning', file: 'logic.ts', message: 'dynamic bridge', evidence: 'bridge.fetch(x)' },
  ],
  codeStructure: { files: {}, dependencyGraph: {}, unusedExports: [], circularDependencies: [] },
  typeCheckResult: { success: true, errors: [] },
  duration: 100,
}

describe('buildExpertTools', () => {
  it('returns 9 tools', () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    expect(tools).toHaveLength(9)
    expect(tools.map(t => t.name)).toEqual([
      'readFile', 'listFiles', 'searchCode', 'getManifest', 'analyzeComponent', 'getComponentContext', 'searchAST', 'checkPattern', 'getStaticAnalysisFindings',
    ])
  })

  it('readFile returns file content', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const readFile = tools.find(t => t.name === 'readFile')!
    const result = await readFile.call({ filename: 'ui.tsx' })
    expect(result.data).toBe(mockFiles['ui.tsx'])
  })

  it('readFile returns error for missing file', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const readFile = tools.find(t => t.name === 'readFile')!
    const result = await readFile.call({ filename: 'missing.ts' })
    expect(result.data).toContain('File not found')
    expect(result.data).toContain('ui.tsx')
  })

  it('listFiles returns all file names', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const listFiles = tools.find(t => t.name === 'listFiles')!
    const result = await listFiles.call({})
    expect(result.data).toContain('ui.tsx')
    expect(result.data).toContain('logic.ts')
  })

  it('searchCode finds pattern across files', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const searchCode = tools.find(t => t.name === 'searchCode')!
    const result = await searchCode.call({ pattern: 'bridge\\.fetch' })
    expect(result.data).toContain('logic.ts:1:')
  })

  it('searchCode returns no matches message when not found', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const searchCode = tools.find(t => t.name === 'searchCode')!
    const result = await searchCode.call({ pattern: 'eval' })
    expect(result.data).toBe('No matches found')
  })

  it('checkPattern returns context around match', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const checkPattern = tools.find(t => t.name === 'checkPattern')!
    const result = await checkPattern.call({ filename: 'logic.ts', pattern: 'bridge' })
    expect(result.data).toContain('Match at line')
    expect(result.data).toContain('bridge.fetch')
  })

  it('checkPattern returns "Pattern not found" when absent', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const checkPattern = tools.find(t => t.name === 'checkPattern')!
    const result = await checkPattern.call({ filename: 'ui.tsx', pattern: 'eval' })
    expect(result.data).toBe('Pattern not found')
  })

  it('getManifest returns JSON', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const getManifest = tools.find(t => t.name === 'getManifest')!
    const result = await getManifest.call({})
    const parsed = JSON.parse(result.data as string)
    expect(parsed.name).toBe('TestComponent')
  })

  it('getStaticAnalysisFindings returns critical findings', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const getFindings = tools.find(t => t.name === 'getStaticAnalysisFindings')!
    const result = await getFindings.call({ severity: 'critical' })
    const findings = JSON.parse(result.data as string)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
  })

  it('getStaticAnalysisFindings returns all findings', async () => {
    const tools = buildExpertTools(mockFiles, mockManifest, mockStaticResult)
    const getFindings = tools.find(t => t.name === 'getStaticAnalysisFindings')!
    const result = await getFindings.call({ severity: 'all' })
    const findings = JSON.parse(result.data as string)
    expect(findings).toHaveLength(2)
  })
})
