import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// Hoist mock objects so they are available when vi.mock factory runs.
// vi.hoisted also gives us __dirname at this early stage for path computation.
const { mockSend, mockSendThrottled, mockBoss, queueClientPath } = vi.hoisted(() => {
  const { resolve } = require('node:path')
  const mockSend = vi.fn()
  const mockSendThrottled = vi.fn()
  const mockBoss = { send: mockSend, sendThrottled: mockSendThrottled }
  // Navigate from the test directory to the workspace root and into queue/src/client.ts.
  // __dirname here is the test file directory (vi.hoisted has access to it).
  // Path: packages/pipeline/src/reviewer-agent/config/__tests__ → 6 levels → workspace root
  const queueClientPath = resolve(__dirname, '../../../../../..', 'packages/queue/src/client.ts')
  return { mockSend, mockSendThrottled, mockBoss, queueClientPath }
})

// Mock the pg-boss client using the computed absolute path.
//
// IMPORTANT: vi.mock() with a variable argument is NOT statically hoisted by Vitest,
// so it runs at module evaluation time — AFTER static imports are resolved. To ensure
// the mock is registered before enqueueReviewWithLimits is imported, we use a dynamic
// import (await import) in beforeAll rather than a static top-level import.
//
// This keeps the mock path portable (no hard-coded machine paths) while still
// intercepting the './client' relative import inside reviewer-enqueue.ts.
vi.mock(queueClientPath, () => ({
  getBoss: vi.fn().mockResolvedValue(mockBoss),
}))

// Import the REAL implementation dynamically so the mock above is registered first.
// rate-limiter.ts re-exports enqueueReviewWithLimits from @cslate/queue → reviewer-enqueue.ts,
// which calls getBoss() — intercepted by the mock above.
let enqueueReviewWithLimits: (
  data: { uploadId: string },
  config: {
    pauseReviews: boolean
    maxReviewsPerHour: number
    maxLLMCostPerDay: number
    reviewThrottleSeconds: number
  },
  recentCount: number,
  todayCost: number,
) => Promise<string | null>

beforeAll(async () => {
  const mod = await import('../rate-limiter')
  enqueueReviewWithLimits = mod.enqueueReviewWithLimits
})

const baseConfig = {
  pauseReviews: false,
  maxReviewsPerHour: 30,
  maxLLMCostPerDay: 50,
  reviewThrottleSeconds: 10,
}

beforeEach(() => {
  mockSend.mockReset()
  mockSendThrottled.mockReset()
  mockSend.mockResolvedValue('job-id-123')
  mockSendThrottled.mockResolvedValue('job-id-456')
})

describe('enqueueReviewWithLimits', () => {
  describe('kill switch', () => {
    it('throws when pauseReviews is true', async () => {
      const config = { ...baseConfig, pauseReviews: true }
      await expect(
        enqueueReviewWithLimits({ uploadId: 'upload-1' }, config, 0, 0),
      ).rejects.toThrow('Reviews are paused by admin')
    })

    it('does not call boss when paused', async () => {
      const config = { ...baseConfig, pauseReviews: true }
      try {
        await enqueueReviewWithLimits({ uploadId: 'upload-1' }, config, 0, 0)
      } catch {
        // expected
      }
      expect(mockSend).not.toHaveBeenCalled()
      expect(mockSendThrottled).not.toHaveBeenCalled()
    })
  })

  describe('hourly rate limit', () => {
    it('uses boss.send with startAfter when at hourly limit', async () => {
      // recentCount equals maxReviewsPerHour
      await enqueueReviewWithLimits({ uploadId: 'upload-2' }, baseConfig, 30, 0)
      expect(mockSend).toHaveBeenCalledWith(
        'review-component',
        { uploadId: 'upload-2' },
        expect.objectContaining({ startAfter: expect.any(Number) }),
      )
      expect(mockSendThrottled).not.toHaveBeenCalled()
    })

    it('uses boss.send with startAfter when exceeding hourly limit', async () => {
      await enqueueReviewWithLimits({ uploadId: 'upload-3' }, baseConfig, 50, 0)
      expect(mockSend).toHaveBeenCalled()
      expect(mockSendThrottled).not.toHaveBeenCalled()
    })

    it('calculates correct delay based on maxReviewsPerHour', async () => {
      const config = { ...baseConfig, maxReviewsPerHour: 60 }
      await enqueueReviewWithLimits({ uploadId: 'upload-4' }, config, 60, 0)
      const callArgs = mockSend.mock.calls[0]
      // 3600 / 60 = 60 seconds
      expect(callArgs[2].startAfter).toBe(60)
    })
  })

  describe('daily cost cap', () => {
    it('uses boss.send with startAfter when at daily cost limit', async () => {
      await enqueueReviewWithLimits({ uploadId: 'upload-5' }, baseConfig, 0, 50)
      expect(mockSend).toHaveBeenCalledWith(
        'review-component',
        { uploadId: 'upload-5' },
        expect.objectContaining({ startAfter: expect.any(Number) }),
      )
      expect(mockSendThrottled).not.toHaveBeenCalled()
    })

    it('uses boss.send with startAfter when exceeding daily cost limit', async () => {
      await enqueueReviewWithLimits({ uploadId: 'upload-6' }, baseConfig, 0, 100)
      expect(mockSend).toHaveBeenCalled()
      expect(mockSendThrottled).not.toHaveBeenCalled()
    })

    it('defers to a future time (positive delay) when daily cost cap hit', async () => {
      await enqueueReviewWithLimits({ uploadId: 'upload-7' }, baseConfig, 0, 60)
      const callArgs = mockSend.mock.calls[0]
      expect(callArgs[2].startAfter).toBeGreaterThan(0)
    })
  })

  describe('throttled enqueue (normal path)', () => {
    it('uses boss.sendThrottled when under all limits', async () => {
      await enqueueReviewWithLimits({ uploadId: 'upload-8' }, baseConfig, 5, 10)
      expect(mockSendThrottled).toHaveBeenCalledWith(
        'review-component',
        { uploadId: 'upload-8' },
        {},
        baseConfig.reviewThrottleSeconds,
      )
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('passes reviewThrottleSeconds to sendThrottled', async () => {
      const config = { ...baseConfig, reviewThrottleSeconds: 30 }
      await enqueueReviewWithLimits({ uploadId: 'upload-9' }, config, 0, 0)
      const callArgs = mockSendThrottled.mock.calls[0]
      expect(callArgs[3]).toBe(30)
    })

    it('returns job id from sendThrottled', async () => {
      const jobId = await enqueueReviewWithLimits({ uploadId: 'upload-10' }, baseConfig, 0, 0)
      expect(jobId).toBe('job-id-456')
    })
  })
})
