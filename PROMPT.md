# Ralph Loop: Orchestrator + Runner Integration

## Mission

Build the orchestrator that wires all 5 phases of the reviewer agent together, and integrate it into the existing pipeline runner. This is the FINAL piece — it imports from all other modules.

## Scope

Build `packages/pipeline/src/reviewer-agent/orchestrator.ts` and modify the pipeline runner and worker handler.

## Key Files

**Create:**
- `packages/pipeline/src/reviewer-agent/orchestrator.ts` — Main orchestrator function
- `packages/pipeline/src/reviewer-agent/index.ts` — Public API exports
- Tests for orchestrator

**Modify:**
- `packages/pipeline/src/runner.ts` — New stage order (remove old security/quality/test stages, add agent_review)
- `packages/pipeline/src/pipeline-runner.ts` — Same for pipeline reviews
- `packages/pipeline/src/index.ts` — Export reviewer agent
- `apps/worker/src/handlers/review.ts` — Use new stage
- `apps/worker/src/handlers/pipeline-review.ts` — Use new stage

**Read (do NOT modify — import from these):**
- `packages/pipeline/src/reviewer-agent/types.ts` — All shared types
- `packages/pipeline/src/reviewer-agent/static/index.ts` — `runStaticAnalysis()`
- `packages/pipeline/src/reviewer-agent/experts/index.ts` — `runExpertAgents()`
- `packages/pipeline/src/reviewer-agent/red-team/index.ts` — `runRedTeam()`
- `packages/pipeline/src/reviewer-agent/judge/index.ts` — `runJudge()`
- `packages/pipeline/src/reviewer-agent/verdict/index.ts` — `computeVerdict()`, `renderReport()`
- `packages/pipeline/src/reviewer-agent/learning/index.ts` — `loadKnowledgeBase()`, `recordReviewOutcome()`
- `packages/pipeline/src/reviewer-agent/config/index.ts` — `getReviewerConfig()`
- `packages/pipeline/src/reviewer-agent/config/cost-tracker.ts` — `trackReviewCost()`
- `packages/pipeline/src/types.ts` — `StageResult`, `PipelineContext`, `Issue`
- `packages/db/src/client.ts` — `getDb()`, `type Db`

## Interface Contract

```typescript
import { StageResult, PipelineContext } from '../types'
import { AgentReviewProgressCallback } from './types'

// The main entry point — called by the pipeline runner as a StageFunction
export async function agentReview(
  ctx: PipelineContext,
  onProgress?: AgentReviewProgressCallback,
): Promise<StageResult>
```

## Orchestrator Logic (orchestrator.ts)

