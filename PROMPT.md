# Ralph Loop: Phase 4-5 — Judge Agent + Verdict Synthesis

## Mission

Build the Judge agent (Phase 4) and Verdict synthesis (Phase 5). The Judge verifies findings from expert agents and red-team, catches hallucinations, deduplicates, and resolves conflicts using `runSubAgent`. The Verdict produces the 10-dimension scorecard and APPROVE/REJECT decision — pure computation, no LLM.

## Scope

Build everything in `packages/pipeline/src/reviewer-agent/judge/` and `packages/pipeline/src/reviewer-agent/verdict/`.

## Key Files

**Create:**
- `packages/pipeline/src/reviewer-agent/judge/index.ts` — `runJudge()` entry point
- `packages/pipeline/src/reviewer-agent/judge/tools.ts` — Judge tools (readFile, verify finding, etc.)
- `packages/pipeline/src/reviewer-agent/judge/prompts.ts` — Judge system prompt
- `packages/pipeline/src/reviewer-agent/verdict/index.ts` — `computeVerdict()` + `renderReport()` entry point
- `packages/pipeline/src/reviewer-agent/verdict/scoring.ts` — Weighted scoring formula
- `packages/pipeline/src/reviewer-agent/verdict/report-renderer.ts` — Markdown report generator
- Tests for each module in `__tests__/`

**Read (do NOT modify):**
- `packages/pipeline/src/reviewer-agent/types.ts` — ALL types:
  - Judge: `JudgeResult`, `VerifiedFinding`, `RejectedFinding`, `ResolvedConflict`, `FinalDimensionScore`
  - Verdict: `ReviewVerdict`, `DimensionScore`, `ReviewerConfig`, `ReviewCost`, `ReviewStats`
  - Inputs: `StaticAnalysisResult`, `ExpertAgentResult`, `RedTeamResult`, `ReviewerKnowledgeBase`

## First Step: Add Dependencies

Add to `packages/pipeline/package.json`:
```json
"@cslate/shared": "github:tomerast/CSlate-shared"
```
Run: `pnpm install`

## AI SDK Import Pattern

**CRITICAL**: Use `@cslate/shared/agent` — NOT raw LLM calls.

```typescript
import { buildRegistry, buildTool, toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
```

## Interface Contracts

```typescript
// judge/index.ts
export async function runJudge(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  redTeamResult: RedTeamResult,
  knowledgeBase?: ReviewerKnowledgeBase,
  config?: Partial<ReviewerConfig>,
): Promise<JudgeResult>

// verdict/index.ts
export function computeVerdict(
  judgeResult: JudgeResult,
  redTeamResult: RedTeamResult,
  config: ReviewerConfig,
  stats: ReviewStats,
  cost: ReviewCost,
): ReviewVerdict

export function renderReport(verdict: ReviewVerdict, componentName: string, version: string): string
```

## Judge Tools (tools.ts)

```typescript
export function buildJudgeTools(
  files: Record<string, string>,
  allFindings: ExpertFinding[],
) {
  return [
    buildTool({
      name: 'readFile',
      description: 'Read a file to verify whether a finding actually exists in the code.',
      inputSchema: z.object({ filename: z.string() }),
      isReadOnly: () => true,
      call: async ({ filename }) => ({
        data: files[filename] ?? `Not found. Available: ${Object.keys(files).join(', ')}`,
      }),
    }),

    buildTool({
      name: 'verifyFinding',
      description: 'Verify a specific finding by searching for its evidence in the actual code. Returns whether the evidence is confirmed, modified, or absent.',
      inputSchema: z.object({
        filename: z.string(),
        line: z.number().optional(),
        evidencePattern: z.string().describe('Pattern from the finding evidence to search for'),
      }),
      isReadOnly: () => true,
      call: async ({ filename, line, evidencePattern }) => {
        const content = files[filename]
        if (!content) return { data: `File ${filename} not found — finding is hallucinated` }
        const regex = new RegExp(evidencePattern, 'm')
        const found = regex.test(content)
        if (found && line) {
          const lines = content.split('\n')
          const actualLine = content.split('\n').findIndex(l => regex.test(l)) + 1
          const context = lines.slice(Math.max(0, actualLine - 3), actualLine + 3).join('\n')
          return { data: `CONFIRMED at line ${actualLine}:\n${context}` }
        }
        return { data: found ? 'CONFIRMED: pattern found in file' : 'NOT FOUND: pattern absent — likely hallucinated' }
      },
    }),

    buildTool({
      name: 'listFindings',
      description: 'Get all findings from expert agents organized by dimension and severity.',
      inputSchema: z.object({
        severity: z.enum(['critical', 'warning', 'info', 'all']).default('all'),
      }),
      isReadOnly: () => true,
      call: async ({ severity }) => ({
        data: JSON.stringify(
          severity === 'all' ? allFindings : allFindings.filter(f => f.severity === severity),
          null, 2
        ),
      }),
    }),

    buildTool({
      name: 'searchCode',
      description: 'Search for a pattern across all files to find evidence.',
      inputSchema: z.object({ pattern: z.string() }),
      isReadOnly: () => true,
      call: async ({ pattern }) => {
        const regex = new RegExp(pattern, 'gm')
        const results: string[] = []
        for (const [fname, content] of Object.entries(files)) {
          content.split('\n').forEach((line, idx) => {
            if (regex.test(line)) { results.push(`${fname}:${idx + 1}: ${line.trim()}`); regex.lastIndex = 0 }
          })
        }
        return { data: results.join('\n') || 'No matches found' }
      },
    }),
  ]
}
```

