import { describe, it, expect } from 'vitest'
import { buildRedTeamTools } from '../tools'
import type { StaticAnalysisResult, ExpertAgentResult } from '../../types'

const mockFiles: Record<string, string> = {
  'ui.tsx': 'import React from "react"\nconst App = () => <div>Hello</div>\nexport default App',
  'logic.ts': 'export function add(a: number, b: number) { return a + b }',
  'context.md': '# My Component\nA simple hello world component.',
}

const mockManifest = { name: 'test-component', version: '1.0.0', dataSources: [] }

const mockStaticResult: StaticAnalysisResult = {
  criticalFindings: [],
  warnings: [],
  codeStructure: {
    files: {},
    dependencyGraph: {},
    unusedExports: [],
    circularDependencies: [],
  },
  typeCheckResult: { success: true, errors: [] },
  duration: 100,
}

const mockExpertResults: ExpertAgentResult[] = [
  {
    agent: 'security',
    dimensions: [],
    findings: [
      {
        dimension: 1,
        severity: 'warning',
        confidence: 80,
        title: 'Suspicious fetch usage',
        description: 'Dynamic fetch pattern detected',
        file: 'logic.ts',
        line: 5,
        evidence: 'fetch(dynamicUrl)',
        reasoning: 'Could exfiltrate data',
        verifiedByTool: true,
      },
    ],
    iterationsUsed: 3,
    tokenCost: { input: 1000, output: 500 },
  },
]

describe('buildRedTeamTools', () => {
  const tools = buildRedTeamTools(mockFiles, mockManifest, mockStaticResult, mockExpertResults)

  it('returns an array of tools', () => {
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
  })

  it('includes readFile tool', () => {
    const tool = tools.find(t => t.name === 'readFile')
    expect(tool).toBeDefined()
  })

  it('includes listFiles tool', () => {
    const tool = tools.find(t => t.name === 'listFiles')
    expect(tool).toBeDefined()
  })

  it('includes searchCode tool', () => {
    const tool = tools.find(t => t.name === 'searchCode')
    expect(tool).toBeDefined()
  })

  it('includes getBridgeAPISpec tool', () => {
    const tool = tools.find(t => t.name === 'getBridgeAPISpec')
    expect(tool).toBeDefined()
  })

  it('includes getPlatformConstraints tool', () => {
    const tool = tools.find(t => t.name === 'getPlatformConstraints')
    expect(tool).toBeDefined()
  })

  it('includes getExpertFindings tool', () => {
    const tool = tools.find(t => t.name === 'getExpertFindings')
    expect(tool).toBeDefined()
  })

  it('includes getManifest tool', () => {
    const tool = tools.find(t => t.name === 'getManifest')
    expect(tool).toBeDefined()
  })

  describe('readFile tool', () => {
    it('returns file content for existing files', async () => {
      const tool = tools.find(t => t.name === 'readFile')!
      const result = await tool.call({ filename: 'ui.tsx' })
      expect(result.data).toContain('Hello')
    })

    it('returns error message for missing files', async () => {
      const tool = tools.find(t => t.name === 'readFile')!
      const result = await tool.call({ filename: 'missing.ts' })
      expect(result.data).toContain('File not found')
      expect(result.data).toContain('ui.tsx')
    })

    it('is read-only', () => {
      const tool = tools.find(t => t.name === 'readFile')!
      expect(tool.isReadOnly({ filename: 'ui.tsx' })).toBe(true)
    })
  })

  describe('listFiles tool', () => {
    it('returns all file names', async () => {
      const tool = tools.find(t => t.name === 'listFiles')!
      const result = await tool.call({})
      expect(result.data).toContain('ui.tsx')
      expect(result.data).toContain('logic.ts')
      expect(result.data).toContain('context.md')
    })
  })

  describe('searchCode tool', () => {
    it('finds matching lines across all files', async () => {
      const tool = tools.find(t => t.name === 'searchCode')!
      const result = await tool.call({ pattern: 'import' })
      expect(result.data).toContain('ui.tsx')
    })

    it('returns "No matches" when pattern not found', async () => {
      const tool = tools.find(t => t.name === 'searchCode')!
      const result = await tool.call({ pattern: 'XYZNOTFOUND' })
      expect(result.data).toBe('No matches')
    })

    it('searches only specified file when filename is given', async () => {
      const tool = tools.find(t => t.name === 'searchCode')!
      const result = await tool.call({ pattern: 'add', filename: 'logic.ts' })
      expect(result.data).toContain('logic.ts')
    })
  })

  describe('getBridgeAPISpec tool', () => {
    it('returns the bridge API spec', async () => {
      const tool = tools.find(t => t.name === 'getBridgeAPISpec')!
      const result = await tool.call({})
      expect(result.data).toContain('bridge.fetch')
    })
  })

  describe('getPlatformConstraints tool', () => {
    it('returns platform constraints', async () => {
      const tool = tools.find(t => t.name === 'getPlatformConstraints')!
      const result = await tool.call({})
      expect(result.data).toContain('BLOCKED')
    })
  })

  describe('getExpertFindings tool', () => {
    it('returns non-info expert findings as JSON', async () => {
      const tool = tools.find(t => t.name === 'getExpertFindings')!
      const result = await tool.call({})
      const findings = JSON.parse(result.data as string)
      expect(Array.isArray(findings)).toBe(true)
      expect(findings[0].title).toBe('Suspicious fetch usage')
    })
  })

  describe('getManifest tool', () => {
    it('returns manifest as JSON', async () => {
      const tool = tools.find(t => t.name === 'getManifest')!
      const result = await tool.call({})
      const manifest = JSON.parse(result.data as string)
      expect(manifest.name).toBe('test-component')
    })
  })
})
