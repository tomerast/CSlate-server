import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JudgeResult, StaticAnalysisResult, ExpertAgentResult, RedTeamResult } from '../../types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunSubAgent = vi.fn()
const mockStripFences = vi.fn().mockImplementation((s: string) => s)

vi.mock('@cslate/shared/agent', () => ({
  buildRegistry: vi.fn().mockReturnValue({}),
  buildTool: vi.fn().mockImplementation((def: any) => ({
    ...def,
    isReadOnly: def.isReadOnly ?? (() => false),
    isConcurrencySafe: def.isConcurrencySafe ?? (() => true),
    maxResultSizeChars: 50000,
    toAISDKTool: () => ({}),
  })),
  toAISDKTools: vi.fn().mockReturnValue({}),
  runSubAgent: (...args: any[]) => mockRunSubAgent(...args),
  stripFences: (s: string) => mockStripFences(s),
}))

import { runJudge } from '../index'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_FILES: Record<string, string> = {
  'ui.tsx': 'export function Widget() { return <div>hello</div> }',
}

const MOCK_STATIC_RESULT: StaticAnalysisResult = {
  criticalFindings: [],
  warnings: [],
  codeStructure: { files: {}, dependencyGraph: {}, unusedExports: [], circularDependencies: [] },
  typeCheckResult: { success: true, errors: [] },
  duration: 100,
}

const MOCK_EXPERT_RESULTS: ExpertAgentResult[] = [
  {
    agent: 'security',
    dimensions: [],
    findings: [
      {
        dimension: 1,
        severity: 'warning',
        confidence: 80,
        title: 'Suspicious pattern',
        description: '',
        file: 'ui.tsx',
        line: 1,
        evidence: 'hello',
        reasoning: '',
        verifiedByTool: false,
      },
    ],
    iterationsUsed: 5,
    tokenCost: { input: 1000, output: 500 },
  },
]

const MOCK_RED_TEAM_RESULT: RedTeamResult = {
  exploitAttempts: [],
  overallThreatLevel: 'none',
  sandboxEscapeRisk: 0,
  dataExfiltrationRisk: 0,
  supplyChainRisk: 0,
  promptInjectionRisk: 0,
  iterationsUsed: 5,
  tokenCost: { input: 500, output: 200 },
}

const MOCK_JUDGE_OUTPUT: Omit<JudgeResult, 'iterationsUsed' | 'tokenCost'> = {
  verifiedFindings: [],
  rejectedFindings: [],
  resolvedConflicts: [],
  dimensionScores: [
    { dimension: 1, name: 'Malicious Intent', verdict: 'pass', confidence: 90, summary: 'OK', verifiedFindings: 0, criticalCount: 0, warningCount: 0 },
  ],
  stats: { totalFindingsReceived: 1, hallucinated: 0, duplicates: 0, conflictsResolved: 0, verified: 1 },
}

// ─── runJudge ─────────────────────────────────────────────────────────────────

describe('runJudge', () => {
  beforeEach(() => {
    mockRunSubAgent.mockReset()
    mockStripFences.mockReset()
    mockStripFences.mockImplementation((s: string) => s)
    mockRunSubAgent.mockResolvedValue({
      text: JSON.stringify(MOCK_JUDGE_OUTPUT),
      usage: { inputTokens: 5000, outputTokens: 2000, totalTokens: 7000 },
      steps: 7,
    })
  })

  it('returns a JudgeResult with iterationsUsed from runSubAgent steps', async () => {
    const result = await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
    )
    expect(result.iterationsUsed).toBe(7)
  })

  it('maps runSubAgent token usage to tokenCost', async () => {
    const result = await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
    )
    expect(result.tokenCost).toEqual({ input: 5000, output: 2000 })
  })

  it('includes verifiedFindings from parsed JSON', async () => {
    const result = await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
    )
    expect(result.verifiedFindings).toEqual([])
  })

  it('includes dimensionScores from parsed JSON', async () => {
    const result = await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
    )
    expect(result.dimensionScores).toHaveLength(1)
    expect(result.dimensionScores[0].verdict).toBe('pass')
  })

  it('passes config.maxJudgeIterations to runSubAgent maxSteps', async () => {
    await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
      undefined,
      { maxJudgeIterations: 20 } as any,
    )
    expect(mockRunSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: 20 }),
    )
  })

  it('passes model override from config to runSubAgent', async () => {
    await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
      undefined,
      { modelOverrides: { judge: 'anthropic:claude-opus-4-6' } } as any,
    )
    expect(mockRunSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic:claude-opus-4-6' }),
    )
  })

  it('calls stripFences on runSubAgent text output', async () => {
    await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
    )
    expect(mockStripFences).toHaveBeenCalledWith(JSON.stringify(MOCK_JUDGE_OUTPUT))
  })

  it('handles stripFences removing markdown code fences', async () => {
    const jsonText = JSON.stringify(MOCK_JUDGE_OUTPUT)
    mockRunSubAgent.mockResolvedValue({
      text: '```json\n' + jsonText + '\n```',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      steps: 3,
    })
    // Use real stripFences for this test
    mockStripFences.mockImplementation((s: string) => {
      return s.replace(/^```(?:json|typescript|ts|js)?\n?([\s\S]*?)\n?```$/m, '$1').trim()
    })
    const result = await runJudge(
      MOCK_FILES,
      {},
      MOCK_STATIC_RESULT,
      MOCK_EXPERT_RESULTS,
      MOCK_RED_TEAM_RESULT,
    )
    expect(result.iterationsUsed).toBe(3)
  })
})