## Judge System Prompt (prompts.ts)

```typescript
export const JUDGE_SYSTEM_PROMPT = `
You are a senior judge reviewing the work of multiple code review agents. Your role is NOT
to review the code — that's already been done. Your role is to verify that the reviewers'
findings are accurate.

You are SKEPTICAL of every finding. LLM reviewers hallucinate. They claim line numbers that
don't exist, describe patterns that aren't there, and flag issues already handled.

=== YOUR RESPONSIBILITIES ===
1. ANTI-HALLUCINATION: For every critical and warning finding, use verifyFinding to confirm
   the evidence exists at the claimed location. If the pattern is absent → reject it.
2. DEDUPLICATION: Multiple agents may report the same issue. Merge duplicates, keep best evidence.
3. CONFLICT RESOLUTION: If agents disagree about the same code, use readFile to investigate
   and decide who's right.
4. SEVERITY CALIBRATION: Adjust severity based on actual impact given CSlate sandbox constraints.
5. CONFIDENCE ADJUSTMENT: Lower confidence for weak evidence, raise for strong.

=== CRITICAL RULES ===
- NEVER add new findings. You only verify, filter, and calibrate existing ones.
- ALWAYS use verifyFinding to check code evidence. Do NOT trust evidence field blindly.
- Info-level findings: pass through without deep verification (cost savings).
- If 3+ agents found the same issue independently, boost confidence significantly.

=== OUTPUT FORMAT (return ONLY this JSON, no markdown) ===
{
  "verifiedFindings": [
    { ...original ExpertFinding fields...,
      "verificationMethod": "code_confirmed"|"tool_confirmed",
      "verificationEvidence": "what verifyFinding returned",
      "adjustedSeverity": "critical"|"warning"|"info",
      "adjustedConfidence": 0-100 }
  ],
  "rejectedFindings": [
    { "original": {...ExpertFinding...},
      "rejectionReason": "hallucinated"|"duplicate"|"mitigated"|"insufficient_evidence",
      "explanation": "..." }
  ],
  "resolvedConflicts": [],
  "dimensionScores": [
    { "dimension": 1, "name": "...", "verdict": "pass"|"fail"|"warning",
      "confidence": 0-100, "summary": "...",
      "verifiedFindings": 0, "criticalCount": 0, "warningCount": 0 }
  ],
  "stats": {
    "totalFindingsReceived": 0, "hallucinated": 0, "duplicates": 0,
    "conflictsResolved": 0, "verified": 0
  }
}
`
```

## Judge index.ts

```typescript
export async function runJudge(
  files, manifest, staticResult, expertResults, redTeamResult, knowledgeBase?, config?
): Promise<JudgeResult> {
  const allFindings = expertResults.flatMap(r => r.findings)
  const registry = buildRegistry({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  })
  const tools = buildJudgeTools(files, allFindings)
  const maxIterations = config?.maxJudgeIterations ?? 12

  const findingSummary = allFindings
    .filter(f => f.severity !== 'info')
    .map(f => `[DIM${f.dimension}][${f.severity.toUpperCase()}] ${f.title} in ${f.file}:${f.line ?? '?'}`)
    .join('\n')

  const result = await runSubAgent({
    modelId: config?.modelOverrides?.judge ?? 'anthropic:claude-sonnet-4-6',
    registry,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: `Verify these ${allFindings.filter(f=>f.severity!=='info').length} non-info findings:\n\n${findingSummary}\n\nUse listFindings(all) then verifyFinding for each critical/warning finding.`,
    tools: toAISDKTools(tools),
    maxSteps: maxIterations,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text))
  return {
    ...parsed,
    iterationsUsed: result.steps,
    tokenCost: { input: result.usage.inputTokens, output: result.usage.outputTokens },
  } as JudgeResult
}
```

