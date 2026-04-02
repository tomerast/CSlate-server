import { describe, it, expect, vi } from 'vitest'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase } from '../../types'
import { DEFAULT_REVIEWER_CONFIG } from '../../types'

const makeResult = (agent: string): ExpertAgentResult => ({
  agent,
  dimensions: [],
  findings: [],
  iterationsUsed: 2,
  tokenCost: { input: 50, output: 100 },
})

vi.mock('../security-expert', () => ({
  runSecurityExpert: vi.fn().mockResolvedValue(makeResult('security-expert')),
}))
vi.mock('../quality-expert', () => ({
  runQualityExpert: vi.fn().mockResolvedValue(makeResult('quality-expert')),
}))
vi.mock('../standards-expert', () => ({
  runStandardsExpert: vi.fn().mockResolvedValue(makeResult('standards-expert')),
}))
vi.mock('@cslate/shared/agent', () => ({
  buildRegistry: vi.fn().mockReturnValue({ languageModel: vi.fn() }),
}))

describe('runExpertAgents', () => {
  const mockFiles = { 'ui.tsx': 'export function App() {}' }
  const mockManifest = { name: 'Test' }
  const mockStaticResult: StaticAnalysisResult = {
    criticalFindings: [],
    warnings: [],
    codeStructure: { files: {}, dependencyGraph: {}, unusedExports: [], circularDependencies: [] },
    typeCheckResult: { success: true, errors: [] },
    duration: 10,
  }
  const mockKnowledgeBase: ReviewerKnowledgeBase = {
    version: 1,
    updatedAt: new Date(),
    codeStandards: [],
    patternLibrary: [],
    dimensionWeights: [],
  }

  it('returns 3 ExpertAgentResult objects', async () => {
    const { runExpertAgents } = await import('../index')
    const results = await runExpertAgents(
      mockFiles, mockManifest, mockStaticResult, mockKnowledgeBase, DEFAULT_REVIEWER_CONFIG,
    )
    expect(results).toHaveLength(3)
  })

  it('returns results in order: security, quality, standards', async () => {
    const { runExpertAgents } = await import('../index')
    const results = await runExpertAgents(
      mockFiles, mockManifest, mockStaticResult, mockKnowledgeBase, DEFAULT_REVIEWER_CONFIG,
    )
    expect(results[0].agent).toBe('security-expert')
    expect(results[1].agent).toBe('quality-expert')
    expect(results[2].agent).toBe('standards-expert')
  })
})
