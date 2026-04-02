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
import type {
  AgentReviewProgressCallback,
  ReviewStats,
  ReviewCost,
  StaticFinding,
  StaticAnalysisResult,
  ExpertAgentResult,
  RedTeamResult,
  JudgeResult,
  VerifiedFinding,
  FinalDimensionScore,
} from './types'
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
  const expertResults = await runExpertAgents(ctx.files, ctx.manifest as Record<string, unknown>, staticResult, knowledgeBase, config)
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
    redTeamResult = await runRedTeam(ctx.files, ctx.manifest as Record<string, unknown>, staticResult, expertResults, config)
    await onProgress?.({ phase: 'red_team', status: 'complete' })
    await trackCost('red_team', config.modelOverrides.redTeam ?? 'claude-sonnet-4-6', redTeamResult.tokenCost)

    // ─── Phase 4: Judge ────────────────────────────────────────────────────
    await onProgress?.({ phase: 'judge', status: 'in_progress' })
    judgeResult = await runJudge(ctx.files, ctx.manifest as Record<string, unknown>, staticResult, expertResults, redTeamResult, knowledgeBase, config)
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

// ─── Helper Functions ──────────────────────────────────────────────────────

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

function buildMinimalJudgeResult(expertResults: ExpertAgentResult[]): JudgeResult {
  const allFindings = expertResults.flatMap(r => r.findings)
  const verifiedFindings: VerifiedFinding[] = allFindings.map(f => ({
    ...f,
    verificationMethod: 'reasoning_confirmed' as const,
    verificationEvidence: 'Security expert confirmed — red-team and judge skipped',
  }))

  const dimensionScores: FinalDimensionScore[] = expertResults
    .flatMap(r => r.dimensions)
    .map(d => ({
      dimension: d.dimension,
      name: d.name,
      verdict: d.verdict,
      confidence: d.confidence,
      summary: d.summary,
      verifiedFindings: verifiedFindings.filter(f => f.dimension === d.dimension).length,
      criticalCount: verifiedFindings.filter(f => f.dimension === d.dimension && f.severity === 'critical').length,
      warningCount: verifiedFindings.filter(f => f.dimension === d.dimension && f.severity === 'warning').length,
    }))

  return {
    verifiedFindings,
    rejectedFindings: [],
    resolvedConflicts: [],
    dimensionScores,
    stats: {
      totalFindingsReceived: allFindings.length,
      hallucinated: 0,
      duplicates: 0,
      conflictsResolved: 0,
      verified: verifiedFindings.length,
    },
    iterationsUsed: 0,
    tokenCost: { input: 0, output: 0 },
  }
}

function buildMinimalRedTeamResult(): RedTeamResult {
  return {
    exploitAttempts: [],
    overallThreatLevel: 'none',
    sandboxEscapeRisk: 0,
    dataExfiltrationRisk: 0,
    supplyChainRisk: 0,
    promptInjectionRisk: 0,
    iterationsUsed: 0,
    tokenCost: { input: 0, output: 0 },
  }
}

function buildStats(
  startTime: number,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  redTeamResult: RedTeamResult | null,
  judgeResult: JudgeResult,
): ReviewStats {
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
