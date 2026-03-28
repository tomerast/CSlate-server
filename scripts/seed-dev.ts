#!/usr/bin/env tsx
/**
 * Seed the local dev database with a known test user and API key.
 * Run: pnpm db:seed
 *
 * Creates:
 *   - User: dev@cslate.local
 *   - API key: cslate_dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
 *     (hardcoded for dev — matches DEV_SEED_API_KEY in .env.local)
 *
 * This key can be used directly in the CSlate client's .env.development
 * as VITE_DEV_API_KEY to skip the registration flow entirely.
 */

import 'dotenv/config'
import crypto from 'crypto'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Copy .env.local.example to .env.local and fill in values.')
  process.exit(1)
}

const DEV_API_KEY = 'cslate_dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const DEV_EMAIL = 'dev@cslate.local'

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex')
}

const sql = postgres(DATABASE_URL)

async function seed() {
  console.log('🌱 Seeding dev database...')

  // Upsert dev user
  await sql`
    INSERT INTO users (email, api_key_hash, display_name)
    VALUES (
      ${DEV_EMAIL},
      ${sha256(DEV_API_KEY)},
      'Dev User'
    )
    ON CONFLICT (email) DO UPDATE
      SET api_key_hash = EXCLUDED.api_key_hash,
          display_name = EXCLUDED.display_name
  `

  console.log(`✅ Dev user seeded:`)
  console.log(`   Email:   ${DEV_EMAIL}`)
  console.log(`   API Key: ${DEV_API_KEY}`)
  console.log()
  console.log('Use in CSlate client .env.development:')
  console.log(`   VITE_DEV_API_KEY=${DEV_API_KEY}`)
  console.log(`   VITE_SERVER_URL=http://localhost:3000`)

  await sql.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
