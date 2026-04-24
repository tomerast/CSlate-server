import type {
  JudgeResult,
  StaticAnalysisResult,
  ExpertAgentResult,
  RedTeamResult,
  ReviewerKnowledgeBase,
  ReviewerConfig,
} from '../types'
import { buildAgentRegistry } from '../config/registry'
import { buildJudgeTools } from './tools'
import { JUDGE_SYSTEM_PROMPT } from './prompts'
import { runReviewAgent } from '../create-review-agent'

export async function runJudge(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  redTeamResult: RedTeamResult,
  knowledgeBase?: ReviewerKnowledgeBase,
  config?: ReviewerConfig,
): Promise<JudgeResult> {
  const registry = buildAgentRegistry()
  const allFindings = expertResults.flatMap(r => r.findings)

  return runReviewAgent<JudgeResult>({
    agentName: 'judge',
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    tools: buildJudgeTools(files, allFindings),
    modelId: config?.modelOverrides?.judge ?? 'openai:moonshotai/kimi-k2.6',
    maxSteps: config?.maxJudgeIterations ?? 12,
    buildPrompt: () => [
      `You are reviewing findings from ${expertResults.length} expert agents.`,
      `Total findings to verify: ${allFindings.length} (${allFindings.filter(f => f.severity === 'critical').length} critical, ${allFindings.filter(f => f.severity === 'warning').length} warnings).`,
      `Red-team threat level: ${redTeamResult.overallThreatLevel}.`,
      `\nStart with listFindings({severity:"critical"}) to see the most important items, then verifyFinding for each one.`,
    ].join('\n'),
    parseResult: result => result,
  }, registry)
}
