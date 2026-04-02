import { getBoss } from './client'

export const PIPELINE_REVIEW_JOB = 'review-pipeline'

export interface PipelineReviewJobData {
  uploadId: string
}

export async function enqueuePipelineReviewJob(data: PipelineReviewJobData): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(PIPELINE_REVIEW_JOB, data)
}
