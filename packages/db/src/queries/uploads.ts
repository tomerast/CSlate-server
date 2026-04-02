import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { uploads, type Upload, type NewUpload } from '../schema'

export async function createUpload(data: NewUpload): Promise<Upload> {
  const db = getDb()
  const [upload] = await db.insert(uploads).values(data).returning()
  if (!upload) throw new Error('Failed to create upload')
  return upload
}

export async function getUploadById(id: string): Promise<Upload | undefined> {
  const db = getDb()
  return db.query.uploads.findFirst({ where: eq(uploads.id, id) })
}

export async function updateUpload(id: string, data: Partial<Upload>): Promise<Upload> {
  const db = getDb()
  const [upload] = await db.update(uploads).set({ ...data, updatedAt: new Date() }).where(eq(uploads.id, id)).returning()
  if (!upload) throw new Error('Upload not found')
  return upload
}
