import { buildRegistry } from '@cslate/shared/agent'
import { runSecurityExpert } from './security-expert'
import { runQualityExpert } from './quality-expert'
import { runStandardsExpert } from './standards-expert'
import type { ExpertAgentResult, StaticAnalysisResult, ReviewerKnowledgeBase, ReviewerConfig } from '../types'

export async function runExpertAgents(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
): Promise<ExpertAgentResult[]> {
  const registry = buildRegistry({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const [securityResult, qualityResult, standardsResult] = await Promise.all([
    runSecurityExpert(files, manifest, staticResult, knowledgeBase, config, registry),
    runQualityExpert(files, manifest, staticResult, knowledgeBase, config, registry),
    runStandardsExpert(files, manifest, staticResult, knowledgeBase, config, registry),
  ])

  return [securityResult, qualityResult, standardsResult]
}
