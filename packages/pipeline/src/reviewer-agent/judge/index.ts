import { toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
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
  const tools = buildJudgeTools(files, allFindings)
  const modelId = config?.modelOverrides?.judge ?? 'anthropic:claude-sonnet-4-6'

  const prompt = [
    `You are reviewing findings from ${expertResults.length} expert agents.`,
    `Total findings to verify: ${allFindings.length} (${allFindings.filter(f => f.severity === 'critical').length} critical, ${allFindings.filter(f => f.severity === 'warning').length} warnings).`,
    `Red-team threat level: ${redTeamResult.overallThreatLevel}.`,
    `\nStart with listFindings({severity:"critical"}) to see the most important items, then verifyFinding for each one.`,
  ].join('\n')

  const result = await runSubAgent({
    modelId,
    registry,
    system: JUDGE_SYSTEM_PROMPT,
    prompt,
    tools: toAISDKTools(tools),
    maxSteps: config?.maxJudgeIterations ?? 12,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text)) as JudgeResult
  parsed.iterationsUsed = result.steps
  parsed.tokenCost = { input: result.usage.inputTokens, output: result.usage.outputTokens }
  return parsed
}