## Verdict Scoring (scoring.ts)

Implement EXACTLY as specified:

```typescript
import { DimensionScore, JudgeResult, RedTeamResult, ReviewVerdict, ReviewerConfig, ReviewCost, ReviewStats } from '../types'
import { DEFAULT_REVIEWER_CONFIG } from '../types'

function verdictScore(v: string): number {
  return v === 'pass' ? 1 : v === 'warning' ? 0.5 : 0
}

export function weightedAverage(dimensions: DimensionScore[]): number {
  const numerator = dimensions.reduce((sum, d) => sum + d.weight * d.confidence * verdictScore(d.verdict), 0)
  const denominator = dimensions.reduce((sum, d) => sum + d.weight, 0)
  return denominator === 0 ? 0 : numerator / denominator
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

  // Decision cascade — order matters
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
  const warningCount = judgeResult.verifiedFindings.filter(f => (f.adjustedSeverity ?? f.severity) === 'warning').length
  if (warningCount > maxWarnings) {
    return buildVerdict('rejected', `${warningCount} warnings exceeds limit of ${maxWarnings}`, scorecard, judgeResult, redTeamResult, stats, cost)
  }

  return buildVerdict('approved', 'All dimensions passed review', scorecard, judgeResult, redTeamResult, stats, cost)
}
```

## Report Renderer (report-renderer.ts)

```typescript
export function renderReport(verdict: ReviewVerdict, componentName: string, version: string): string {
  const icon = verdict.decision === 'approved' ? '✅' : '❌'
  return `# Review Report: ${componentName} v${version}

## Verdict: ${icon} ${verdict.decision.toUpperCase()}
**Reason:** ${verdict.decisionReason}
**Confidence:** ${verdict.decisionConfidence}%
**Duration:** ${verdict.stats.totalDuration}ms
**Cost:** $${verdict.cost.totalEstimatedCost.toFixed(4)}

## Scorecard
| # | Dimension | Verdict | Confidence | Critical | Warnings |
|---|-----------|---------|------------|----------|----------|
${verdict.scorecard.map(d =>
  `| ${d.dimension} | ${d.name} | ${d.verdict.toUpperCase()} | ${d.confidence}% | ${d.findings.critical} | ${d.findings.warning} |`
).join('\n')}

## Critical Findings
${verdict.findings.filter(f => (f.adjustedSeverity ?? f.severity) === 'critical').map(f =>
  `### ${f.title}\n- **File:** ${f.file}:${f.line ?? '?'}\n- **Evidence:** ${f.evidence}\n- **Reasoning:** ${f.reasoning}`
).join('\n\n') || '_None_'}

## Warnings
${verdict.findings.filter(f => (f.adjustedSeverity ?? f.severity) === 'warning').map(f =>
  `- [Dim ${f.dimension}] **${f.title}** in \`${f.file}:${f.line ?? '?'}\``
).join('\n') || '_None_'}

## Threat Assessment
- **Overall Threat Level:** ${verdict.threatAssessment.overallThreatLevel.toUpperCase()}
- **Sandbox Escape Risk:** ${verdict.threatAssessment.sandboxEscapeRisk}/100
- **Data Exfiltration Risk:** ${verdict.threatAssessment.dataExfiltrationRisk}/100
- **Supply Chain Risk:** ${verdict.threatAssessment.supplyChainRisk}/100
- **Prompt Injection Risk:** ${verdict.threatAssessment.promptInjectionRisk}/100
`
}
```

## TDD Approach

1. **scoring.test.ts**: Test `weightedAverage` with known inputs. Test each rejection condition in `computeVerdict`.
2. **judge/tools.test.ts**: Test `verifyFinding` with mock files — confirmed, not-found, hallucinated cases.
3. **judge/index.test.ts**: Mock `runSubAgent` → verify JudgeResult parsed correctly.
4. **verdict/index.test.ts**: Test each rejection path with fixtures (security fail, critical finding, low score, too many warnings).
5. **report-renderer.test.ts**: Snapshot test — approved and rejected report formats.

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/judge/__tests__/ packages/pipeline/src/reviewer-agent/verdict/__tests__/ --reporter verbose`

## When You're Done

Judge agent runs, verdict decision cascade is correct for all cases, report renders, tests pass.

<promise>JUDGE VERDICT COMPLETE</promise>
