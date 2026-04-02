import { buildRegistry, toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
import {
  ExpertAgentResult,
  JudgeResult,
  RedTeamResult,
  ReviewerConfig,
  ReviewerKnowledgeBase,
  StaticAnalysisResult,
} from '../types'
import { buildJudgeTools } from './tools'
import { JUDGE_SYSTEM_PROMPT } from './prompts'

export async function runJudge(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  redTeamResult: RedTeamResult,
  knowledgeBase?: ReviewerKnowledgeBase,
  config?: Partial<ReviewerConfig>,
): Promise<JudgeResult> {
  const allFindings = expertResults.flatMap(r => r.findings)
  const registry = buildRegistry({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  })
  const tools = buildJudgeTools(files, allFindings)
  const maxIterations = config?.maxJudgeIterations ?? 12

  const nonInfoFindings = allFindings.filter(f => f.severity !== 'info')
  const findingSummary = nonInfoFindings
    .map(f => `[DIM${f.dimension}][${f.severity.toUpperCase()}] ${f.title} in ${f.file}:${f.line ?? '?'}`)
    .join('\n')

  const result = await runSubAgent({
    modelId: config?.modelOverrides?.judge ?? 'anthropic:claude-sonnet-4-6',
    registry,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: `Verify these ${nonInfoFindings.length} non-info findings:\n\n${findingSummary}\n\nUse listFindings(all) then verifyFinding for each critical/warning finding.`,
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
