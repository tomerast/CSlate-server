import { ReviewVerdict, VerifiedFinding, DIMENSIONS } from '../types'

function suggestFix(finding: VerifiedFinding): string {
  const dim = DIMENSIONS.find(d => d.id === finding.dimension)

  // Security dimension fixes
  if (finding.dimension === 1) {
    if (finding.title.toLowerCase().includes('obfuscat')) return 'Remove obfuscated code. Use clear, readable variable names and direct API calls.'
    if (finding.title.toLowerCase().includes('network') || finding.title.toLowerCase().includes('fetch')) return 'Remove direct network calls. Use bridge.fetch() with declared data sources only.'
    if (finding.title.toLowerCase().includes('exfiltration')) return 'Remove data encoding in CSS props, error messages, or image URIs. Keep data within bridge API channels.'
    return 'Review and remove suspicious security patterns. All data flow should go through the bridge API.'
  }
  if (finding.dimension === 2) {
    if (finding.title.toLowerCase().includes('eval') || finding.title.toLowerCase().includes('function')) return 'Remove eval()/new Function() usage. Use static code paths instead.'
    if (finding.title.toLowerCase().includes('prototype')) return 'Remove prototype chain access (__proto__, constructor.prototype). Use Object.create(null) for plain maps.'
    if (finding.title.toLowerCase().includes('xss') || finding.title.toLowerCase().includes('innerhtml')) return 'Replace dangerouslySetInnerHTML with safe rendering. Use DOMPurify or render as text.'
    if (finding.title.toLowerCase().includes('bridge')) return 'Use only string literal sourceIds in bridge.fetch(). Move dynamic source selection to manifest dataSources.'
    return 'Remove injection vectors. Avoid dynamic code execution and validate all inputs.'
  }
  if (finding.dimension === 3) {
    if (finding.title.toLowerCase().includes('credential') || finding.title.toLowerCase().includes('secret') || finding.title.toLowerCase().includes('key')) return 'Move secrets to bridge.getConfig(). Declare config keys in manifest.userConfig.'
    if (finding.title.toLowerCase().includes('pii')) return 'Remove PII from source code. Use bridge.getConfig() for user-specific data.'
    if (finding.title.toLowerCase().includes('console')) return 'Remove console.log statements that output sensitive data.'
    return 'Move secrets and sensitive data to bridge.getConfig(). Never hardcode credentials.'
  }

  // Quality dimension fixes
  if (finding.dimension === 4) {
    if (finding.title.toLowerCase().includes('separation') || finding.title.toLowerCase().includes('logic in ui')) return 'Extract business logic into a separate logic.ts file. Keep ui.tsx focused on rendering.'
    if (finding.title.toLowerCase().includes('god') || finding.title.toLowerCase().includes('long function')) return 'Break large functions into smaller, focused functions. Each function should do one thing.'
    return 'Improve component architecture. Separate concerns and follow SOLID principles.'
  }
  if (finding.dimension === 5) {
    if (finding.title.toLowerCase().includes('null') || finding.title.toLowerCase().includes('undefined')) return 'Add null/undefined checks on bridge.fetch() response data before accessing nested properties.'
    if (finding.title.toLowerCase().includes('error handling')) return 'Add try/catch around bridge.fetch() calls. Handle failures gracefully with fallback UI.'
    if (finding.title.toLowerCase().includes('race')) return 'Use AbortController or a flag to cancel stale async operations. Check component mount state.'
    return 'Fix correctness issues. Add proper error handling and edge case coverage.'
  }
  if (finding.dimension === 6) {
    if (finding.title.toLowerCase().includes('any')) return 'Replace `any` with specific types. Define interfaces for bridge response data.'
    if (finding.title.toLowerCase().includes('manifest')) return 'Update TypeScript interfaces to match manifest declarations exactly.'
    return 'Improve type safety. Replace `any` with specific types and add proper interfaces.'
  }
  if (finding.dimension === 7) {
    if (finding.title.toLowerCase().includes('memory') || finding.title.toLowerCase().includes('cleanup')) return 'Add cleanup in useEffect return function. Unsubscribe from bridge.subscribe() on unmount.'
    if (finding.title.toLowerCase().includes('loop') || finding.title.toLowerCase().includes('recursion')) return 'Add bounds to loops/recursion. Use iteration limits or depth tracking.'
    if (finding.title.toLowerCase().includes('re-render') || finding.title.toLowerCase().includes('memo')) return 'Wrap expensive computations in useMemo(). Stabilize callback references with useCallback().'
    return 'Fix performance issues. Ensure proper cleanup, bounded operations, and memoization.'
  }

  // Standards dimension fixes
  if (finding.dimension === 8) {
    if (finding.title.toLowerCase().includes('console')) return 'Remove console.log/debug statements before submission.'
    if (finding.title.toLowerCase().includes('dead code')) return 'Remove commented-out code and unused imports.'
    return 'Clean up code style. Remove debug statements and dead code.'
  }
  if (finding.dimension === 9) {
    if (finding.title.toLowerCase().includes('aria')) return 'Add aria-label attributes to all interactive elements (buttons, inputs, links).'
    if (finding.title.toLowerCase().includes('semantic') || finding.title.toLowerCase().includes('div')) return 'Replace <div onClick> with <button>. Use semantic elements (<nav>, <main>, <section>).'
    if (finding.title.toLowerCase().includes('keyboard')) return 'Add onKeyDown handlers for Enter/Space on interactive elements. Ensure tabIndex is set.'
    return 'Improve accessibility. Add ARIA labels, semantic HTML, and keyboard support.'
  }
  if (finding.dimension === 10) {
    if (finding.title.toLowerCase().includes('context.md') || finding.title.toLowerCase().includes('documentation')) return 'Update context.md to accurately describe what the component does, its inputs, and its data sources.'
    if (finding.title.toLowerCase().includes('data source') || finding.title.toLowerCase().includes('manifest')) return 'Align manifest dataSources with actual bridge.fetch() usage. Remove unused sources.'
    if (finding.title.toLowerCase().includes('tag')) return 'Update tags to accurately reflect component functionality.'
    return 'Update manifest and documentation to match actual code behavior.'
  }

  return `Review ${dim?.name ?? 'this dimension'} and address the finding.`
}

