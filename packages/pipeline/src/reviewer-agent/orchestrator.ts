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
} from './types'
import { DEFAULT_REVIEWER_CONFIG } from './types'
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:reviewer-agent')

// ─── Phase Timeouts (ms) ─────────────────────────────────────────────────────

const PHASE_TIMEOUTS = {
  static_analysis: 30_000,      // 30s — fast, local analysis
  expert_agents: 180_000,       // 3min — 3 parallel LLM agents
  red_team: 120_000,            // 2min — single LLM agent
  judge: 120_000,               // 2min — single LLM agent
} as const

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Phase "${label}" timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('rate limit') || msg.includes('429') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('socket hang up')
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = MAX_RETRIES): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries && isTransientError(err)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt)
        log.warn({ label, attempt, delay, err }, 'transient error — retrying')
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
  throw lastError
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

export async function agentReview(
  ctx: PipelineContext,
  onProgress?: AgentReviewProgressCallback,
): Promise<StageResult> {
  const startTime = Date.now()
  const db = getDb()
  const config = await getReviewerConfig(db)
  const knowledgeBase = await loadKnowledgeBase(db)
  const costEntries: ReviewCost['perPhase'] = []
  const phaseDurations: ReviewStats['phaseDurations'] = {
    staticAnalysis: 0, expertAgents: 0, redTeam: 0, judge: 0, verdict: 0,
  }

  log.info({ uploadId: ctx.uploadId, componentName: (ctx.manifest as any).name }, 'agent review start')

  const trackCost = async (phase: string, model: string, tokens: { input: number; output: number }) => {
    await trackReviewCost(db, ctx.uploadId, phase, model, tokens)
    const { estimateCost } = await import('./config/cost-tracker')
    costEntries.push({ phase, model, tokens, estimatedCost: estimateCost(model, tokens) })
  }

  // ─── Phase 1: Static Analysis ───────────────────────────────────────────
  await onProgress?.({ phase: 'static_analysis', status: 'in_progress', detail: 'Running pattern matching, AST parsing, and type checking' })
  const phaseStart1 = Date.now()
  const staticResult = await withTimeout(
    runStaticAnalysis(ctx.files, ctx.manifest),
    PHASE_TIMEOUTS.static_analysis,
    'static_analysis',
  )
  phaseDurations.staticAnalysis = Date.now() - phaseStart1
  log.debug({
    uploadId: ctx.uploadId,
    phase: 'static_analysis',
    durationMs: phaseDurations.staticAnalysis,
    criticalFindings: staticResult.criticalFindings.length,
    warnings: staticResult.warnings.length,
  }, 'phase done')
  await onProgress?.({ phase: 'static_analysis', status: 'complete', detail: `${staticResult.criticalFindings.length} critical, ${staticResult.warnings.length} warnings in ${phaseDurations.staticAnalysis}ms` })

  // Short-circuit on critical static findings
  if (staticResult.criticalFindings.length > 0) {
    log.warn({ uploadId: ctx.uploadId, phase: 'static_analysis', criticalFindings: staticResult.criticalFindings.length }, 'short-circuit: critical static findings')
    return buildRejectResult('static_analysis', staticResult.criticalFindings, startTime)
  }

  // ─── Phase 2: Parallel Expert Agents ────────────────────────────────────
  await onProgress?.({ phase: 'expert_agents', status: 'in_progress', detail: 'Running security, quality, and standards experts in parallel' })
  const phaseStart2 = Date.now()
  const expertResults = await withTimeout(
    withRetry(
      () => runExpertAgents(ctx.files, ctx.manifest as Record<string, unknown>, staticResult, knowledgeBase, config),
      'expert_agents',
    ),
    PHASE_TIMEOUTS.expert_agents,
    'expert_agents',
  )
  phaseDurations.expertAgents = Date.now() - phaseStart2
  const totalExpertFindings = expertResults.reduce((sum, r) => sum + r.findings.length, 0)
  await onProgress?.({ phase: 'expert_agents', status: 'complete', detail: `${totalExpertFindings} findings from 3 experts in ${phaseDurations.expertAgents}ms` })

  // Track cost for each expert
  for (const expert of expertResults) {
    const model = config.modelOverrides[expert.agent as keyof typeof config.modelOverrides] ?? 'openai:moonshotai/kimi-k2.6'
    await trackCost(expert.agent, model, expert.tokenCost)
  }

  // Determine short-circuit strategy:
  // - Security critical → skip red-team (component is hostile, no point probing further)
  //   but still run judge to verify the security findings aren't hallucinated
  // - Quality/standards critical → still run red-team and judge (quality issues don't imply security risk)
  const securityResult = expertResults.find(r => r.agent === 'security-expert')
  const securityFailed = securityResult?.dimensions.some(d => d.tier === 'security' && d.verdict === 'fail')

  log.debug({
    uploadId: ctx.uploadId,
    phase: 'expert_agents',
    durationMs: phaseDurations.expertAgents,
    totalFindings: totalExpertFindings,
    securityFailed: !!securityFailed,
  }, 'phase done')

  let redTeamResult: RedTeamResult
  let judgeResult: JudgeResult

  if (securityFailed) {
    // Skip red-team — security already failed, no point in adversarial probing
    await onProgress?.({ phase: 'red_team', status: 'skipped', detail: 'Security expert found critical failures — skipping adversarial analysis' })
    log.debug({ uploadId: ctx.uploadId, phase: 'red_team' }, 'phase skipped — security already failed')
    redTeamResult = buildMinimalRedTeamResult()
  } else {
    // ─── Phase 3: Red-Team ─────────────────────────────────────────────────
    await onProgress?.({ phase: 'red_team', status: 'in_progress', detail: 'Running adversarial attack simulation' })
    const phaseStart3 = Date.now()
    redTeamResult = await withTimeout(
      withRetry(
        () => runRedTeam(ctx.files, ctx.manifest as Record<string, unknown>, staticResult, expertResults, config),
        'red_team',
      ),
      PHASE_TIMEOUTS.red_team,
      'red_team',
    )
    phaseDurations.redTeam = Date.now() - phaseStart3
    log.debug({
      uploadId: ctx.uploadId,
      phase: 'red_team',
      durationMs: phaseDurations.redTeam,
      threatLevel: redTeamResult.overallThreatLevel,
      exploitAttempts: redTeamResult.exploitAttempts.length,
    }, 'phase done')
    await onProgress?.({ phase: 'red_team', status: 'complete', detail: `Threat level: ${redTeamResult.overallThreatLevel}, ${redTeamResult.exploitAttempts.length} exploit attempts in ${phaseDurations.redTeam}ms` })
    await trackCost('red_team', config.modelOverrides.redTeam ?? 'openai:moonshotai/kimi-k2.6', redTeamResult.tokenCost)
  }

  // ─── Phase 4: Judge — always runs to verify findings aren't hallucinated ──
  await onProgress?.({ phase: 'judge', status: 'in_progress', detail: 'Verifying findings and detecting hallucinations' })
  const phaseStart4 = Date.now()
  judgeResult = await withTimeout(
    withRetry(
      () => runJudge(ctx.files, ctx.manifest as Record<string, unknown>, staticResult, expertResults, redTeamResult, knowledgeBase, config),
      'judge',
    ),
    PHASE_TIMEOUTS.judge,
    'judge',
  )
  phaseDurations.judge = Date.now() - phaseStart4
  log.debug({
    uploadId: ctx.uploadId,
    phase: 'judge',
    durationMs: phaseDurations.judge,
    verifiedFindings: judgeResult.verifiedFindings.length,
    hallucinated: judgeResult.stats.hallucinated,
  }, 'phase done')
  await onProgress?.({ phase: 'judge', status: 'complete', detail: `${judgeResult.verifiedFindings.length} verified, ${judgeResult.rejectedFindings.length} rejected (${judgeResult.stats.hallucinated} hallucinated) in ${phaseDurations.judge}ms` })
  await trackCost('judge', config.modelOverrides.judge ?? 'openai:moonshotai/kimi-k2.6', judgeResult.tokenCost)

  // ─── Phase 5: Verdict ──────────────────────────────────────────────────
  await onProgress?.({ phase: 'verdict', status: 'in_progress', detail: 'Computing scores and rendering report' })
  const phaseStart5 = Date.now()
  const stats = buildStats(startTime, phaseDurations, staticResult, expertResults, redTeamResult, judgeResult)
  const cost = buildCost(costEntries)
  const verdict = computeVerdict(judgeResult, redTeamResult, config, stats, cost)
  phaseDurations.verdict = Date.now() - phaseStart5
  stats.phaseDurations.verdict = phaseDurations.verdict
  const totalCost = costEntries.reduce((sum, e) => sum + e.estimatedCost, 0)
  const totalTokens = costEntries.reduce((acc, e) => ({ input: acc.input + e.tokens.input, output: acc.output + e.tokens.output }), { input: 0, output: 0 })
  log.info({
    uploadId: ctx.uploadId,
    decision: verdict.decision,
    decisionReason: verdict.decisionReason,
    totalDurationMs: Date.now() - startTime,
    phaseDurations,
    totalInputTokens: totalTokens.input,
    totalOutputTokens: totalTokens.output,
    estimatedCostUsd: totalCost.toFixed(4),
    hallucinationRate: stats.hallucinationRate.toFixed(2),
  }, 'agent review done')
  await onProgress?.({ phase: 'verdict', status: 'complete', detail: `${verdict.decision}: ${verdict.decisionReason}` })

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
  phaseDurations: ReviewStats['phaseDurations'],
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  redTeamResult: RedTeamResult,
  judgeResult: JudgeResult,
): ReviewStats {
  const allFindings = expertResults.flatMap(r => r.findings)
  return {
    totalDuration: Date.now() - startTime,
    phaseDurations,
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
      redTeam: redTeamResult.iterationsUsed,
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
