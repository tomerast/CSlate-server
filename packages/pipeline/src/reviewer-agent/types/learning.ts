// ─── Learning System ─────────────────────────────────────────────────────────

import type { FinalDimensionScore, VerifiedFinding } from './phases'

export interface LearnedStandard {
  id: string
  dimension: number
  rule: string
  rationale: string
  examples: {
    good: CodeExample[]
    bad: CodeExample[]
  }
  source: 'manual' | 'learned'
  confidence: number
  createdAt: Date
  lastConfirmedAt: Date
}

export interface CodeExample {
  componentName: string
  file: string
  snippet: string
  reviewId: string
}

export interface PatternEntry {
  id: string
  type: 'approved' | 'rejected' | 'suspicious'
  patternDesc: string
  regex?: string
  dimension: number
  occurrences: number
  lastSeen: Date
  examples: CodeExample[]
}

export interface ReviewOutcome {
  id: string
  uploadId: string
  verdict: 'approved' | 'rejected'
  dimensionScores: FinalDimensionScore[]
  findings: VerifiedFinding[]
  postReviewSignals?: {
    adminOverride?: 'approved' | 'rejected'
    userFlagged?: boolean
    componentRevoked?: boolean
    usageCount?: number
  }
  createdAt: Date
}

export interface ReviewCorrection {
  reviewId: string
  findingId: string
  correctionType: 'false_positive' | 'false_negative' | 'severity_wrong'
  original: { severity: string; dimension: number }
  corrected: { severity: string; dimension: number }
  reason: string
  correctedBy: 'admin' | 'outcome'
  createdAt: Date
}

export interface DimensionWeight {
  dimension: number
  weight: number
  strictnessLevel: 'lenient' | 'standard' | 'strict' | 'paranoid'
  adjustedAt: Date
  reason: string
}

export interface ReviewerKnowledgeBase {
  version: number
  updatedAt: Date
  codeStandards: LearnedStandard[]
  patternLibrary: PatternEntry[]
  dimensionWeights: DimensionWeight[]
}
