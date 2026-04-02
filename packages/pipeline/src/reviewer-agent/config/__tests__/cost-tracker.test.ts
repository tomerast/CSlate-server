import { describe, it, expect, vi } from 'vitest'
import { estimateCost, trackReviewCost, getTodayLLMCost, countReviewsInLastHour } from '../cost-tracker'

vi.mock('@cslate/db', () => ({
  reviewCosts: { estimatedCost: 'estimatedCost', createdAt: 'createdAt' },
}))

vi.mock('drizzle-orm', () => ({
  sum: vi.fn((col) => ({ _sum: col })),
  gte: vi.fn((col, val) => ({ _gte: col, val })),
  count: vi.fn(() => ({ _count: true })),
}))

describe('estimateCost', () => {
  it('calculates cost correctly for claude-sonnet-4-6', () => {
    const cost = estimateCost('claude-sonnet-4-6', { input: 1000, output: 1000 })
    // (1000/1000) * 0.003 + (1000/1000) * 0.015 = 0.018
    expect(cost).toBeCloseTo(0.018)
  })

  it('calculates cost for claude-haiku', () => {
    const cost = estimateCost('claude-haiku-4-5-20251001', { input: 2000, output: 500 })
    // (2000/1000) * 0.0008 + (500/1000) * 0.004 = 0.0016 + 0.002 = 0.0036
    expect(cost).toBeCloseTo(0.0036)
  })

  it('calculates cost for claude-opus-4-6', () => {
    const cost = estimateCost('claude-opus-4-6', { input: 1000, output: 1000 })
    // (1000/1000) * 0.015 + (1000/1000) * 0.075 = 0.09
    expect(cost).toBeCloseTo(0.09)
  })

  it('falls back to claude-sonnet-4-6 rates for unknown model', () => {
    const knownCost = estimateCost('claude-sonnet-4-6', { input: 1000, output: 1000 })
    const unknownCost = estimateCost('some-unknown-model', { input: 1000, output: 1000 })
    expect(unknownCost).toBeCloseTo(knownCost)
  })

  it('returns 0 for zero tokens', () => {
    const cost = estimateCost('claude-sonnet-4-6', { input: 0, output: 0 })
    expect(cost).toBe(0)
  })
})

describe('getTodayLLMCost', () => {
  it('returns sum of costs from today UTC only', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ total: '12.50' }]),
    }
    const cost = await getTodayLLMCost(mockDb as any)
    expect(cost).toBe(12.5)
  })

  it('returns 0 when no costs today', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ total: null }]),
    }
    const cost = await getTodayLLMCost(mockDb as any)
    expect(cost).toBe(0)
  })

  it('returns 0 when result array is empty', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    const cost = await getTodayLLMCost(mockDb as any)
    expect(cost).toBe(0)
  })
})

describe('countReviewsInLastHour', () => {
  it('returns count of reviews in the last hour', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: '5' }]),
    }
    const count = await countReviewsInLastHour(mockDb as any)
    expect(count).toBe(5)
  })

  it('returns 0 when no reviews in last hour', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: '0' }]),
    }
    const count = await countReviewsInLastHour(mockDb as any)
    expect(count).toBe(0)
  })
})

describe('trackReviewCost', () => {
  it('inserts a cost record into the database', async () => {
    const insertMock = {
      values: vi.fn().mockResolvedValue(undefined),
    }
    const mockDb = {
      insert: vi.fn().mockReturnValue(insertMock),
    }

    await trackReviewCost(mockDb as any, 'upload-123', 'security', 'claude-sonnet-4-6', { input: 1000, output: 500 })

    expect(mockDb.insert).toHaveBeenCalled()
    expect(insertMock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId: 'upload-123',
        phase: 'security',
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 500,
      }),
    )
  })

  it('stores the estimated cost in the record', async () => {
    const insertMock = {
      values: vi.fn().mockResolvedValue(undefined),
    }
    const mockDb = {
      insert: vi.fn().mockReturnValue(insertMock),
    }

    await trackReviewCost(mockDb as any, 'upload-456', 'quality', 'claude-sonnet-4-6', { input: 1000, output: 1000 })

    const insertedRow = insertMock.values.mock.calls[0][0]
    expect(insertedRow.estimatedCost).toBeCloseTo(0.018)
  })
})