export function renderReport(verdict: ReviewVerdict, componentName: string, version: string): string {
  const icon = verdict.decision === 'approved' ? '✅' : '❌'

  const criticalFindings = verdict.findings.filter(
    (f: VerifiedFinding) => (f.adjustedSeverity ?? f.severity) === 'critical',
  )
  const warningFindings = verdict.findings.filter(
    (f: VerifiedFinding) => (f.adjustedSeverity ?? f.severity) === 'warning',
  )

  const scorecardRows = verdict.scorecard
    .map(d => `| ${d.dimension} | ${d.name} | ${d.verdict.toUpperCase()} | ${d.confidence}% (${d.confidenceInterval.lower}-${d.confidenceInterval.upper}) | ${d.findings.critical} | ${d.findings.warning} |`)
    .join('\n')

  const criticalSection = criticalFindings.length > 0
    ? criticalFindings
        .map(f => [
          `### ${f.title}`,
          `- **Dimension:** ${DIMENSIONS.find(d => d.id === f.dimension)?.name ?? f.dimension}`,
          `- **File:** ${f.file}:${f.line ?? '?'}`,
          `- **Evidence:** ${f.evidence}`,
          `- **Reasoning:** ${f.reasoning}`,
          `- **Fix:** ${suggestFix(f)}`,
        ].join('\n'))
        .join('\n\n')
    : '_None_'

  const warningSection = warningFindings.length > 0
    ? warningFindings
        .map(f => `- [Dim ${f.dimension}] **${f.title}** in \`${f.file}:${f.line ?? '?'}\` — _Fix: ${suggestFix(f)}_`)
        .join('\n')
    : '_None_'

  return `# Review Report: ${componentName} v${version}

## Verdict: ${icon} ${verdict.decision.toUpperCase()}
**Reason:** ${verdict.decisionReason}
**Confidence:** ${verdict.decisionConfidence}% (${verdict.decisionConfidenceInterval.lower}-${verdict.decisionConfidenceInterval.upper})
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

## Review Stats
- **Hallucination Rate:** ${(verdict.stats.hallucinationRate * 100).toFixed(1)}%
- **Findings:** ${verdict.stats.totalFindings} total → ${verdict.stats.verifiedFindings} verified, ${verdict.stats.rejectedFindings} rejected
- **Phase Durations:** Static ${verdict.stats.phaseDurations.staticAnalysis}ms | Experts ${verdict.stats.phaseDurations.expertAgents}ms | Red-team ${verdict.stats.phaseDurations.redTeam}ms | Judge ${verdict.stats.phaseDurations.judge}ms
`
}