```typescript
import { getDb } from '@cslate/db'
import { runStaticAnalysis } from './static'
import { runExpertAgents } from './experts'
import { runRedTeam } from './red-team'
import { runJudge } from './judge'
import { computeVerdict, renderReport } from './verdict'
import { loadKnowledgeBase, recordReviewOutcome } from './learning'
import { getReviewerConfig } from './config'
import { trackReviewCost } from './config/cost-tracker'
import type { PipelineContext, StageResult } from '../types'
import type { AgentReviewProgressCallback, ReviewStats, ReviewCost } from './types'
import { DEFAULT_REVIEWER_CONFIG } from './types'

export async function agentReview(
  ctx: PipelineContext,
  onProgress?: AgentReviewProgressCallback,
): Promise<StageResult> {
  const startTime = Date.now()
  const db = getDb()
  const config = await getReviewerConfig(db)
  const knowledgeBase = await loadKnowledgeBase(db)
  const costEntries: ReviewCost['perPhase'] = []

  const trackCost = async (phase: string, model: string, tokens: { input: number; output: number }) => {
    await trackReviewCost(db, ctx.uploadId, phase, model, tokens)
    const { estimateCost } = await import('./config/cost-tracker')
    costEntries.push({ phase, model, tokens, estimatedCost: estimateCost(model, tokens) })
  }

  // ─── Phase 1: Static Analysis ───────────────────────────────────────────
  await onProgress?.({ phase: 'static_analysis', status: 'in_progress' })
  const staticResult = await runStaticAnalysis(ctx.files, ctx.manifest)
  await onProgress?.({ phase: 'static_analysis', status: 'complete' })

  // Short-circuit on critical static findings
  if (staticResult.criticalFindings.length > 0) {
    return buildRejectResult('static_analysis', staticResult.criticalFindings, startTime)
  }

  // ─── Phase 2: Parallel Expert Agents ────────────────────────────────────
  await onProgress?.({ phase: 'expert_agents', status: 'in_progress' })
  const expertResults = await runExpertAgents(ctx.files, ctx.manifest, staticResult, knowledgeBase, config)
  await onProgress?.({ phase: 'expert_agents', status: 'complete' })

  // Track cost for each expert
  for (const expert of expertResults) {
    const model = config.modelOverrides[expert.agent as keyof typeof config.modelOverrides] ?? 'claude-sonnet-4-6'
    await trackCost(expert.agent, model, expert.tokenCost)
  }

  // Short-circuit if Security Expert has any dimension 1-3 fail
  const securityResult = expertResults.find(r => r.agent === 'security-expert')
  const securityFailed = securityResult?.dimensions.some(d => d.tier === 'security' && d.verdict === 'fail')

  let redTeamResult: Awaited<ReturnType<typeof runRedTeam>> | null = null
  let judgeResult: Awaited<ReturnType<typeof runJudge>> | null = null

  if (!securityFailed) {
    // ─── Phase 3: Red-Team ─────────────────────────────────────────────────
    await onProgress?.({ phase: 'red_team', status: 'in_progress' })
    redTeamResult = await runRedTeam(ctx.files, ctx.manifest, staticResult, expertResults, config)
    await onProgress?.({ phase: 'red_team', status: 'complete' })
    await trackCost('red_team', config.modelOverrides.redTeam ?? 'claude-sonnet-4-6', redTeamResult.tokenCost)

    // ─── Phase 4: Judge ────────────────────────────────────────────────────
    await onProgress?.({ phase: 'judge', status: 'in_progress' })
    judgeResult = await runJudge(ctx.files, ctx.manifest, staticResult, expertResults, redTeamResult, knowledgeBase, config)
    await onProgress?.({ phase: 'judge', status: 'complete' })
    await trackCost('judge', config.modelOverrides.judge ?? 'claude-sonnet-4-6', judgeResult.tokenCost)
  } else {
    await onProgress?.({ phase: 'red_team', status: 'skipped' })
    await onProgress?.({ phase: 'judge', status: 'skipped' })
    // Create minimal judge result from expert findings for verdict
    judgeResult = buildMinimalJudgeResult(expertResults)
    redTeamResult = buildMinimalRedTeamResult()
  }

  // ─── Phase 5: Verdict ──────────────────────────────────────────────────
  await onProgress?.({ phase: 'verdict', status: 'in_progress' })
  const stats = buildStats(startTime, staticResult, expertResults, redTeamResult, judgeResult)
  const cost = buildCost(costEntries)
  const verdict = computeVerdict(judgeResult, redTeamResult, config, stats, cost)
  await onProgress?.({ phase: 'verdict', status: 'complete' })

  // Record outcome for learning
  await recordReviewOutcome(db, verdict, ctx.uploadId)

  // Return as StageResult
  return {
    stage: 'agent_review',
    status: verdict.decision === 'approved' ? 'passed' : 'failed',
    duration: Date.now() - startTime,
    issues: verdict.findings.map(f => ({
      severity: f.adjustedSeverity ?? f.severity,
      file: f.file,
      line: f.line,
      pattern: f.title,
      message: f.description,
    })),
    data: {
      verdict,
      report: renderReport(verdict, String((ctx.manifest as any).name ?? 'Unknown'), String((ctx.manifest as any).version ?? '1.0.0')),
    },
  }
}
```

## Helper Functions

