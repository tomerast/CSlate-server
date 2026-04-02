import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PipelineContext } from '../../types'
import type {
  StaticAnalysisResult,
  ExpertAgentResult,
  RedTeamResult,
  JudgeResult,
  ReviewVerdict,
  AgentReviewProgress,
} from '../types'
import { DEFAULT_REVIEWER_CONFIG } from '../types'

// ─── Module Mocks ─────────────────────────────────────────────────────────────

vi.mock('@cslate/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('../static', () => ({
  runStaticAnalysis: vi.fn(),
}))

vi.mock('../experts', () => ({
  runExpertAgents: vi.fn(),
}))

vi.mock('../red-team', () => ({
  runRedTeam: vi.fn(),
}))

vi.mock('../judge', () => ({
  runJudge: vi.fn(),
}))

vi.mock('../verdict', () => ({
  computeVerdict: vi.fn(),
  renderReport: vi.fn(),
}))

vi.mock('../learning', () => ({
  loadKnowledgeBase: vi.fn(),
  recordReviewOutcome: vi.fn(),
}))

vi.mock('../config', () => ({
  getReviewerConfig: vi.fn(),
}))

vi.mock('../config/cost-tracker', () => ({
  trackReviewCost: vi.fn(),
  estimateCost: vi.fn(() => 0),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { agentReview } from '../orchestrator'
import { runStaticAnalysis } from '../static'
import { runExpertAgents } from '../experts'
import { runRedTeam } from '../red-team'
import { runJudge } from '../judge'
import { computeVerdict, renderReport } from '../verdict'
import { loadKnowledgeBase, recordReviewOutcome } from '../learning'
import { getReviewerConfig } from '../config'

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const makeCtx = (): PipelineContext => ({
  uploadId: 'test-upload-123',
  manifest: {
    name: 'test-component',
    title: 'Test Component',
    description: 'A test component',
    version: '1.0.0',
    files: ['ui.tsx'],
    defaultSize: { width: 400, height: 300 },
    tags: ['test'],
  },
  files: { 'ui.tsx': 'export default function Comp() { return <div /> }' },
  previousResults: [],
})

const makeStaticResult = (critical = false): StaticAnalysisResult => ({
  criticalFindings: critical
    ? [{
        analyzer: 'eval-detector',
        dimension: 2,
        severity: 'critical',
        file: 'ui.tsx',
        line: 10,
        pattern: 'eval()',
        message: 'eval() usage detected',
        evidence: 'eval("code")',
      }]
    : [],
  warnings: [],
  codeStructure: {
    files: {},
    dependencyGraph: {},
    unusedExports: [],
    circularDependencies: [],
  },
  typeCheckResult: { success: true, errors: [] },
  duration: 100,
})

const makeExpertResults = (securityFail = false): ExpertAgentResult[] => [
  {
    agent: 'security-expert',
    dimensions: securityFail
      ? [{ dimension: 1, name: 'Malicious Intent Detection', tier: 'security', verdict: 'fail', confidence: 90, weight: 1, weightedScore: 0, summary: 'Failed', findings: { critical: 1, warning: 0, info: 0 } }]
      : [{ dimension: 1, name: 'Malicious Intent Detection', tier: 'security', verdict: 'pass', confidence: 95, weight: 1, weightedScore: 95, summary: 'Passed', findings: { critical: 0, warning: 0, info: 0 } }],
    findings: [],
    iterationsUsed: 3,
    tokenCost: { input: 1000, output: 500 },
  },
  {
    agent: 'quality-expert',
    dimensions: [],
    findings: [],
    iterationsUsed: 2,
    tokenCost: { input: 800, output: 400 },
  },
  {
    agent: 'standards-expert',
    dimensions: [],
    findings: [],
    iterationsUsed: 2,
    tokenCost: { input: 600, output: 300 },
  },
]

const makeRedTeamResult = (): RedTeamResult => ({
  exploitAttempts: [],
  overallThreatLevel: 'none',
  sandboxEscapeRisk: 0,
  dataExfiltrationRisk: 0,
  supplyChainRisk: 0,
  promptInjectionRisk: 0,
  iterationsUsed: 4,
  tokenCost: { input: 1200, output: 600 },
})

const makeJudgeResult = (): JudgeResult => ({
  verifiedFindings: [],
  rejectedFindings: [],
  resolvedConflicts: [],
  dimensionScores: [],
  stats: { totalFindingsReceived: 0, hallucinated: 0, duplicates: 0, conflictsResolved: 0, verified: 0 },
  iterationsUsed: 5,
  tokenCost: { input: 2000, output: 1000 },
})

const makeVerdict = (decision: 'approved' | 'rejected' = 'approved'): ReviewVerdict => ({
  decision,
  decisionConfidence: 95,
  decisionReason: decision === 'approved' ? 'All dimensions passed' : 'Critical issues found',
  scorecard: [],
  findings: [],
  threatAssessment: makeRedTeamResult(),
  stats: {
    totalDuration: 5000,
    phaseDurations: { staticAnalysis: 100, expertAgents: 0, redTeam: 0, judge: 0, verdict: 0 },
    totalFindings: 0,
    verifiedFindings: 0,
    rejectedFindings: 0,
    hallucinationRate: 0,
    iterationsUsed: { securityExpert: 3, qualityExpert: 2, standardsExpert: 2, redTeam: 4, judge: 5 },
  },
  cost: { totalTokens: { input: 0, output: 0 }, perPhase: [], totalEstimatedCost: 0 },
  learningSignals: [],
})

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(getReviewerConfig).mockResolvedValue({ ...DEFAULT_REVIEWER_CONFIG })
  vi.mocked(loadKnowledgeBase).mockResolvedValue({
    version: 1,
    updatedAt: new Date(),
    codeStandards: [],
    patternLibrary: [],
    dimensionWeights: [],
  })
  vi.mocked(runStaticAnalysis).mockResolvedValue(makeStaticResult())
  vi.mocked(runExpertAgents).mockResolvedValue(makeExpertResults())
  vi.mocked(runRedTeam).mockResolvedValue(makeRedTeamResult())
  vi.mocked(runJudge).mockResolvedValue(makeJudgeResult())
  vi.mocked(computeVerdict).mockReturnValue(makeVerdict())
  vi.mocked(renderReport).mockReturnValue('# Report')
  vi.mocked(recordReviewOutcome).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agentReview orchestrator', () => {
  describe('call order and phase execution', () => {
    it('calls all 5 phases in order when no short-circuits', async () => {
      const ctx = makeCtx()
      const callOrder: string[] = []

      vi.mocked(runStaticAnalysis).mockImplementation(async () => {
        callOrder.push('static')
        return makeStaticResult()
      })
      vi.mocked(runExpertAgents).mockImplementation(async () => {
        callOrder.push('experts')
        return makeExpertResults()
      })
      vi.mocked(runRedTeam).mockImplementation(async () => {
        callOrder.push('redTeam')
        return makeRedTeamResult()
      })
      vi.mocked(runJudge).mockImplementation(async () => {
        callOrder.push('judge')
        return makeJudgeResult()
      })
      vi.mocked(computeVerdict).mockImplementation((...args) => {
        callOrder.push('verdict')
        return makeVerdict()
      })

      await agentReview(ctx)

      expect(callOrder).toEqual(['static', 'experts', 'redTeam', 'judge', 'verdict'])
    })
  })

  describe('short-circuit: static analysis critical findings', () => {
    it('returns failed StageResult immediately without calling phases 2-5', async () => {
      vi.mocked(runStaticAnalysis).mockResolvedValue(makeStaticResult(true /* critical */))

      const ctx = makeCtx()
      const result = await agentReview(ctx)

      expect(result.stage).toBe('agent_review')
      expect(result.status).toBe('failed')
      expect(result.issues).toHaveLength(1)
      expect(result.issues![0].message).toContain('SHORT CIRCUIT')
      expect(runExpertAgents).not.toHaveBeenCalled()
      expect(runRedTeam).not.toHaveBeenCalled()
      expect(runJudge).not.toHaveBeenCalled()
      expect(computeVerdict).not.toHaveBeenCalled()
    })
  })

  describe('short-circuit: security expert fail', () => {
    it('skips red-team and judge but still runs verdict', async () => {
      vi.mocked(runExpertAgents).mockResolvedValue(makeExpertResults(true /* securityFail */))

      const ctx = makeCtx()
      await agentReview(ctx)

      expect(runRedTeam).not.toHaveBeenCalled()
      expect(runJudge).not.toHaveBeenCalled()
      expect(computeVerdict).toHaveBeenCalledOnce()
    })
  })

  describe('progress callback', () => {
    it('fires in_progress then complete for all 5 phases in happy path', async () => {
      const ctx = makeCtx()
      const progressEvents: AgentReviewProgress[] = []
      const onProgress = vi.fn(async (p: AgentReviewProgress) => { progressEvents.push(p) })

      await agentReview(ctx, onProgress)

      const phases = ['static_analysis', 'expert_agents', 'red_team', 'judge', 'verdict'] as const
      for (const phase of phases) {
        const inProgress = progressEvents.find(e => e.phase === phase && e.status === 'in_progress')
        const complete = progressEvents.find(e => e.phase === phase && e.status === 'complete')
        expect(inProgress, `${phase} in_progress`).toBeDefined()
        expect(complete, `${phase} complete`).toBeDefined()
      }
    })

    it('fires skipped for red_team and judge when security fails', async () => {
      vi.mocked(runExpertAgents).mockResolvedValue(makeExpertResults(true /* securityFail */))

      const ctx = makeCtx()
      const progressEvents: AgentReviewProgress[] = []
      const onProgress = vi.fn(async (p: AgentReviewProgress) => { progressEvents.push(p) })

      await agentReview(ctx, onProgress)

      const redTeamSkipped = progressEvents.find(e => e.phase === 'red_team' && e.status === 'skipped')
      const judgeSkipped = progressEvents.find(e => e.phase === 'judge' && e.status === 'skipped')
      expect(redTeamSkipped).toBeDefined()
      expect(judgeSkipped).toBeDefined()
    })

    it('does not fire progress for phases after static short-circuit', async () => {
      vi.mocked(runStaticAnalysis).mockResolvedValue(makeStaticResult(true /* critical */))

      const ctx = makeCtx()
      const progressEvents: AgentReviewProgress[] = []
      const onProgress = vi.fn(async (p: AgentReviewProgress) => { progressEvents.push(p) })

      await agentReview(ctx, onProgress)

      const expertProgress = progressEvents.find(e => e.phase === 'expert_agents')
      expect(expertProgress).toBeUndefined()
    })
  })

  describe('StageResult shape', () => {
    it('returns status=passed when verdict is approved', async () => {
      vi.mocked(computeVerdict).mockReturnValue(makeVerdict('approved'))
      const result = await agentReview(makeCtx())
      expect(result.stage).toBe('agent_review')
      expect(result.status).toBe('passed')
      expect(result.data?.verdict).toBeDefined()
      expect(result.data?.report).toBe('# Report')
    })

    it('returns status=failed when verdict is rejected', async () => {
      vi.mocked(computeVerdict).mockReturnValue(makeVerdict('rejected'))
      const result = await agentReview(makeCtx())
      expect(result.stage).toBe('agent_review')
      expect(result.status).toBe('failed')
    })
  })

  describe('backward compatibility: previousResults with old stage names', () => {
    it('runs normally when previousResults does not contain agent_review', async () => {
      // The orchestrator itself always runs — backward compat skip happens in runner.ts.
      // This test verifies agentReview executes all phases regardless of previousResults.
      const ctx = makeCtx()
      ctx.previousResults = [
        { stage: 'manifest_validation', status: 'passed', duration: 50 },
        { stage: 'dependency_check', status: 'passed', duration: 100 },
      ]

      await agentReview(ctx)

      expect(runStaticAnalysis).toHaveBeenCalledOnce()
      expect(runExpertAgents).toHaveBeenCalledOnce()
    })
  })
})
