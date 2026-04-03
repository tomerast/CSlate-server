// ─── Cost Control Config ─────────────────────────────────────────────────────

import type { ReviewerKnowledgeBase } from './learning'

export interface ReviewerConfig {
  maxConcurrentReviews: number
  maxReviewsPerHour: number
  reviewThrottleSeconds: number
  pauseReviews: boolean
  maxLLMCostPerDay: number
  maxExpertAgentIterations: number
  maxRedTeamIterations: number
  maxJudgeIterations: number
  qualityThreshold: number         // default: 70
  maxWarnings: number              // default: 5
  tierWeights: {
    security: number               // default: 3 — security findings weighted 3x
    quality: number                // default: 2 — quality findings weighted 2x
    standards: number              // default: 1 — standards findings weighted 1x
  }
  modelOverrides: {
    securityExpert?: string
    qualityExpert?: string
    standardsExpert?: string
    redTeam?: string
    judge?: string
  }
}

export const DEFAULT_REVIEWER_CONFIG: ReviewerConfig = {
  maxConcurrentReviews: 5,
  maxReviewsPerHour: 30,
  reviewThrottleSeconds: 10,
  pauseReviews: false,
  maxLLMCostPerDay: 50,
  maxExpertAgentIterations: 12,
  maxRedTeamIterations: 10,
  maxJudgeIterations: 12,
  qualityThreshold: 70,
  maxWarnings: 5,
  tierWeights: { security: 3, quality: 2, standards: 1 },
  modelOverrides: {},
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface AgentReviewProgress {
  phase: 'static_analysis' | 'expert_agents' | 'red_team' | 'judge' | 'verdict'
  status: 'in_progress' | 'complete' | 'failed' | 'skipped'
  detail?: string
}

export type AgentReviewProgressCallback = (progress: AgentReviewProgress) => Promise<void>

/**
 * The main entry point type for the reviewer agent.
 * Called by the pipeline runner as a StageFunction.
 */
export interface ReviewerAgentInput {
  uploadId: string
  manifest: Record<string, unknown>  // ComponentManifest or PipelineManifest
  files: Record<string, string>
  previousResults: Array<{ stage: string; status: string; data?: Record<string, unknown> }>
  onProgress?: AgentReviewProgressCallback
  config?: Partial<ReviewerConfig>
  knowledgeBase?: ReviewerKnowledgeBase
}
