import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StaticAnalysisResult, ExpertAgentResult, ReviewerConfig, RedTeamResult } from '../../types'

vi.mock('@cslate/shared/agent', () => ({
  buildRegistry: vi.fn(() => ({ languageModel: vi.fn() })),
  buildTool: vi.fn((def: any) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    call: def.call,
    isReadOnly: def.isReadOnly ?? (() => true),
    isConcurrencySafe: () => true,
    maxResultSizeChars: 50000,
    toAISDKTool: () => ({}),
  })),
  toAISDKTools: vi.fn((tools: any[]) => Object.fromEntries(tools.map((t: any) => [t.name, t]))),
  runSubAgent: vi.fn(),
  stripFences: vi.fn((text: string) => text),
}))

const fixtureRedTeamResult = {
  exploitAttempts: [
    {
      attackVector: 'data_exfiltration',
      technique: 'CSS custom property encoding',
      targetAsset: 'user session token',
      feasibility: 'theoretical',
      evidence: 'No evidence found',
      file: 'ui.tsx',
      line: 10,
      chainedWith: [],
      mitigatedBy: 'sandbox CSP',
    },
  ],
  overallThreatLevel: 'low',
  sandboxEscapeRisk: 5,
  dataExfiltrationRisk: 15,
  supplyChainRisk: 10,
  promptInjectionRisk: 0,
}

const mockFiles = { 'ui.tsx': 'const App = () => <div />', 'context.md': '# App' }
const mockManifest = { name: 'test', dataSources: [] }

const mockStaticResult: StaticAnalysisResult = {
  criticalFindings: [],
  warnings: [],
  codeStructure: { files: {}, dependencyGraph: {}, unusedExports: [], circularDependencies: [] },
  typeCheckResult: { success: true, errors: [] },
  duration: 50,
}

const mockExpertResults: ExpertAgentResult[] = []

const mockConfig: ReviewerConfig = {
  maxConcurrentReviews: 5,
  maxReviewsPerHour: 30,
  reviewThrottleSeconds: 10,
  pauseReviews: false,
  maxLLMCostPerDay: 50,
  maxExpertAgentIterations: 12,
  maxRedTeamIterations: 10,
  maxJudgeIterations: 12,
  qualityThreshold: 70,
  maxWarnings: 5,
  modelOverrides: {},
}

describe('runRedTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a RedTeamResult with correct shape', async () => {
    const { runSubAgent } = await import('@cslate/shared/agent')
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      text: JSON.stringify(fixtureRedTeamResult),
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      steps: 4,
    })

    const { runRedTeam } = await import('../index')
    const result: RedTeamResult = await runRedTeam(
      mockFiles,
      mockManifest,
      mockStaticResult,
      mockExpertResults,
      mockConfig,
    )

    expect(result.exploitAttempts).toHaveLength(1)
    expect(result.exploitAttempts[0].attackVector).toBe('data_exfiltration')
    expect(result.overallThreatLevel).toBe('low')
    expect(result.sandboxEscapeRisk).toBe(5)
    expect(result.dataExfiltrationRisk).toBe(15)
    expect(result.supplyChainRisk).toBe(10)
    expect(result.promptInjectionRisk).toBe(0)
  })

  it('maps iterationsUsed from steps', async () => {
    const { runSubAgent } = await import('@cslate/shared/agent')
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      text: JSON.stringify(fixtureRedTeamResult),
      usage: { inputTokens: 2000, outputTokens: 800, totalTokens: 2800 },
      steps: 7,
    })

    const { runRedTeam } = await import('../index')
    const result = await runRedTeam(mockFiles, mockManifest, mockStaticResult, mockExpertResults, mockConfig)

    expect(result.iterationsUsed).toBe(7)
  })

  it('maps tokenCost from usage', async () => {
    const { runSubAgent } = await import('@cslate/shared/agent')
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      text: JSON.stringify(fixtureRedTeamResult),
      usage: { inputTokens: 3000, outputTokens: 1200, totalTokens: 4200 },
      steps: 5,
    })

    const { runRedTeam } = await import('../index')
    const result = await runRedTeam(mockFiles, mockManifest, mockStaticResult, mockExpertResults, mockConfig)

    expect(result.tokenCost.input).toBe(3000)
    expect(result.tokenCost.output).toBe(1200)
  })

  it('uses modelOverrides.redTeam when provided', async () => {
    const { runSubAgent } = await import('@cslate/shared/agent')
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      text: JSON.stringify(fixtureRedTeamResult),
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
      steps: 3,
    })

    const configWithOverride = { ...mockConfig, modelOverrides: { redTeam: 'anthropic:claude-opus-4-6' } }
    const { runRedTeam } = await import('../index')
    await runRedTeam(mockFiles, mockManifest, mockStaticResult, mockExpertResults, configWithOverride)

    expect(runSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic:claude-opus-4-6' }),
    )
  })

  it('falls back to claude-sonnet-4-6 when no modelOverride', async () => {
    const { runSubAgent } = await import('@cslate/shared/agent')
    vi.mocked(runSubAgent).mockResolvedValueOnce({
      text: JSON.stringify(fixtureRedTeamResult),
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
      steps: 3,
    })

    const { runRedTeam } = await import('../index')
    await runRedTeam(mockFiles, mockManifest, mockStaticResult, mockExpertResults, mockConfig)

    expect(runSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic:claude-sonnet-4-6' }),
    )
  })
})
