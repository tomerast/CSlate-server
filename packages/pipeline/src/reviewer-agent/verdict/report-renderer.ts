import { ReviewVerdict, VerifiedFinding } from '../types'

export function renderReport(verdict: ReviewVerdict, componentName: string, version: string): string {
  const icon = verdict.decision === 'approved' ? '✅' : '❌'

  const criticalFindings = verdict.findings.filter(
    (f: VerifiedFinding) => (f.adjustedSeverity ?? f.severity) === 'critical',
  )
  const warningFindings = verdict.findings.filter(
    (f: VerifiedFinding) => (f.adjustedSeverity ?? f.severity) === 'warning',
  )

  const scorecardRows = verdict.scorecard
    .map(d => `| ${d.dimension} | ${d.name} | ${d.verdict.toUpperCase()} | ${d.confidence}% | ${d.findings.critical} | ${d.findings.warning} |`)
    .join('\n')

  const criticalSection = criticalFindings.length > 0
    ? criticalFindings
        .map(f => `### ${f.title}\n- **File:** ${f.file}:${f.line ?? '?'}\n- **Evidence:** ${f.evidence}\n- **Reasoning:** ${f.reasoning}`)
        .join('\n\n')
    : '_None_'

  const warningSection = warningFindings.length > 0
    ? warningFindings
        .map(f => `- [Dim ${f.dimension}] **${f.title}** in \`${f.file}:${f.line ?? '?'}\``)
        .join('\n')
    : '_None_'

  return `# Review Report: ${componentName} v${version}

## Verdict: ${icon} ${verdict.decision.toUpperCase()}
**Reason:** ${verdict.decisionReason}
**Confidence:** ${verdict.decisionConfidence}%
**Duration:** ${verdict.stats.totalDuration}ms
**Cost:** $${verdict.cost.totalEstimatedCost.toFixed(4)}

## Scorecard
| # | Dimension | Verdict | Confidence | Critical | Warnings |
|---|-----------|---------|------------|----------|----------|
${scorecardRows}

## Critical Findings
${criticalSection}

## Warnings
${warningSection}

## Threat Assessment
- **Overall Threat Level:** ${verdict.threatAssessment.overallThreatLevel.toUpperCase()}
- **Sandbox Escape Risk:** ${verdict.threatAssessment.sandboxEscapeRisk}/100
- **Data Exfiltration Risk:** ${verdict.threatAssessment.dataExfiltrationRisk}/100
- **Supply Chain Risk:** ${verdict.threatAssessment.supplyChainRisk}/100
- **Prompt Injection Risk:** ${verdict.threatAssessment.promptInjectionRisk}/100
`
}
