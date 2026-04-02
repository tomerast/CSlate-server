import type { Db } from '@cslate/db'
import type { ReviewVerdict, ReviewerKnowledgeBase } from '../types'
import { recordReviewOutcome as persistOutcome } from './outcome-recorder'

export async function loadKnowledgeBase(db: Db): Promise<ReviewerKnowledgeBase> {
  // TODO: Load learned standards, pattern library, and dimension weights from DB

  return {
    version: 0,
    updatedAt: new Date(),
    codeStandards: [],
    patternLibrary: [],
    dimensionWeights: [],
  }
}

export async function recordReviewOutcome(
  db: Db,
  verdict: ReviewVerdict,
  uploadId: string,
): Promise<void> {
  await persistOutcome(db, verdict, uploadId)
}
