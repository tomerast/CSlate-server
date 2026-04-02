import { buildRegistry, runSubAgent, toAISDKTools, stripFences } from '@cslate/shared/agent'
import type { RedTeamResult, StaticAnalysisResult, ExpertAgentResult, ReviewerConfig } from '../types'
import { buildRedTeamTools } from './tools'
import { RED_TEAM_SYSTEM_PROMPT } from './prompts'

export async function runRedTeam(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  config: ReviewerConfig,
): Promise<RedTeamResult> {
  const registry = buildRegistry({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const tools = buildRedTeamTools(files, manifest, staticResult, expertResults)

  const result = await runSubAgent({
    modelId: config.modelOverrides.redTeam ?? 'anthropic:claude-sonnet-4-6',
    registry,
    system: RED_TEAM_SYSTEM_PROMPT,
    prompt: `Red-team this component. Files: ${Object.keys(files).join(', ')}. Start by reading context.md and manifest, then probe all 8 attack vectors methodically using your tools.`,
    tools: toAISDKTools(tools),
    maxSteps: config.maxRedTeamIterations ?? 10,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text))
  return {
    ...parsed,
    iterationsUsed: result.steps,
    tokenCost: { input: result.usage.inputTokens, output: result.usage.outputTokens },
  } as RedTeamResult
}
