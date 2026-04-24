import PgBoss from 'pg-boss'
import { getBoss } from './client'

// Job data types
export interface ReviewJobData {
  uploadId: string
}

export interface CleanupJobData {
  olderThanHours?: number
}

export type MaintenanceJobData = Record<string, never>

// Job names
export const JOB_NAMES = {
  REVIEW_COMPONENT: 'review-component',
  REVIEW_PIPELINE: 'review-pipeline',
  CLEANUP_FAILED_UPLOADS: 'cleanup-failed-uploads',
  CREATE_PARTITION: 'create-partition',
  DROP_OLD_PARTITIONS: 'drop-old-partitions',
} as const

export async function enqueueReviewJob(data: ReviewJobData): Promise<string | null> {
  const boss = await getBoss()
  await boss.createQueue(JOB_NAMES.REVIEW_COMPONENT)
  return boss.send(JOB_NAMES.REVIEW_COMPONENT, data)
}

export async function registerMaintenanceSchedules(): Promise<void> {
  const boss = await getBoss()
  // pg-boss v10: queues must exist before scheduling
  const maintenanceQueues = [
    JOB_NAMES.CLEANUP_FAILED_UPLOADS,
    JOB_NAMES.CREATE_PARTITION,
    JOB_NAMES.DROP_OLD_PARTITIONS,
  ]
  for (const name of maintenanceQueues) {
    await boss.createQueue(name)
  }
  await boss.schedule(JOB_NAMES.CLEANUP_FAILED_UPLOADS, '0 3 * * *', {}) // Daily 3 AM
  await boss.schedule(JOB_NAMES.CREATE_PARTITION, '0 0 25 * *', {})      // Monthly
  await boss.schedule(JOB_NAMES.DROP_OLD_PARTITIONS, '0 1 1 * *', {})    // Monthly
}

export async function getQueueDepth(): Promise<number> {
  const boss = await getBoss()
  const counts = await boss.getQueueSize(JOB_NAMES.REVIEW_COMPONENT)
  return counts ?? 0
}
