import type {
  JudgeResult,
  RedTeamResult,
  ReviewerConfig,
  ReviewStats,
  ReviewCost,
  ReviewVerdict,
  DimensionScore,
  LearningSignal,
} from '../types'

export function computeVerdict(
  judgeResult: JudgeResult,
  redTeamResult: RedTeamResult | null,
  config: ReviewerConfig,
  stats: ReviewStats,
  cost: ReviewCost,
): ReviewVerdict {
  // TODO: Implement full verdict computation:
  // - Weighted scoring across all 10 dimensions
  // - Hard-fail on any critical security finding
  // - Quality threshold check (config.qualityThreshold)
  // - Warning count gate (config.maxWarnings)
  // - Learning signal extraction

  const hasCritical = judgeResult.verifiedFindings.some((f) => f.severity === 'critical')
  const warningCount = judgeResult.verifiedFindings.filter((f) => f.severity === 'warning').length
  const highThreat = redTeamResult && ['high', 'critical'].includes(redTeamResult.overallThreatLevel)

  const decision: 'approved' | 'rejected' =
    hasCritical || highThreat || warningCount > config.maxWarnings ? 'rejected' : 'approved'

  const scorecard: DimensionScore[] = judgeResult.dimensionScores.map((d) => ({
    dimension: d.dimension,
    name: d.name,
    tier: 'quality' as const,
    verdict: d.verdict,
    confidence: d.confidence,
    weight: 1,
    weightedScore: d.verdict === 'pass' ? d.confidence : 0,
    summary: d.summary,
    findings: {
      critical: d.criticalCount,
      warning: d.warningCount,
      info: 0,
    },
  }))

  const learningSignals: LearningSignal[] = []

  return {
    decision,
    decisionConfidence: judgeResult.stats.verified > 0 ? 80 : 95,
    decisionReason: hasCritical
      ? 'Critical security findings detected'
      : highThreat
        ? 'Red-team identified exploitable vulnerabilities'
        : warningCount > config.maxWarnings
          ? `Warning count (${warningCount}) exceeds threshold (${config.maxWarnings})`
          : 'All dimensions passed review',
    scorecard,
    findings: judgeResult.verifiedFindings,
    threatAssessment: redTeamResult ?? {
      exploitAttempts: [],
      overallThreatLevel: 'none',
      sandboxEscapeRisk: 0,
      dataExfiltrationRisk: 0,
      supplyChainRisk: 0,
      promptInjectionRisk: 0,
      iterationsUsed: 0,
      tokenCost: { input: 0, output: 0 },
    },
    stats,
    cost,
    learningSignals,
  }
}

export function renderReport(verdict: ReviewVerdict, componentName: string, version: string): string {
  // TODO: Implement full markdown report rendering

  const statusIcon = verdict.decision === 'approved' ? '✅' : '❌'
  const lines = [
    `# Component Review Report: ${componentName} v${version}`,
    '',
    `## Decision: ${statusIcon} ${verdict.decision.toUpperCase()}`,
    `**Confidence:** ${verdict.decisionConfidence}%`,
    `**Reason:** ${verdict.decisionReason}`,
    '',
    `## Summary`,
    `- Verified findings: ${verdict.stats.verifiedFindings}`,
    `- Rejected findings: ${verdict.stats.rejectedFindings}`,
    `- Hallucination rate: ${(verdict.stats.hallucinationRate * 100).toFixed(1)}%`,
    `- Total duration: ${(verdict.stats.totalDuration / 1000).toFixed(1)}s`,
    `- Estimated cost: $${verdict.cost.totalEstimatedCost.toFixed(4)}`,
  ]

  if (verdict.findings.length > 0) {
    lines.push('', '## Findings')
    for (const f of verdict.findings) {
      lines.push(`- **[${f.severity.toUpperCase()}]** ${f.title} (${f.file}${f.line ? `:${f.line}` : ''})`)
      lines.push(`  ${f.description}`)
    }
  }

  return lines.join('\n')
}
