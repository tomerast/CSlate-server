import { toAISDKTools, runSubAgent, stripFences } from '@cslate/shared/agent'
import type {
  RedTeamResult,
  StaticAnalysisResult,
  ExpertAgentResult,
  ReviewerConfig,
} from '../types'
import { buildAgentRegistry } from '../config/registry'
import { buildRedTeamTools } from './tools'
import { RED_TEAM_SYSTEM_PROMPT } from './prompts'

export async function runRedTeam(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  config: ReviewerConfig,
): Promise<RedTeamResult> {
  const registry = buildAgentRegistry()
  const tools = buildRedTeamTools(files, manifest, staticResult, expertResults)
  const modelId = config.modelOverrides?.redTeam ?? 'anthropic:claude-sonnet-4-6'

  const allFindings = expertResults.flatMap(r => r.findings)
  const summary = `Expert agents found ${allFindings.length} total findings (${allFindings.filter(f => f.severity === 'critical').length} critical).`

  const result = await runSubAgent({
    modelId,
    registry,
    system: RED_TEAM_SYSTEM_PROMPT,
    prompt: `Perform adversarial red-team analysis of this component.\n\n${summary}\n\nStart with listFiles(), then readFile each source file, then probe with searchCode and getBridgeAPISpec.`,
    tools: toAISDKTools(tools),
    maxSteps: config.maxRedTeamIterations ?? 10,
    maxOutputTokens: 16_000,
  })

  const parsed = JSON.parse(stripFences(result.text)) as RedTeamResult
  parsed.iterationsUsed = result.steps
  parsed.tokenCost = { input: result.usage.inputTokens, output: result.usage.outputTokens }
  return parsed
}
