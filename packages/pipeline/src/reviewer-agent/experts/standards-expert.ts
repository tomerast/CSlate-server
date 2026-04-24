import type { AgentRegistry } from '@cslate/shared/agent'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../types'
import { buildExpertTools } from './tools'
import { STANDARDS_EXPERT_SYSTEM_PROMPT } from './prompts'
import { runReviewAgent } from '../create-review-agent'

export async function runStandardsExpert(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
  registry: AgentRegistry,
): Promise<ExpertAgentResult> {
  const fileList = Object.keys(files).join(', ')
  const staticSummary = `Static analysis found: ${staticResult.criticalFindings.length} critical, ${staticResult.warnings.length} warnings`

  return runReviewAgent<ExpertAgentResult>({
    agentName: 'standards-expert',
    systemPrompt: STANDARDS_EXPERT_SYSTEM_PROMPT,
    tools: buildExpertTools(files, manifest, staticResult),
    modelId: config.modelOverrides?.standardsExpert ?? 'openai:moonshotai/kimi-k2.6',
    maxSteps: config.maxExpertAgentIterations ?? 12,
    knowledgeDimensions: [8, 9, 10],
    knowledgeBase,
    buildPrompt: () => `Review this component.\n\nFiles: ${fileList}\n${staticSummary}\n\nStart with getStaticAnalysisFindings(), then readFile each source file, then investigate with searchCode and checkPattern.`,
    parseResult: result => result,
  }, registry)
}
