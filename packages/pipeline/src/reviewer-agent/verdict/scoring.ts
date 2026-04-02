import {
  DimensionScore,
  DimensionTier,
  FinalDimensionScore,
  JudgeResult,
  RedTeamResult,
  ReviewCost,
  ReviewStats,
  ReviewVerdict,
  ReviewerConfig,
  VerifiedFinding,
  DEFAULT_REVIEWER_CONFIG,
  DIMENSIONS,
} from '../types'

function verdictScore(v: string): number {
  return v === 'pass' ? 1 : v === 'warning' ? 0.5 : 0
}

function tierWeight(tier: DimensionTier): number {
  switch (tier) {
    case 'security': return 3
    case 'quality': return 2
    case 'standards': return 1
  }
}

export function weightedAverage(dimensions: DimensionScore[]): number {
  const numerator = dimensions.reduce((sum, d) => sum + d.weight * d.confidence * verdictScore(d.verdict), 0)
  const denominator = dimensions.reduce((sum, d) => sum + d.weight, 0)
  return denominator === 0 ? 0 : numerator / denominator
}

function buildScorecard(judgeResult: JudgeResult): DimensionScore[] {
  return judgeResult.dimensionScores.map((fs: FinalDimensionScore) => {
    const dimConfig = DIMENSIONS.find(d => d.id === fs.dimension)
    const tier: DimensionTier = dimConfig?.tier ?? 'quality'
    const weight = tierWeight(tier)
    return {
      dimension: fs.dimension,
      name: fs.name,
      tier,
      verdict: fs.verdict,
      confidence: fs.confidence,
      weight,
      weightedScore: weight * verdictScore(fs.verdict) * (fs.confidence / 100),
      summary: fs.summary,
      findings: {
        critical: fs.criticalCount,
        warning: fs.warningCount,
        info: 0,
      },
    }
  })
}

function buildVerdict(
  decision: 'approved' | 'rejected',
  reason: string,
  scorecard: DimensionScore[],
  judgeResult: JudgeResult,
  redTeamResult: RedTeamResult,
  stats: ReviewStats,
  cost: ReviewCost,
): ReviewVerdict {
  const qualityScore = weightedAverage(scorecard)
  return {
    decision,
    decisionConfidence: Math.min(100, Math.max(0, Math.round(qualityScore))),
    decisionReason: reason,
    scorecard,
    findings: judgeResult.verifiedFindings,
    threatAssessment: redTeamResult,
    stats,
    cost,
    learningSignals: [],
  }
}

export function computeVerdict(
  judgeResult: JudgeResult,
  redTeamResult: RedTeamResult,
  config: ReviewerConfig,
  stats: ReviewStats,
  cost: ReviewCost,
): ReviewVerdict {
  const scorecard = buildScorecard(judgeResult)
  const qualityScore = weightedAverage(scorecard)
  const threshold = config.qualityThreshold ?? DEFAULT_REVIEWER_CONFIG.qualityThreshold
  const maxWarnings = config.maxWarnings ?? DEFAULT_REVIEWER_CONFIG.maxWarnings

  // 1. Security tier FAIL → instant reject
  const securityFail = scorecard.some(d => d.tier === 'security' && d.verdict === 'fail')
  if (securityFail) {
    return buildVerdict('rejected', 'Security dimension failed', scorecard, judgeResult, redTeamResult, stats, cost)
  }

  // 2. Red-team critical/high → reject
  if (redTeamResult.overallThreatLevel === 'critical' || redTeamResult.overallThreatLevel === 'high') {
    return buildVerdict('rejected', `Red-team threat level: ${redTeamResult.overallThreatLevel}`, scorecard, judgeResult, redTeamResult, stats, cost)
  }

  // 3. Any critical findings after judge → reject
  if (judgeResult.verifiedFindings.some(f => (f.adjustedSeverity ?? f.severity) === 'critical')) {
    return buildVerdict('rejected', 'Critical findings remain after judge review', scorecard, judgeResult, redTeamResult, stats, cost)
  }

  // 4. Quality score below threshold → reject
  if (qualityScore < threshold) {
    return buildVerdict('rejected', `Quality score ${qualityScore.toFixed(1)} below threshold ${threshold}`, scorecard, judgeResult, redTeamResult, stats, cost)
  }

  // 5. Warning count above threshold → reject
  const warningCount = judgeResult.verifiedFindings.filter(
    (f: VerifiedFinding) => (f.adjustedSeverity ?? f.severity) === 'warning',
  ).length
  if (warningCount > maxWarnings) {
    return buildVerdict('rejected', `${warningCount} warnings exceeds limit of ${maxWarnings}`, scorecard, judgeResult, redTeamResult, stats, cost)
  }

  return buildVerdict('approved', 'All dimensions passed review', scorecard, judgeResult, redTeamResult, stats, cost)
}
