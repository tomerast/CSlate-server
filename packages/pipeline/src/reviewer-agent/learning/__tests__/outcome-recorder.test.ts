import { describe, it, expect, vi } from 'vitest'
import { recordReviewOutcome } from '../outcome-recorder'
import type { ReviewVerdict } from '../../types'
import type { Db } from '@cslate/db'

function makeMockDb() {
  const insertCalls: { values: Record<string, unknown> }[] = []
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertCalls.push({ values: vals })
        return Promise.resolve()
      }),
    })),
    _insertCalls: insertCalls,
  }
  return db as unknown as Db & { _insertCalls: typeof insertCalls }
}

function makeVerdict(decision: 'approved' | 'rejected' = 'approved'): ReviewVerdict {
  return {
    decision,
    decisionConfidence: 90,
    decisionConfidenceInterval: { lower: 65, upper: 100, width: 35 },
    decisionReason: 'All checks passed',
    scorecard: [],
    findings: [],
    threatAssessment: {} as ReviewVerdict['threatAssessment'],
    stats: {} as ReviewVerdict['stats'],
    cost: {} as ReviewVerdict['cost'],
    learningSignals: [],
  }
}

describe('recordReviewOutcome', () => {
  it('inserts one row into reviewOutcomes', async () => {
    const db = makeMockDb()
    await recordReviewOutcome(db, makeVerdict(), 'upload-abc')
    expect(db._insertCalls).toHaveLength(1)
  })

  it('stores the uploadId', async () => {
    const db = makeMockDb()
    await recordReviewOutcome(db, makeVerdict(), 'upload-abc')
    expect(db._insertCalls[0]!.values.uploadId).toBe('upload-abc')
  })

  it('stores verdict decision', async () => {
    const db = makeMockDb()
    await recordReviewOutcome(db, makeVerdict('rejected'), 'upload-1')
    expect(db._insertCalls[0]!.values.verdict).toBe('rejected')
  })

  it('stores dimensionScores from scorecard', async () => {
    const db = makeMockDb()
    const verdict = makeVerdict()
    await recordReviewOutcome(db, verdict, 'upload-1')
    expect(db._insertCalls[0]!.values.dimensionScores).toBe(verdict.scorecard)
  })

  it('stores findings', async () => {
    const db = makeMockDb()
    const verdict = makeVerdict()
    await recordReviewOutcome(db, verdict, 'upload-1')
    expect(db._insertCalls[0]!.values.findings).toBe(verdict.findings)
  })

  it('generates a unique id', async () => {
    const db = makeMockDb()
    await recordReviewOutcome(db, makeVerdict(), 'upload-1')
    await recordReviewOutcome(db, makeVerdict(), 'upload-2')
    const id1 = db._insertCalls[0]!.values.id
    const id2 = db._insertCalls[1]!.values.id
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })
})
