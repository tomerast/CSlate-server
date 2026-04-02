import { describe, it, expect } from 'vitest'
import { injectKnowledge } from '../knowledge-injector'
import type { ReviewerKnowledgeBase, LearnedStandard, PatternEntry } from '../../types'

function makeKb(overrides?: Partial<ReviewerKnowledgeBase>): ReviewerKnowledgeBase {
  return {
    version: 1,
    updatedAt: new Date(),
    codeStandards: [],
    patternLibrary: [],
    dimensionWeights: [],
    ...overrides,
  }
}

function makeStandard(overrides?: Partial<LearnedStandard>): LearnedStandard {
  return {
    id: 'std-1',
    dimension: 4,
    rule: 'UI must not contain business logic',
    rationale: 'Separation of concerns',
    examples: { good: [], bad: [] },
    source: 'manual',
    confidence: 80,
    createdAt: new Date(),
    lastConfirmedAt: new Date(),
    ...overrides,
  }
}

function makePattern(overrides?: Partial<PatternEntry>): PatternEntry {
  return {
    id: 'pat-1',
    type: 'rejected',
    patternDesc: 'Function calculateTotal in ui.tsx',
    dimension: 4,
    occurrences: 5,
    lastSeen: new Date(),
    examples: [],
    ...overrides,
  }
}

describe('injectKnowledge', () => {
  it('returns basePrompt unchanged when KB is empty', () => {
    const base = 'You are a code reviewer.'
    const kb = makeKb()
    const result = injectKnowledge(base, kb, [1, 2, 3])
    expect(result).toBe(base)
  })

  it('injects matching standards into the prompt', () => {
    const base = 'You are a code reviewer.'
    const kb = makeKb({ codeStandards: [makeStandard({ dimension: 4 })] })
    const result = injectKnowledge(base, kb, [4])
    expect(result).toContain('Learned Standards for This Review')
    expect(result).toContain('UI must not contain business logic')
    expect(result).toContain('80%')
  })

  it('does not inject standards for other dimensions', () => {
    const base = 'You are a code reviewer.'
    const kb = makeKb({ codeStandards: [makeStandard({ dimension: 4 })] })
    const result = injectKnowledge(base, kb, [1, 2])
    expect(result).toBe(base)
  })

  it('excludes standards with confidence <= 30', () => {
    const base = 'You are a code reviewer.'
    const kb = makeKb({
      codeStandards: [makeStandard({ dimension: 4, confidence: 30 })],
    })
    const result = injectKnowledge(base, kb, [4])
    expect(result).toBe(base)
  })

  it('injects known bad patterns for matching dimensions', () => {
    const base = 'You are a code reviewer.'
    const kb = makeKb({ patternLibrary: [makePattern({ dimension: 4, type: 'rejected' })] })
    const result = injectKnowledge(base, kb, [4])
    expect(result).toContain('Known Bad Patterns to Watch For')
    expect(result).toContain('Function calculateTotal in ui.tsx')
  })

  it('does not inject approved patterns', () => {
    const base = 'You are a code reviewer.'
    const kb = makeKb({
      patternLibrary: [makePattern({ dimension: 4, type: 'approved' })],
    })
    const result = injectKnowledge(base, kb, [4])
    expect(result).toBe(base)
  })

  it('sorts standards by confidence descending', () => {
    const base = 'You are a code reviewer.'
    const standards = [
      makeStandard({ id: 'low', rule: 'Low confidence rule', confidence: 40, dimension: 4 }),
      makeStandard({ id: 'high', rule: 'High confidence rule', confidence: 90, dimension: 4 }),
    ]
    const kb = makeKb({ codeStandards: standards })
    const result = injectKnowledge(base, kb, [4])
    const lowIdx = result.indexOf('Low confidence rule')
    const highIdx = result.indexOf('High confidence rule')
    expect(highIdx).toBeLessThan(lowIdx)
  })
})
