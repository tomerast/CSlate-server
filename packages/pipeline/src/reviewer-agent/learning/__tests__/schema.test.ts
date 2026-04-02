import { describe, it, expect } from 'vitest'
import {
  reviewerStandards,
  reviewerPatterns,
  reviewOutcomes,
  reviewCorrections,
  reviewerDimensionWeights,
  reviewerKnowledgeVersions,
  type NewReviewerStandard,
  type NewReviewerPattern,
  type NewReviewOutcome,
  type NewReviewCorrection,
  type NewReviewerDimensionWeight,
  type NewReviewerKnowledgeVersion,
} from '@cslate/db'

describe('reviewer DB schemas', () => {
  it('all table objects are defined', () => {
    expect(reviewerStandards).toBeDefined()
    expect(reviewerPatterns).toBeDefined()
    expect(reviewOutcomes).toBeDefined()
    expect(reviewCorrections).toBeDefined()
    expect(reviewerDimensionWeights).toBeDefined()
    expect(reviewerKnowledgeVersions).toBeDefined()
  })

  it('NewReviewerStandard accepts all required fields', () => {
    const row: NewReviewerStandard = {
      id: 'std-1',
      dimension: 1,
      rule: 'No hardcoded secrets',
      rationale: 'Secrets must use bridge.getConfig()',
      source: 'manual',
    }
    expect(row.id).toBe('std-1')
  })

  it('NewReviewerPattern accepts all required fields', () => {
    const row: NewReviewerPattern = {
      id: 'pat-1',
      type: 'rejected',
      patternDesc: 'Hardcoded API key pattern',
      dimension: 3,
    }
    expect(row.id).toBe('pat-1')
  })

  it('NewReviewOutcome accepts all required fields', () => {
    const row: NewReviewOutcome = {
      id: 'out-1',
      uploadId: 'upload-1',
      verdict: 'rejected',
      dimensionScores: [],
      findings: [],
    }
    expect(row.id).toBe('out-1')
  })

  it('NewReviewCorrection accepts all required fields', () => {
    const row: NewReviewCorrection = {
      id: 'cor-1',
      reviewId: 'rev-1',
      findingId: 'find-1',
      correctionType: 'false_positive',
      originalSeverity: 'warning',
      originalDimension: 4,
      correctedSeverity: 'info',
      correctedDimension: 4,
      reason: 'Not actually a problem',
      correctedBy: 'admin',
    }
    expect(row.id).toBe('cor-1')
  })

  it('NewReviewerDimensionWeight accepts all required fields', () => {
    const row: NewReviewerDimensionWeight = {
      id: 'wt-1',
      dimension: 1,
      weight: 1.5,
      reason: 'Increased security strictness',
    }
    expect(row.id).toBe('wt-1')
  })

  it('NewReviewerKnowledgeVersion accepts all required fields', () => {
    const row: NewReviewerKnowledgeVersion = {
      id: 'ver-1',
      version: 1,
      changeType: 'standard_added',
      changeDescription: 'Added new standard',
    }
    expect(row.id).toBe('ver-1')
  })
})
