import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExpertFinding } from '../../types'

// Mock @cslate/shared/agent before importing module under test
vi.mock('@cslate/shared/agent', () => ({
  buildTool: vi.fn().mockImplementation((def: any) => ({
    ...def,
    isReadOnly: def.isReadOnly ?? (() => false),
    isConcurrencySafe: def.isConcurrencySafe ?? (() => true),
    maxResultSizeChars: def.maxResultSizeChars ?? 50000,
    toAISDKTool: () => ({}),
  })),
}))

import { buildJudgeTools } from '../tools'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FILES: Record<string, string> = {
  'ui.tsx': `
import React from 'react'

export function Widget() {
  const apiKey = 'sk-secret-1234'
  return <div dangerouslySetInnerHTML={{ __html: userInput }} />
}
`.trim(),
  'logic.ts': `
export function compute(x: number) {
  return x * 2
}
`.trim(),
}

function makeExpertFinding(overrides: Partial<ExpertFinding> = {}): ExpertFinding {
  return {
    dimension: 3,
    severity: 'critical',
    confidence: 90,
    title: 'Hardcoded API key',
    description: 'API key found in source',
    file: 'ui.tsx',
    line: 5,
    evidence: "apiKey = 'sk-secret-1234'",
    reasoning: 'Credential exposed in code',
    verifiedByTool: false,
    ...overrides,
  }
}

// ─── readFile tool ─────────────────────────────────────────────────────────────

describe('readFile tool', () => {
  it('returns file content for a known file', async () => {
    const tools = buildJudgeTools(FILES, [])
    const readFile = tools.find(t => t.name === 'readFile')!
    const result = await readFile.call({ filename: 'ui.tsx' })
    expect(result.data).toContain('sk-secret-1234')
  })

  it('returns not-found message with available files listed', async () => {
    const tools = buildJudgeTools(FILES, [])
    const readFile = tools.find(t => t.name === 'readFile')!
    const result = await readFile.call({ filename: 'missing.ts' })
    expect(result.data).toContain('File not found')
    expect(result.data).toContain('ui.tsx')
    expect(result.data).toContain('logic.ts')
  })
})

// ─── verifyFinding tool ────────────────────────────────────────────────────────

describe('verifyFinding tool', () => {
  it('confirms a pattern that exists in the file', async () => {
    const tools = buildJudgeTools(FILES, [])
    const verifyFinding = tools.find(t => t.name === 'verifyFinding')!
    const result = await verifyFinding.call({ filename: 'ui.tsx', evidencePattern: 'sk-secret' })
    expect(result.data).toContain('CONFIRMED')
  })

  it('returns NOT FOUND for a pattern absent from the file', async () => {
    const tools = buildJudgeTools(FILES, [])
    const verifyFinding = tools.find(t => t.name === 'verifyFinding')!
    const result = await verifyFinding.call({ filename: 'ui.tsx', evidencePattern: 'eval\\(' })
    expect(result.data).toContain('NOT FOUND')
    expect(result.data).toContain('hallucinated')
  })

  it('returns hallucinated message when file does not exist', async () => {
    const tools = buildJudgeTools(FILES, [])
    const verifyFinding = tools.find(t => t.name === 'verifyFinding')!
    const result = await verifyFinding.call({ filename: 'ghost.ts', evidencePattern: 'anything' })
    expect(result.data).toContain('hallucinated')
  })

  it('includes context lines when line number is provided', async () => {
    const tools = buildJudgeTools(FILES, [])
    const verifyFinding = tools.find(t => t.name === 'verifyFinding')!
    const result = await verifyFinding.call({ filename: 'ui.tsx', line: 5, evidencePattern: 'sk-secret' })
    expect(result.data).toContain('CONFIRMED')
    expect(result.data).toContain('line')
  })
})

// ─── listFindings tool ─────────────────────────────────────────────────────────

describe('listFindings tool', () => {
  const allFindings = [
    makeExpertFinding({ severity: 'critical' }),
    makeExpertFinding({ severity: 'warning', title: 'Unused var' }),
    makeExpertFinding({ severity: 'info', title: 'Style note' }),
  ]

  it('returns all findings when severity is all', async () => {
    const tools = buildJudgeTools(FILES, allFindings)
    const listFindings = tools.find(t => t.name === 'listFindings')!
    const result = await listFindings.call({ severity: 'all' })
    const parsed = JSON.parse(result.data as string)
    expect(parsed).toHaveLength(3)
  })

  it('filters by critical severity', async () => {
    const tools = buildJudgeTools(FILES, allFindings)
    const listFindings = tools.find(t => t.name === 'listFindings')!
    const result = await listFindings.call({ severity: 'critical' })
    const parsed = JSON.parse(result.data as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].severity).toBe('critical')
  })

  it('filters by warning severity', async () => {
    const tools = buildJudgeTools(FILES, allFindings)
    const listFindings = tools.find(t => t.name === 'listFindings')!
    const result = await listFindings.call({ severity: 'warning' })
    const parsed = JSON.parse(result.data as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].severity).toBe('warning')
  })
})

// ─── searchCode tool ───────────────────────────────────────────────────────────

describe('searchCode tool', () => {
  it('finds pattern across all files', async () => {
    const tools = buildJudgeTools(FILES, [])
    const searchCode = tools.find(t => t.name === 'searchCode')!
    const result = await searchCode.call({ pattern: 'export' })
    expect(result.data).toContain('ui.tsx')
    expect(result.data).toContain('logic.ts')
  })

  it('returns no-matches message when pattern not found', async () => {
    const tools = buildJudgeTools(FILES, [])
    const searchCode = tools.find(t => t.name === 'searchCode')!
    const result = await searchCode.call({ pattern: 'NONEXISTENT_PATTERN_XYZ' })
    expect(result.data).toContain('No matches found')
  })

  it('returns file and line number in results', async () => {
    const tools = buildJudgeTools(FILES, [])
    const searchCode = tools.find(t => t.name === 'searchCode')!
    const result = await searchCode.call({ pattern: 'sk-secret' })
    expect(result.data).toContain('ui.tsx')
    expect(result.data).toMatch(/:\d+:/)
  })
})

// ─── all tools are read-only ──────────────────────────────────────────────────

describe('tool metadata', () => {
  it('all judge tools are read-only', () => {
    const tools = buildJudgeTools(FILES, [])
    for (const tool of tools) {
      expect(tool.isReadOnly({})).toBe(true)
    }
  })

  it('builds exactly 4 tools', () => {
    const tools = buildJudgeTools(FILES, [])
    expect(tools).toHaveLength(4)
  })

  it('tools are named readFile, verifyFinding, listFindings, searchCode', () => {
    const tools = buildJudgeTools(FILES, [])
    const names = tools.map(t => t.name)
    expect(names).toContain('readFile')
    expect(names).toContain('verifyFinding')
    expect(names).toContain('listFindings')
    expect(names).toContain('searchCode')
  })
})
