import { describe, it, expect } from 'vitest'
import { weightedAverage, computeVerdict } from '../scoring'
import {
  DimensionScore,
  JudgeResult,
  RedTeamResult,
  ReviewCost,
  ReviewStats,
  VerifiedFinding,
  DEFAULT_REVIEWER_CONFIG,
} from '../../types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDimScore(overrides: Partial<DimensionScore> = {}): DimensionScore {
  return {
    dimension: 4,
    name: 'Architecture',
    tier: 'quality',
    verdict: 'pass',
    confidence: 100,
    weight: 1,
    weightedScore: 1,
    summary: 'ok',
    findings: { critical: 0, warning: 0, info: 0 },
    ...overrides,
  }
}

function makeVerifiedFinding(overrides: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    dimension: 1,
    severity: 'warning',
    confidence: 80,
    title: 'Finding',
    description: '',
    file: 'foo.ts',
    evidence: '',
    reasoning: '',
    verifiedByTool: true,
    verificationMethod: 'tool_confirmed',
    verificationEvidence: 'confirmed',
    ...overrides,
  }
}

function makeJudgeResult(overrides: Partial<JudgeResult> = {}): JudgeResult {
  return {
    verifiedFindings: [],
    rejectedFindings: [],
    resolvedConflicts: [],
    dimensionScores: [],
    stats: { totalFindingsReceived: 0, hallucinated: 0, duplicates: 0, conflictsResolved: 0, verified: 0 },
    iterationsUsed: 1,
    tokenCost: { input: 0, output: 0 },
    ...overrides,
  }
}

function makeRedTeamResult(overrides: Partial<RedTeamResult> = {}): RedTeamResult {
  return {
    exploitAttempts: [],
    overallThreatLevel: 'none',
    sandboxEscapeRisk: 0,
    dataExfiltrationRisk: 0,
    supplyChainRisk: 0,
    promptInjectionRisk: 0,
    iterationsUsed: 1,
    tokenCost: { input: 0, output: 0 },
    ...overrides,
  }
}

function makeStats(): ReviewStats {
  return {
    totalDuration: 100,
    phaseDurations: { staticAnalysis: 10, expertAgents: 20, redTeam: 30, judge: 30, verdict: 10 },
    totalFindings: 0,
    verifiedFindings: 0,
    rejectedFindings: 0,
    hallucinationRate: 0,
    iterationsUsed: { securityExpert: 1, qualityExpert: 1, standardsExpert: 1, redTeam: 1, judge: 1 },
  }
}

function makeCost(): ReviewCost {
  return {
    totalTokens: { input: 0, output: 0 },
    perPhase: [],
    totalEstimatedCost: 0,
  }
}

// ─── weightedAverage ──────────────────────────────────────────────────────────

describe('weightedAverage', () => {
  it('returns 100 for a single passing dimension at full confidence', () => {
    const dims = [makeDimScore({ weight: 1, confidence: 100, verdict: 'pass' })]
    expect(weightedAverage(dims)).toBe(100)
  })

  it('returns 0 for a single failing dimension', () => {
    const dims = [makeDimScore({ weight: 1, confidence: 100, verdict: 'fail' })]
    expect(weightedAverage(dims)).toBe(0)
  })

  it('returns 50 for a single warning dimension at full confidence', () => {
    const dims = [makeDimScore({ weight: 1, confidence: 100, verdict: 'warning' })]
    expect(weightedAverage(dims)).toBe(50)
  })

  it('weights heavier dimensions proportionally more', () => {
    const dims = [
      makeDimScore({ weight: 2, confidence: 100, verdict: 'pass' }),  // 2*100*1 = 200
      makeDimScore({ weight: 1, confidence: 100, verdict: 'fail' }),  // 1*100*0 = 0
    ]
    // numerator=200, denominator=3 → 66.67
    expect(weightedAverage(dims)).toBeCloseTo(66.67, 1)
  })

  it('accounts for confidence below 100', () => {
    const dims = [makeDimScore({ weight: 1, confidence: 50, verdict: 'pass' })]
    // 1*50*1 / 1 = 50
    expect(weightedAverage(dims)).toBe(50)
  })

  it('returns 0 for empty array', () => {
    expect(weightedAverage([])).toBe(0)
  })
})

// ─── computeVerdict ───────────────────────────────────────────────────────────

