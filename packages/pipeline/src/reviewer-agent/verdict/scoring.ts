import {
  ConfidenceInterval,
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

function tierWeight(tier: DimensionTier, config: ReviewerConfig): number {
  const weights = config.tierWeights ?? DEFAULT_REVIEWER_CONFIG.tierWeights
  return weights[tier]
}

/**
 * Compute a confidence interval for a dimension score.
 *
 * Factors that widen the interval (increase uncertainty):
 * - Few findings (small sample size)
 * - Mixed severity findings (disagreement)
 * - Low tool verification rate
 * - High overall hallucination rate
 *
 * Returns bounds clamped to [0, 100].
 */
function computeConfidenceInterval(
  confidence: number,
  findingCount: number,
  criticalCount: number,
  warningCount: number,
  hallucinationRate: number,
): ConfidenceInterval {
  // Base half-width: starts at 25 and narrows with more findings
  // 0 findings → 25, 1 → 18, 3 → 12, 5 → 10, 10+ → ~7
  const sampleFactor = findingCount === 0 ? 25 : 25 / Math.sqrt(1 + findingCount)

  // Severity consistency: mixed critical+warning = wider interval
  const totalSeverityFindings = criticalCount + warningCount
  const severityMix = totalSeverityFindings > 1
    ? Math.min(criticalCount, warningCount) / totalSeverityFindings * 10
    : 0

  // Hallucination penalty: high hallucination rate = less trustworthy scores
  const hallucinationPenalty = hallucinationRate * 20

  const halfWidth = Math.round(sampleFactor + severityMix + hallucinationPenalty)
  const lower = Math.max(0, confidence - halfWidth)
  const upper = Math.min(100, confidence + halfWidth)

  return { lower, upper, width: upper - lower }
}

/**
 * Compute an aggregate confidence interval for the overall verdict.
 * Uses weighted combination of per-dimension intervals.
 */
function computeOverallConfidenceInterval(scorecard: DimensionScore[]): ConfidenceInterval {
  if (scorecard.length === 0) return { lower: 0, upper: 0, width: 0 }

  const totalWeight = scorecard.reduce((sum, d) => sum + d.weight, 0)
  if (totalWeight === 0) return { lower: 0, upper: 0, width: 0 }

  const weightedLower = scorecard.reduce((sum, d) => sum + d.weight * d.confidenceInterval.lower, 0) / totalWeight
  const weightedUpper = scorecard.reduce((sum, d) => sum + d.weight * d.confidenceInterval.upper, 0) / totalWeight

  const lower = Math.round(weightedLower)
  const upper = Math.round(weightedUpper)
  return { lower, upper, width: upper - lower }
}

export function weightedAverage(dimensions: DimensionScore[]): number {
  const numerator = dimensions.reduce((sum, d) => sum + d.weight * d.confidence * verdictScore(d.verdict), 0)
  const denominator = dimensions.reduce((sum, d) => sum + d.weight, 0)
  return denominator === 0 ? 0 : numerator / denominator
}

function buildScorecard(judgeResult: JudgeResult, config: ReviewerConfig): DimensionScore[] {
  const hallucinationRate = judgeResult.stats.totalFindingsReceived > 0
    ? judgeResult.stats.hallucinated / judgeResult.stats.totalFindingsReceived
    : 0

  return judgeResult.dimensionScores.map((fs: FinalDimensionScore) => {
    const dimConfig = DIMENSIONS.find(d => d.id === fs.dimension)
    const tier: DimensionTier = dimConfig?.tier ?? 'quality'
    const weight = tierWeight(tier, config)
    const confidenceInterval = computeConfidenceInterval(
      fs.confidence,
      fs.verifiedFindings,
      fs.criticalCount,
      fs.warningCount,
      hallucinationRate,
    )
    return {
      dimension: fs.dimension,
      name: fs.name,
      tier,
      verdict: fs.verdict,
      confidence: fs.confidence,
      confidenceInterval,
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
    decisionConfidenceInterval: computeOverallConfidenceInterval(scorecard),
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
  const scorecard = buildScorecard(judgeResult, config)
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
