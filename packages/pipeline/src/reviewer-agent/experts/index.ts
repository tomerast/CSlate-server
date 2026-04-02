import type {
  ExpertAgentResult,
  StaticAnalysisResult,
  ReviewerKnowledgeBase,
  ReviewerConfig,
} from '../types'
import { buildAgentRegistry } from '../config/registry'
import { runSecurityExpert } from './security-expert'
import { runQualityExpert } from './quality-expert'
import { runStandardsExpert } from './standards-expert'

export async function runExpertAgents(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  knowledgeBase: ReviewerKnowledgeBase,
  config: ReviewerConfig,
): Promise<ExpertAgentResult[]> {
  const registry = buildAgentRegistry()

  return Promise.all([
    runSecurityExpert(files, manifest, staticResult, knowledgeBase, config, registry),
    runQualityExpert(files, manifest, staticResult, knowledgeBase, config, registry),
    runStandardsExpert(files, manifest, staticResult, knowledgeBase, config, registry),
  ])
}
