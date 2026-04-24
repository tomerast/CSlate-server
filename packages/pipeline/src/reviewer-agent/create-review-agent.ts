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

  const stripped = stripFences(result.text || '')
  if (!stripped) {
    throw new Error(
      `LLM returned empty text after ${result.steps} steps. ` +
      `This usually means the model hit the step/token limit before producing a final answer. ` +
      `Usage: ${result.usage.inputTokens}/${result.usage.outputTokens} tokens.`
    )
  }
  let parsed: TResult & { tokenCost?: { input: number; output: number }; iterationsUsed?: number }
  try {
    parsed = JSON.parse(stripped)
  } catch (parseErr) {
    throw new Error(
      `LLM response is not valid JSON after ${result.steps} steps. ` +
      `Response text (first 500 chars): "${stripped.slice(0, 500)}" ` +
      `Usage: ${result.usage.inputTokens}/${result.usage.outputTokens} tokens.`
    )
  }
  parsed.tokenCost = { input: result.usage.inputTokens, output: result.usage.outputTokens }
  parsed.iterationsUsed = result.steps
  return config.parseResult(parsed)
}
