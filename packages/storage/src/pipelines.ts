import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getS3Client, BUCKET } from './client'

export function pipelineStorageKey(pipelineId: string, version: string, filename: string): string {
  return `packages/pipelines/${pipelineId}/${version}/${filename}`
}

export function pipelineUploadStorageKey(uploadId: string, filename: string): string {
  return `packages/pipeline-uploads/${uploadId}/${filename}`
}

export async function storePipelineFiles(
  pipelineId: string,
  version: string,
  files: Record<string, string>
): Promise<string> {
  const client = getS3Client()
  const baseKey = `packages/pipelines/${pipelineId}/${version}`
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      client.send(new PutObjectCommand({
        Bucket: BUCKET(),
        Key: `${baseKey}/${filename}`,
        Body: content,
        ContentType: filename.endsWith('.json') ? 'application/json' : 'text/plain',
      }))
    )
  )
  return baseKey
}

export async function getPipelineFiles(storageKey: string): Promise<Record<string, string>> {
  const client = getS3Client()
  const list = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET(),
    Prefix: storageKey + '/',
  }))

  const files: Record<string, string> = {}
  await Promise.all(
    (list.Contents ?? []).map(async (obj) => {
      if (!obj.Key) return
      const filename = obj.Key.replace(storageKey + '/', '')
      const res = await client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: obj.Key }))
      if (!res.Body) return
      files[filename] = await res.Body.transformToString()
    })
  )
  return files
}

export async function storePipelineUploadFiles(
  uploadId: string,
  files: Record<string, string>
): Promise<string> {
  const client = getS3Client()
  const baseKey = `packages/pipeline-uploads/${uploadId}`
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      client.send(new PutObjectCommand({
        Bucket: BUCKET(),
        Key: `${baseKey}/${filename}`,
        Body: content,
        ContentType: filename.endsWith('.json') ? 'application/json' : 'text/plain',
      }))
    )
  )
  return baseKey
}

export async function deletePipelineUploadFiles(storageKey: string): Promise<void> {
  const client = getS3Client()
  const list = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET(),
    Prefix: storageKey + '/',
  }))
  await Promise.all(
    (list.Contents ?? []).map(async (obj) => {
      if (obj.Key) {
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: obj.Key }))
      }
    })
  )
}
