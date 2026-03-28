import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Query pool — used by Drizzle ORM for all application queries
let _pool: Pool | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }
  return _pool
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getPool(), { schema })
  }
  return _db
}

// Dedicated pool for Postgres LISTEN connections (SSE)
// Sized separately from the query pool — one connection per active SSE stream
let _listenPool: Pool | null = null

export function getListenPool(): Pool {
  if (!_listenPool) {
    _listenPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 100, // max concurrent SSE streams
      idleTimeoutMillis: 0, // keep connections alive for long-lived LISTEN
    })
  }
  return _listenPool
}

export type Db = ReturnType<typeof getDb>