```typescript
function buildRejectResult(phase: string, criticalFindings: StaticFinding[], startTime: number): StageResult {
  return {
    stage: 'agent_review',
    status: 'failed',
    duration: Date.now() - startTime,
    issues: criticalFindings.map(f => ({
      severity: f.severity,
      file: f.file,
      line: f.line,
      pattern: f.pattern,
      message: `[${phase.toUpperCase()} SHORT CIRCUIT] ${f.message}`,
    })),
    data: { shortCircuit: phase, findingsCount: criticalFindings.length },
  }
}

function buildStats(startTime: number, staticResult: StaticAnalysisResult, expertResults: ExpertAgentResult[], redTeamResult: RedTeamResult | null, judgeResult: JudgeResult): ReviewStats {
  const allFindings = expertResults.flatMap(r => r.findings)
  return {
    totalDuration: Date.now() - startTime,
    phaseDurations: {
      staticAnalysis: staticResult.duration,
      expertAgents: 0,
      redTeam: 0,
      judge: 0,
      verdict: 0,
    },
    totalFindings: allFindings.length,
    verifiedFindings: judgeResult.verifiedFindings.length,
    rejectedFindings: judgeResult.rejectedFindings.length,
    hallucinationRate: judgeResult.stats.totalFindingsReceived > 0
      ? judgeResult.stats.hallucinated / judgeResult.stats.totalFindingsReceived
      : 0,
    iterationsUsed: {
      securityExpert: expertResults.find(r => r.agent === 'security-expert')?.iterationsUsed ?? 0,
      qualityExpert: expertResults.find(r => r.agent === 'quality-expert')?.iterationsUsed ?? 0,
      standardsExpert: expertResults.find(r => r.agent === 'standards-expert')?.iterationsUsed ?? 0,
      redTeam: redTeamResult?.iterationsUsed ?? 0,
      judge: judgeResult.iterationsUsed,
    },
  }
}

function buildCost(entries: ReviewCost['perPhase']): ReviewCost {
  const totalTokens = entries.reduce(
    (acc, e) => ({ input: acc.input + e.tokens.input, output: acc.output + e.tokens.output }),
    { input: 0, output: 0 }
  )
  return {
    totalTokens,
    perPhase: entries,
    totalEstimatedCost: entries.reduce((sum, e) => sum + e.estimatedCost, 0),
  }
}
```

## Runner Modifications

### runner.ts — New component pipeline stage order:
1. `manifest_validation` (unchanged)
2. `dependency_check` (unchanged)
3. `agent_review` (NEW — replaces security_scan + quality_review + test_render)
4. `cataloging` (unchanged)
5. `embedding` (unchanged)

**Keep old stages in the file but don't include them in STAGES array** (backward compat for `previousResults`).

**Skip logic**: If `previousResults` contains `security_scan` OR `quality_review`, treat as `agent_review` already done:

```typescript
const completedStageNames = new Set(ctx.previousResults.map(r => r.stage))
// Backward compatibility: old stage names count as agent_review
if (completedStageNames.has('security_scan') || completedStageNames.has('quality_review')) {
  completedStageNames.add('agent_review')
}
```

### pipeline-runner.ts — Same changes for pipeline review

## Progress Streaming in Worker Handlers

```typescript
// In apps/worker/src/handlers/review.ts:
import { sql } from 'drizzle-orm'

const progressCallback: AgentReviewProgressCallback = async (progress) => {
  await db.execute(sql`SELECT pg_notify('review_progress', ${JSON.stringify({
    uploadId: ctx.uploadId,
    ...progress,
  })})`)
}

const result = await agentReview(ctx, progressCallback)
```

## TDD Approach

1. **orchestrator.test.ts**: Mock all 5 phase functions → verify call order, verify progress callback fired at each phase transition
2. **short-circuit phase 1 test**: Static returns critical → phases 2-5 NOT called
3. **short-circuit phase 2 test**: Security expert fails → red-team and judge skipped, still runs verdict
4. **progress callback test**: Verify all 5 phases fire in_progress then complete (or skipped)
5. **StageResult shape test**: approved/rejected verdict maps to passed/failed status
6. **backward compat test**: previousResults with 'security_scan' → agent_review skipped in new pipeline

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/__tests__/ --reporter verbose`

## When You're Done

Orchestrator wires all phases, runner uses new stages, backward compat maintained, progress streaming works, tests pass.

<promise>ORCHESTRATOR COMPLETE</promise>
