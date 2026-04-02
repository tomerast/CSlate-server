import { describe, it, expect, vi } from 'vitest'
import { getReviewerConfig, updateReviewerConfig } from '../index'
import { DEFAULT_REVIEWER_CONFIG } from '../../types'

vi.mock('@cslate/db', () => ({
  reviewerConfig: { id: 'id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ _eq: col, val })),
}))

describe('getReviewerConfig', () => {
  it('returns DEFAULT_REVIEWER_CONFIG when DB is empty', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    const config = await getReviewerConfig(mockDb as any)
    expect(config).toEqual(DEFAULT_REVIEWER_CONFIG)
  })

  it('returns config from DB row when row exists', async () => {
    const mockRow = {
      maxConcurrentReviews: 10,
      maxReviewsPerHour: 60,
      reviewThrottleSeconds: 5,
      pauseReviews: true,
      maxLlmCostPerDay: 100,
      maxExpertAgentIterations: 8,
      maxRedTeamIterations: 6,
      maxJudgeIterations: 8,
      qualityThreshold: 80,
      maxWarnings: 3,
      modelOverrides: { securityExpert: 'claude-opus-4-6' },
    }
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([mockRow]),
    }
    const config = await getReviewerConfig(mockDb as any)
    expect(config.maxConcurrentReviews).toBe(10)
    expect(config.maxReviewsPerHour).toBe(60)
    expect(config.pauseReviews).toBe(true)
    expect(config.maxLLMCostPerDay).toBe(100)
    expect(config.modelOverrides).toEqual({ securityExpert: 'claude-opus-4-6' })
  })

  it('uses DEFAULT_REVIEWER_CONFIG values for null fields in DB row', async () => {
    const mockRow = {
      maxConcurrentReviews: null,
      maxReviewsPerHour: null,
      reviewThrottleSeconds: null,
      pauseReviews: null,
      maxLlmCostPerDay: null,
      maxExpertAgentIterations: null,
      maxRedTeamIterations: null,
      maxJudgeIterations: null,
      qualityThreshold: null,
      maxWarnings: null,
      modelOverrides: null,
    }
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([mockRow]),
    }
    const config = await getReviewerConfig(mockDb as any)
    expect(config).toEqual(DEFAULT_REVIEWER_CONFIG)
  })
})

describe('updateReviewerConfig', () => {
  it('upserts and returns updated config', async () => {
    const insertMock = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue([]),
    }
    const mockDb = {
      insert: vi.fn().mockReturnValue(insertMock),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxConcurrentReviews: 10,
        maxReviewsPerHour: 30,
        reviewThrottleSeconds: 10,
        pauseReviews: false,
        maxLlmCostPerDay: 50,
        maxExpertAgentIterations: 12,
        maxRedTeamIterations: 10,
        maxJudgeIterations: 12,
        qualityThreshold: 70,
        maxWarnings: 5,
        modelOverrides: {},
      }]),
    }
    const result = await updateReviewerConfig(mockDb as any, { maxConcurrentReviews: 10 })
    expect(mockDb.insert).toHaveBeenCalled()
    expect(insertMock.values).toHaveBeenCalled()
    expect(insertMock.onConflictDoUpdate).toHaveBeenCalled()
    expect(result.maxConcurrentReviews).toBe(10)
  })

  it('includes updatedAt in the upsert values', async () => {
    const insertMock = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue([]),
    }
    const mockDb = {
      insert: vi.fn().mockReturnValue(insertMock),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxConcurrentReviews: 5,
        maxReviewsPerHour: 30,
        reviewThrottleSeconds: 10,
        pauseReviews: false,
        maxLlmCostPerDay: 50,
        maxExpertAgentIterations: 12,
        maxRedTeamIterations: 10,
        maxJudgeIterations: 12,
        qualityThreshold: 70,
        maxWarnings: 5,
        modelOverrides: {},
      }]),
    }
    await updateReviewerConfig(mockDb as any, { pauseReviews: true })
    const valuesArg = insertMock.values.mock.calls[0][0]
    expect(valuesArg).toHaveProperty('updatedAt')
    expect(valuesArg.updatedAt).toBeInstanceOf(Date)
  })

  it('sets id to "default" in the upsert', async () => {
    const insertMock = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue([]),
    }
    const mockDb = {
      insert: vi.fn().mockReturnValue(insertMock),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxConcurrentReviews: 5,
        maxReviewsPerHour: 30,
        reviewThrottleSeconds: 10,
        pauseReviews: false,
        maxLlmCostPerDay: 50,
        maxExpertAgentIterations: 12,
        maxRedTeamIterations: 10,
        maxJudgeIterations: 12,
        qualityThreshold: 70,
        maxWarnings: 5,
        modelOverrides: {},
      }]),
    }
    await updateReviewerConfig(mockDb as any, { maxReviewsPerHour: 60 })
    const valuesArg = insertMock.values.mock.calls[0][0]
    expect(valuesArg.id).toBe('default')
  })
})
