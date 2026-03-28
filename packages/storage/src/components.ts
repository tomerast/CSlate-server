import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getS3Client, BUCKET } from './client'

export function componentStorageKey(componentId: string, version: string, filename: string): string {
  return `packages/components/${componentId}/${version}/${filename}`
}

export function uploadStorageKey(uploadId: string, filename: string): string {
  return `packages/uploads/${uploadId}/${filename}`
}

export async function putFile(key: string, content: string): Promise<void> {
  const client = getS3Client()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: content,
    ContentType: key.endsWith('.json') ? 'application/json' : 'text/plain',
  }))
}

export async function getFile(key: string): Promise<string> {
  const client = getS3Client()
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
  if (!res.Body) throw new Error(`File not found: ${key}`)
  return res.Body.transformToString()
}

export async function deleteFile(key: string): Promise<void> {
  const client = getS3Client()
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }))
}

export async function storeComponentFiles(
  componentId: string,
  version: string,
  files: Record<string, string>
): Promise<string> {
  const baseKey = `packages/components/${componentId}/${version}`
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      putFile(`${baseKey}/${filename}`, content)
    )
  )
  return baseKey
}

export async function getComponentFiles(storageKey: string): Promise<Record<string, string>> {
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
      files[filename] = await getFile(obj.Key)
    })
  )
  return files
}

export async function storeUploadFiles(
  uploadId: string,
  files: Record<string, string>
): Promise<string> {
  const baseKey = `packages/uploads/${uploadId}`
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      putFile(`${baseKey}/${filename}`, content)
    )
  )
  return baseKey
}

export async function deleteUploadFiles(storageKey: string): Promise<void> {
  const client = getS3Client()
  const list = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET(),
    Prefix: storageKey + '/',
  }))
  await Promise.all(
    (list.Contents ?? []).map(async (obj) => {
      if (obj.Key) await deleteFile(obj.Key)
    })
  )
}