describe('computeVerdict', () => {
  it('approves when all quality dimensions pass and quality score exceeds threshold', () => {
    const judgeResult = makeJudgeResult({
      dimensionScores: [
        { dimension: 4, name: 'Architecture', tier: 'quality', verdict: 'pass', confidence: 100, summary: '', verifiedFindings: 0, criticalCount: 0, warningCount: 0 },
      ],
    })
    const result = computeVerdict(judgeResult, makeRedTeamResult(), DEFAULT_REVIEWER_CONFIG, makeStats(), makeCost())
    expect(result.decision).toBe('approved')
    expect(result.decisionReason).toContain('passed')
  })

  it('rejects when a security-tier dimension fails', () => {
    const judgeResult = makeJudgeResult({
      dimensionScores: [
        { dimension: 1, name: 'Malicious Intent', tier: 'security', verdict: 'fail', confidence: 90, summary: '', verifiedFindings: 1, criticalCount: 1, warningCount: 0 },
      ],
    })
    const result = computeVerdict(judgeResult, makeRedTeamResult(), DEFAULT_REVIEWER_CONFIG, makeStats(), makeCost())
    expect(result.decision).toBe('rejected')
    expect(result.decisionReason).toContain('Security')
  })

  it('rejects when red-team threat level is high', () => {
    const result = computeVerdict(
      makeJudgeResult(),
      makeRedTeamResult({ overallThreatLevel: 'high' }),
      DEFAULT_REVIEWER_CONFIG,
      makeStats(),
      makeCost(),
    )
    expect(result.decision).toBe('rejected')
    expect(result.decisionReason).toContain('high')
  })

  it('rejects when red-team threat level is critical', () => {
    const result = computeVerdict(
      makeJudgeResult(),
      makeRedTeamResult({ overallThreatLevel: 'critical' }),
      DEFAULT_REVIEWER_CONFIG,
      makeStats(),
      makeCost(),
    )
    expect(result.decision).toBe('rejected')
    expect(result.decisionReason).toContain('critical')
  })

  it('rejects when a critical verified finding remains', () => {
    const judgeResult = makeJudgeResult({
      verifiedFindings: [makeVerifiedFinding({ severity: 'critical' })],
    })
    const result = computeVerdict(judgeResult, makeRedTeamResult(), DEFAULT_REVIEWER_CONFIG, makeStats(), makeCost())
    expect(result.decision).toBe('rejected')
    expect(result.decisionReason).toContain('Critical')
  })

  it('rejects when adjustedSeverity is critical even if original severity is warning', () => {
    const judgeResult = makeJudgeResult({
      verifiedFindings: [makeVerifiedFinding({ severity: 'warning', adjustedSeverity: 'critical' })],
    })
    const result = computeVerdict(judgeResult, makeRedTeamResult(), DEFAULT_REVIEWER_CONFIG, makeStats(), makeCost())
    expect(result.decision).toBe('rejected')
  })

  it('rejects when quality score falls below configured threshold', () => {
    const judgeResult = makeJudgeResult({
      dimensionScores: [
        { dimension: 4, name: 'Architecture', tier: 'quality', verdict: 'fail', confidence: 100, summary: '', verifiedFindings: 1, criticalCount: 0, warningCount: 1 },
        { dimension: 5, name: 'Functionality', tier: 'quality', verdict: 'fail', confidence: 100, summary: '', verifiedFindings: 1, criticalCount: 0, warningCount: 1 },
      ],
    })
    const result = computeVerdict(judgeResult, makeRedTeamResult(), { ...DEFAULT_REVIEWER_CONFIG, qualityThreshold: 70 }, makeStats(), makeCost())
    expect(result.decision).toBe('rejected')
    expect(result.decisionReason).toContain('below threshold')
  })

  it('rejects when warning count exceeds maxWarnings', () => {
    const warnings = Array.from({ length: 6 }, (_, i) =>
      makeVerifiedFinding({ severity: 'warning', title: `Warning ${i}` }),
    )
    const judgeResult = makeJudgeResult({
      verifiedFindings: warnings,
      dimensionScores: [
        { dimension: 4, name: 'Architecture', tier: 'quality', verdict: 'pass', confidence: 100, summary: '', verifiedFindings: 0, criticalCount: 0, warningCount: 6 },
      ],
    })
    const result = computeVerdict(
      judgeResult,
      makeRedTeamResult(),
      { ...DEFAULT_REVIEWER_CONFIG, maxWarnings: 5, qualityThreshold: 0 },
      makeStats(),
      makeCost(),
    )
    expect(result.decision).toBe('rejected')
    expect(result.decisionReason).toContain('warnings')
  })

  it('security check fires before red-team check (cascade order)', () => {
    const judgeResult = makeJudgeResult({
      dimensionScores: [
        { dimension: 1, name: 'Malicious Intent', tier: 'security', verdict: 'fail', confidence: 90, summary: '', verifiedFindings: 1, criticalCount: 1, warningCount: 0 },
      ],
    })
    const result = computeVerdict(
      judgeResult,
      makeRedTeamResult({ overallThreatLevel: 'critical' }),
      DEFAULT_REVIEWER_CONFIG,
      makeStats(),
      makeCost(),
    )
    expect(result.decisionReason).toContain('Security')
  })

  it('returns full ReviewVerdict shape on approval', () => {
    const judgeResult = makeJudgeResult({
      dimensionScores: [
        { dimension: 4, name: 'Architecture', tier: 'quality', verdict: 'pass', confidence: 100, summary: 'ok', verifiedFindings: 0, criticalCount: 0, warningCount: 0 },
      ],
    })
    const result = computeVerdict(judgeResult, makeRedTeamResult(), DEFAULT_REVIEWER_CONFIG, makeStats(), makeCost())
    expect(result).toMatchObject({
      decision: 'approved',
      scorecard: expect.any(Array),
      findings: expect.any(Array),
      threatAssessment: expect.objectContaining({ overallThreatLevel: 'none' }),
      stats: expect.objectContaining({ totalDuration: 100 }),
      cost: expect.objectContaining({ totalEstimatedCost: 0 }),
      learningSignals: expect.any(Array),
    })
  })
})
