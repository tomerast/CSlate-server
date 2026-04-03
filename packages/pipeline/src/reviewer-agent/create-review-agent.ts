import { toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
import type { AgentRegistry } from '@cslate/shared/agent'
import type { CSTool } from '@cslate/shared/agent'
import type { ReviewerKnowledgeBase, ReviewerConfig } from './types'
import { injectKnowledge } from './learning/knowledge-injector'

const MAX_OUTPUT_TOKENS = 16_000

export interface ReviewAgentConfig<TResult> {
  agentName: string
  systemPrompt: string
  tools: CSTool[]
  modelId: string
  maxSteps: number
  knowledgeDimensions?: number[]
  knowledgeBase?: ReviewerKnowledgeBase
  buildPrompt: () => string
  parseResult: (raw: TResult) => TResult
}

export async function runReviewAgent<TResult>(
  config: ReviewAgentConfig<TResult>,
  registry: AgentRegistry,
): Promise<TResult> {
  let system = config.systemPrompt
  if (config.knowledgeBase && config.knowledgeDimensions) {
    system = injectKnowledge(system, config.knowledgeBase, config.knowledgeDimensions)
  }

  const result = await runSubAgent({
    modelId: config.modelId,
    registry,
    system,
    prompt: config.buildPrompt(),
    tools: toAISDKTools(config.tools),
    maxSteps: config.maxSteps,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  const parsed = JSON.parse(stripFences(result.text)) as TResult & {
    tokenCost?: { input: number; output: number }
    iterationsUsed?: number
  }
  parsed.tokenCost = { input: result.usage.inputTokens, output: result.usage.outputTokens }
  parsed.iterationsUsed = result.steps
  return config.parseResult(parsed)
}
