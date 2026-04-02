import { buildRegistry } from '@cslate/shared/agent'
import type { AgentRegistry } from '@cslate/shared/agent'

/**
 * Build an AgentRegistry from environment variables.
 * Defaults to Anthropic if ANTHROPIC_API_KEY is set.
 */
export function buildAgentRegistry(): AgentRegistry {
  return buildRegistry({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })
}
