import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getS3Client, BUCKET } from './client'
import { putFile, getFile, deleteFile } from './components'

export function checkpointStorageKey(userId: string, projectId: string, componentLocalId: string, version: number): string {
  return `packages/checkpoints/${userId}/${projectId}/${componentLocalId}/${version}`
}

export async function storeCheckpointFiles(
  userId: string,
  projectId: string,
  componentLocalId: string,
  version: number,
  files: Record<string, string>
): Promise<string> {
  const baseKey = checkpointStorageKey(userId, projectId, componentLocalId, version)
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      putFile(`${baseKey}/${filename}`, content)
    )
  )
  return baseKey
}

export async function getCheckpointFiles(storageKey: string): Promise<Record<string, string>> {
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

export async function deleteCheckpointFiles(storageKey: string): Promise<void> {
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
