import { buildRegistry } from '@cslate/shared/agent'
import type { AgentRegistry } from '@cslate/shared/agent'

const DEFAULT_MODEL = 'moonshotai/kimi-k2.6'

/**
 * Build an AgentRegistry.
 *
 * When AI_GATEWAY_URL is set, routes all LLM calls through the Vercel AI Gateway
 * using the OpenAI-compatible endpoint with moonshotai/kimi-k2.6 as the default model.
 * Falls back to direct Anthropic when the gateway is not configured.
 */
export function buildAgentRegistry(): AgentRegistry {
  const gatewayUrl = process.env.AI_GATEWAY_URL?.replace(/\/$/, '')
  if (gatewayUrl && process.env.AI_GATEWAY_KEY) {
    return buildRegistry({
      provider: 'openai',
      apiKey: process.env.AI_GATEWAY_KEY,
      model: DEFAULT_MODEL,
      baseUrl: gatewayUrl,
    })
  }

  return buildRegistry({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })
}
