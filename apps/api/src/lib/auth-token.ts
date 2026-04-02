import crypto from 'crypto'

export function generateApiKey(): string {
  const bytes = crypto.randomBytes(32)
  return 'cslate_' + bytes.toString('base64url')
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}
