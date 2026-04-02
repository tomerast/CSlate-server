import { describe, it, expect } from 'vitest'
import { renderReport } from '../report-renderer'
import {
  ReviewVerdict,
  DimensionScore,
  VerifiedFinding,
  RedTeamResult,
  ReviewStats,
  ReviewCost,
} from '../../types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDimScore(overrides: Partial<DimensionScore> = {}): DimensionScore {
  return {
    dimension: 1,
    name: 'Malicious Intent Detection',
    tier: 'security',
    verdict: 'pass',
    confidence: 95,
    weight: 3,
    weightedScore: 2.85,
    summary: 'No issues found',
    findings: { critical: 0, warning: 0, info: 0 },
    ...overrides,
  }
}

function makeVerifiedFinding(overrides: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    dimension: 2,
    severity: 'critical',
    confidence: 90,
    title: 'XSS via dangerouslySetInnerHTML',
    description: 'Unescaped user input passed to dangerouslySetInnerHTML',
    file: 'ui.tsx',
    line: 42,
    evidence: 'dangerouslySetInnerHTML={{ __html: userInput }}',
    reasoning: 'User data flows directly to HTML',
    verifiedByTool: true,
    verificationMethod: 'tool_confirmed',
    verificationEvidence: 'CONFIRMED at line 42',
    ...overrides,
  }
}

function makeThreatAssessment(): RedTeamResult {
  return {
    exploitAttempts: [],
    overallThreatLevel: 'low',
    sandboxEscapeRisk: 5,
    dataExfiltrationRisk: 10,
    supplyChainRisk: 2,
    promptInjectionRisk: 15,
    iterationsUsed: 8,
    tokenCost: { input: 1000, output: 500 },
  }
}

function makeStats(): ReviewStats {
  return {
    totalDuration: 12500,
    phaseDurations: { staticAnalysis: 500, expertAgents: 8000, redTeam: 3000, judge: 800, verdict: 200 },
    totalFindings: 5,
    verifiedFindings: 3,
    rejectedFindings: 2,
    hallucinationRate: 0.4,
    iterationsUsed: { securityExpert: 10, qualityExpert: 8, standardsExpert: 6, redTeam: 8, judge: 5 },
  }
}

function makeCost(): ReviewCost {
  return {
    totalTokens: { input: 50000, output: 10000 },
    perPhase: [],
    totalEstimatedCost: 0.0450,
  }
}

function makeApprovedVerdict(): ReviewVerdict {
  return {
    decision: 'approved',
    decisionConfidence: 92,
    decisionReason: 'All dimensions passed review',
    scorecard: [
      makeDimScore({ dimension: 1, name: 'Malicious Intent Detection', verdict: 'pass', findings: { critical: 0, warning: 0, info: 0 } }),
      makeDimScore({ dimension: 4, name: 'Architecture & SOLID', tier: 'quality', verdict: 'warning', confidence: 75, findings: { critical: 0, warning: 1, info: 0 } }),
    ],
    findings: [
      makeVerifiedFinding({ severity: 'warning', title: 'Missing useEffect cleanup', file: 'ui.tsx', line: 55 }),
    ],
    threatAssessment: makeThreatAssessment(),
    stats: makeStats(),
    cost: makeCost(),
    learningSignals: [],
  }
}

function makeRejectedVerdict(): ReviewVerdict {
  return {
    decision: 'rejected',
    decisionConfidence: 25,
    decisionReason: 'Critical findings remain after judge review',
    scorecard: [
      makeDimScore({ dimension: 2, name: 'Injection & Sandbox Escape', tier: 'security', verdict: 'fail', confidence: 95, findings: { critical: 1, warning: 0, info: 0 } }),
    ],
    findings: [makeVerifiedFinding()],
    threatAssessment: { ...makeThreatAssessment(), overallThreatLevel: 'high', sandboxEscapeRisk: 75 },
    stats: makeStats(),
    cost: makeCost(),
    learningSignals: [],
  }
}

// ─── renderReport ─────────────────────────────────────────────────────────────

describe('renderReport', () => {
  it('includes component name and version in header', () => {
    const report = renderReport(makeApprovedVerdict(), 'MyWidget', '1.2.3')
    expect(report).toContain('MyWidget')
    expect(report).toContain('1.2.3')
  })

  it('shows APPROVED with checkmark icon for approved verdict', () => {
    const report = renderReport(makeApprovedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('✅')
    expect(report).toContain('APPROVED')
  })

  it('shows REJECTED with X icon for rejected verdict', () => {
    const report = renderReport(makeRejectedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('❌')
    expect(report).toContain('REJECTED')
  })

  it('includes the decision reason', () => {
    const verdict = makeRejectedVerdict()
    const report = renderReport(verdict, 'Widget', '1.0.0')
    expect(report).toContain('Critical findings remain after judge review')
  })

  it('renders the scorecard table with all dimensions', () => {
    const verdict = makeApprovedVerdict()
    const report = renderReport(verdict, 'Widget', '1.0.0')
    expect(report).toContain('Malicious Intent Detection')
    expect(report).toContain('Architecture & SOLID')
    expect(report).toContain('PASS')
    expect(report).toContain('WARNING')
  })

  it('lists critical findings with file and evidence', () => {
    const report = renderReport(makeRejectedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('XSS via dangerouslySetInnerHTML')
    expect(report).toContain('ui.tsx')
    expect(report).toContain('dangerouslySetInnerHTML={{ __html: userInput }}')
  })

  it('shows _None_ when no critical findings', () => {
    const report = renderReport(makeApprovedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('_None_')
  })

  it('lists warning findings', () => {
    const report = renderReport(makeApprovedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('Missing useEffect cleanup')
  })

  it('includes threat assessment section with risk scores', () => {
    const report = renderReport(makeRejectedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('Threat Assessment')
    expect(report).toContain('HIGH')
    expect(report).toContain('75')
  })

  it('includes cost and duration', () => {
    const report = renderReport(makeApprovedVerdict(), 'Widget', '1.0.0')
    expect(report).toContain('12500')
    expect(report).toContain('0.0450')
  })

  it('approved report matches snapshot', () => {
    const report = renderReport(makeApprovedVerdict(), 'MyWidget', '2.0.0')
    expect(report).toMatchSnapshot()
  })

  it('rejected report matches snapshot', () => {
    const report = renderReport(makeRejectedVerdict(), 'DangerWidget', '0.1.0')
    expect(report).toMatchSnapshot()
  })
})
