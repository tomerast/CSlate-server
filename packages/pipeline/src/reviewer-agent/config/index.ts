import type { Db } from '@cslate/db'
import { type ReviewerConfig, DEFAULT_REVIEWER_CONFIG } from '../types'

export async function getReviewerConfig(db: Db): Promise<ReviewerConfig> {
  // TODO: Load reviewer config from DB (admin-configurable settings)
  // Falls back to DEFAULT_REVIEWER_CONFIG if not set

  return { ...DEFAULT_REVIEWER_CONFIG }
}
