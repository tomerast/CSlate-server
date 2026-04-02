import { toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
import type { AgentRegistry } from '@cslate/shared/agent'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../types'
import { buildExpertTools } from './tools'
import { STANDARDS_EXPERT_SYSTEM_PROMPT } from './prompts'

export async function runStandardsExpert(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
  registry: AgentRegistry,
): Promise<ExpertAgentResult> {
  const tools = buildExpertTools(files, manifest, staticResult)
  const modelId = config.modelOverrides?.standardsExpert ?? 'anthropic:claude-haiku-4-5-20251001'

  let systemPrompt = STANDARDS_EXPERT_SYSTEM_PROMPT
  try {
    const { injectKnowledge } = await import('../learning/knowledge-injector')
    systemPrompt = injectKnowledge(systemPrompt, knowledgeBase, [8, 9, 10])
  } catch { /* learning module not yet available */ }

  const fileList = Object.keys(files).join(', ')
  const staticSummary = `Static analysis found: ${staticResult.criticalFindings.length} critical, ${staticResult.warnings.length} warnings`

  const result = await runSubAgent({
    modelId,
    registry,
    system: systemPrompt,
    prompt: `Review this component.\n\nFiles: ${fileList}\n${staticSummary}\n\nStart with getStaticAnalysisFindings(), then readFile each source file, then investigate with searchCode and checkPattern.`,
    tools: toAISDKTools(tools),
    maxSteps: config.maxExpertAgentIterations ?? 12,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text)) as ExpertAgentResult
  parsed.tokenCost = { input: result.usage.inputTokens, output: result.usage.outputTokens }
  parsed.iterationsUsed = result.steps
  return parsed
}
