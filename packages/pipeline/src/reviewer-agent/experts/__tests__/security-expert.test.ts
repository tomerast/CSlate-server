import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../../types'
import { DEFAULT_REVIEWER_CONFIG } from '../../types'

const FIXTURE_SECURITY_RESULT: ExpertAgentResult = {
  agent: 'security-expert',
  dimensions: [
    { dimension: 1, name: 'Malicious Intent Detection', tier: 'security', verdict: 'pass', confidence: 90, weight: 1.0, weightedScore: 90, summary: 'No malicious intent found', findings: { critical: 0, warning: 0, info: 0 } },
    { dimension: 2, name: 'Injection & Sandbox Escape', tier: 'security', verdict: 'pass', confidence: 85, weight: 1.0, weightedScore: 85, summary: 'No injection vectors', findings: { critical: 0, warning: 0, info: 0 } },
    { dimension: 3, name: 'Credential & Data Hygiene', tier: 'security', verdict: 'pass', confidence: 95, weight: 1.0, weightedScore: 95, summary: 'No credentials found', findings: { critical: 0, warning: 0, info: 0 } },
  ],
  findings: [],
  iterationsUsed: 3,
  tokenCost: { input: 0, output: 0 },
}

vi.mock('@cslate/shared/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cslate/shared/agent')>()
  return {
    ...actual,
    runSubAgent: vi.fn().mockResolvedValue({
      text: JSON.stringify(FIXTURE_SECURITY_RESULT),
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      steps: 3,
    }),
    buildRegistry: vi.fn().mockReturnValue({ languageModel: vi.fn() }),
    toAISDKTools: vi.fn().mockReturnValue({}),
    stripFences: (s: string) => s,
  }
})

describe('runSecurityExpert', () => {
  const mockFiles = { 'ui.tsx': 'export function App() { return <div /> }' }
  const mockManifest = { name: 'Test' }
  const mockStaticResult: StaticAnalysisResult = {
    criticalFindings: [],
    warnings: [],
    codeStructure: { files: {}, dependencyGraph: {}, unusedExports: [], circularDependencies: [] },
    typeCheckResult: { success: true, errors: [] },
    duration: 50,
  }
  const mockKnowledgeBase: ReviewerKnowledgeBase = {
    version: 1,
    updatedAt: new Date(),
    codeStandards: [],
    patternLibrary: [],
    dimensionWeights: [],
  }
  const mockRegistry = { languageModel: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an ExpertAgentResult with agent === "security-expert"', async () => {
    const { runSecurityExpert } = await import('../security-expert')
    const result = await runSecurityExpert(
      mockFiles, mockManifest, mockStaticResult, mockKnowledgeBase,
      DEFAULT_REVIEWER_CONFIG, mockRegistry,
    )
    expect(result.agent).toBe('security-expert')
  })

  it('returns 3 dimensions for dims 1, 2, 3', async () => {
    const { runSecurityExpert } = await import('../security-expert')
    const result = await runSecurityExpert(
      mockFiles, mockManifest, mockStaticResult, mockKnowledgeBase,
      DEFAULT_REVIEWER_CONFIG, mockRegistry,
    )
    expect(result.dimensions).toHaveLength(3)
    expect(result.dimensions.map(d => d.dimension)).toEqual([1, 2, 3])
  })

  it('sets tokenCost from usage', async () => {
    const { runSecurityExpert } = await import('../security-expert')
    const result = await runSecurityExpert(
      mockFiles, mockManifest, mockStaticResult, mockKnowledgeBase,
      DEFAULT_REVIEWER_CONFIG, mockRegistry,
    )
    expect(result.tokenCost).toEqual({ input: 100, output: 200 })
  })

  it('sets iterationsUsed from steps', async () => {
    const { runSecurityExpert } = await import('../security-expert')
    const result = await runSecurityExpert(
      mockFiles, mockManifest, mockStaticResult, mockKnowledgeBase,
      DEFAULT_REVIEWER_CONFIG, mockRegistry,
    )
    expect(result.iterationsUsed).toBe(3)
  })
})
