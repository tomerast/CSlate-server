import type {
  RedTeamResult,
  StaticAnalysisResult,
  ExpertAgentResult,
  ReviewerConfig,
} from '../types'
import { buildAgentRegistry } from '../config/registry'
import { buildRedTeamTools } from './tools'
import { RED_TEAM_SYSTEM_PROMPT } from './prompts'
import { runReviewAgent } from '../create-review-agent'

export async function runRedTeam(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
  config: ReviewerConfig,
): Promise<RedTeamResult> {
  const registry = buildAgentRegistry()
  const allFindings = expertResults.flatMap(r => r.findings)
  const summary = `Expert agents found ${allFindings.length} total findings (${allFindings.filter(f => f.severity === 'critical').length} critical).`

  return runReviewAgent<RedTeamResult>({
    agentName: 'red-team',
    systemPrompt: RED_TEAM_SYSTEM_PROMPT,
    tools: buildRedTeamTools(files, manifest, staticResult, expertResults),
    modelId: config.modelOverrides?.redTeam ?? 'anthropic:claude-sonnet-4-6',
    maxSteps: config.maxRedTeamIterations ?? 10,
    buildPrompt: () => `Perform adversarial red-team analysis of this component.\n\n${summary}\n\nStart with listFiles(), then readFile each source file, then probe with searchCode and getBridgeAPISpec.`,
    parseResult: result => result,
  }, registry)
}
