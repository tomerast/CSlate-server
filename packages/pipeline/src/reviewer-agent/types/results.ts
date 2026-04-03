// ─── Phase 5: Verdict ────────────────────────────────────────────────────────

import type { ConfidenceInterval, DimensionScore, RedTeamResult, VerifiedFinding } from './phases'

export interface ReviewStats {
  totalDuration: number
  phaseDurations: {
    staticAnalysis: number
    expertAgents: number
    redTeam: number
    judge: number
    verdict: number
  }
  totalFindings: number
  verifiedFindings: number
  rejectedFindings: number
  hallucinationRate: number
  iterationsUsed: {
    securityExpert: number
    qualityExpert: number
    standardsExpert: number
    redTeam: number
    judge: number
  }
}

export interface ReviewCost {
  totalTokens: { input: number; output: number }
  perPhase: {
    phase: string
    model: string
    tokens: { input: number; output: number }
    estimatedCost: number
  }[]
  totalEstimatedCost: number
}

export interface LearningSignal {
  type: 'new_pattern' | 'standard_confirmed' | 'standard_violated' | 'novel_attack_vector'
  dimension: number
  description: string
  evidence: string
  confidence: number
}

export interface ReviewVerdict {
  decision: 'approved' | 'rejected'
  decisionConfidence: number
  decisionConfidenceInterval: ConfidenceInterval
  decisionReason: string
  scorecard: DimensionScore[]
  findings: VerifiedFinding[]
  threatAssessment: RedTeamResult
  stats: ReviewStats
  cost: ReviewCost
  learningSignals: LearningSignal[]
}
