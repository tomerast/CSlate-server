import { describe, it, expect, vi } from 'vitest'
import { runDistillation } from '../distillation'
import {
  reviewOutcomes,
  reviewerStandards,
  reviewerKnowledgeVersions,
} from '@cslate/db'
import type { Db } from '@cslate/db'
import type { VerifiedFinding } from '../../types'

const sharedFinding: VerifiedFinding = {
  dimension: 4,
  severity: 'warning',
  confidence: 80,
  title: 'Business logic in ui.tsx',
  description: 'Logic found in UI component',
  file: 'ui.tsx',
  evidence: 'function calculateTotal() {}',
  reasoning: 'Logic should be in logic.ts',
  verifiedByTool: false,
  verificationMethod: 'reasoning_confirmed',
  verificationEvidence: 'confirmed by judge',
}

const mockRejectedOutcomes = [
  { id: 'o1', uploadId: 'u1', verdict: 'rejected', dimensionScores: [], findings: [sharedFinding], postReviewSignals: null, createdAt: new Date() },
  { id: 'o2', uploadId: 'u2', verdict: 'rejected', dimensionScores: [], findings: [sharedFinding], postReviewSignals: null, createdAt: new Date() },
  { id: 'o3', uploadId: 'u3', verdict: 'rejected', dimensionScores: [], findings: [sharedFinding], postReviewSignals: null, createdAt: new Date() },
]

function createMockDb(tableResults: Map<object, unknown[]> = new Map()): Db & { _insertCalls: { table: object; values: unknown }[] } {
  const insertCalls: { table: object; values: unknown }[] = []

  function makeChain(result: unknown[]): any {
    const chain: any = {
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
      catch: (onRejected: (e: unknown) => unknown) =>
        Promise.resolve(result).catch(onRejected),
      finally: (onFinally: () => void) =>
        Promise.resolve(result).finally(onFinally),
    }
    return chain
  }

  const db = {
    select: vi.fn((_projection?: unknown) => ({
      from: vi.fn((table: object) => makeChain(tableResults.get(table) ?? [])),
    })),
    insert: vi.fn((table: object) => ({
      values: vi.fn((vals: unknown) => {
        insertCalls.push({ table, values: vals })
        return Promise.resolve()
      }),
    })),
    _insertCalls: insertCalls,
  }

  return db as unknown as Db & { _insertCalls: typeof insertCalls }
}

describe('runDistillation', () => {
  it('does nothing when there are no outcomes', async () => {
    const db = createMockDb()
    await runDistillation(db, 30)
    expect(db._insertCalls).toHaveLength(0)
  })

  it('does not create a standard from fewer than 3 matching findings', async () => {
    const twoOutcomes = mockRejectedOutcomes.slice(0, 2)
    const db = createMockDb(new Map([[reviewOutcomes as object, twoOutcomes]]))
    await runDistillation(db, 30)
    expect(db._insertCalls).toHaveLength(0)
  })

  it('creates a new standard from 3+ identical findings in rejected reviews', async () => {
    const db = createMockDb(
      new Map([
        [reviewOutcomes as object, mockRejectedOutcomes],
        [reviewerStandards as object, []],
      ])
    )
    await runDistillation(db, 30)
    const standardInserts = db._insertCalls.filter(c => c.table === reviewerStandards)
    expect(standardInserts).toHaveLength(1)
    const vals = standardInserts[0]!.values as Record<string, unknown>
    expect(vals.dimension).toBe(4)
    expect(vals.rule).toBe('Business logic in ui.tsx')
    expect(vals.source).toBe('learned')
  })

  it('creates a version record for each new standard', async () => {
    const db = createMockDb(
      new Map([
        [reviewOutcomes as object, mockRejectedOutcomes],
        [reviewerStandards as object, []],
      ])
    )
    await runDistillation(db, 30)
    const versionInserts = db._insertCalls.filter(c => c.table === reviewerKnowledgeVersions)
    expect(versionInserts).toHaveLength(1)
    const vals = versionInserts[0]!.values as Record<string, unknown>
    expect(vals.changeType).toBe('standard_added')
  })

  it('ignores approved outcomes when building candidates', async () => {
    const approvedOutcomes = mockRejectedOutcomes.map(o => ({ ...o, verdict: 'approved' }))
    const db = createMockDb(new Map([[reviewOutcomes as object, approvedOutcomes]]))
    await runDistillation(db, 30)
    expect(db._insertCalls).toHaveLength(0)
  })
})
