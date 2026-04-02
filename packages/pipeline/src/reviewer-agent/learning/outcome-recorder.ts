import type { Db } from '@cslate/db'
import { reviewOutcomes } from '@cslate/db'
import type { ReviewVerdict } from '../types'

export async function recordReviewOutcome(db: Db, verdict: ReviewVerdict, uploadId: string): Promise<void> {
  const id = crypto.randomUUID()
  await db.insert(reviewOutcomes).values({
    id,
    uploadId,
    verdict: verdict.decision,
    dimensionScores: verdict.scorecard,
    findings: verdict.findings,
    createdAt: new Date(),
  })
}
