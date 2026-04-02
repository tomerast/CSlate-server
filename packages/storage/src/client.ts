import { S3Client } from '@aws-sdk/client-s3'

let _client: S3Client | null = null

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
      forcePathStyle: true, // Required for MinIO
    })
  }
  return _client
}

export const BUCKET = () => process.env.R2_BUCKET_NAME ?? 'cslate-dev'
