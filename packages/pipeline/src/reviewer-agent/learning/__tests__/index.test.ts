import { describe, it, expect, vi } from 'vitest'
import { loadKnowledgeBase } from '../index'
import type { Db } from '@cslate/db'

function makeEmptyDb(): Db {
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

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => makeChain([])),
    })),
  } as unknown as Db
}

describe('loadKnowledgeBase', () => {
  it('returns version 0 when DB is empty', async () => {
    const db = makeEmptyDb()
    const kb = await loadKnowledgeBase(db)
    expect(kb.version).toBe(0)
  })

  it('returns empty codeStandards when DB is empty', async () => {
    const db = makeEmptyDb()
    const kb = await loadKnowledgeBase(db)
    expect(kb.codeStandards).toEqual([])
  })

  it('returns empty patternLibrary when DB is empty', async () => {
    const db = makeEmptyDb()
    const kb = await loadKnowledgeBase(db)
    expect(kb.patternLibrary).toEqual([])
  })

  it('returns empty dimensionWeights when DB is empty', async () => {
    const db = makeEmptyDb()
    const kb = await loadKnowledgeBase(db)
    expect(kb.dimensionWeights).toEqual([])
  })

  it('returns an updatedAt date', async () => {
    const db = makeEmptyDb()
    const kb = await loadKnowledgeBase(db)
    expect(kb.updatedAt).toBeInstanceOf(Date)
  })
})
