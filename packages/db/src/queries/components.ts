import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import { getDb, getPool } from '../client'
import { components, type Component, type NewComponent } from '../schema'

export interface SearchParams {
  queryEmbedding: number[]
  tags?: string[]
  category?: string
  complexity?: string
  minRating?: number
  sortBy?: 'relevance' | 'rating' | 'downloads' | 'recent'
  limit?: number
  offset?: number
}

export interface SearchResult extends Component {
  relevanceScore: number
}

export async function searchComponents(params: SearchParams): Promise<{ results: SearchResult[], total: number }> {
  const pool = getPool()
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const sortBy = params.sortBy ?? 'relevance'

  const embeddingStr = `[${params.queryEmbedding.join(',')}]`

  // Build WHERE conditions
  const conditions: string[] = [
    'c.flagged = false',
    'c.revoked = false',
  ]
  const bindings: unknown[] = [embeddingStr]

  if (params.tags?.length) {
    bindings.push(params.tags)
    conditions.push(`c.tags && $${bindings.length}::text[]`)
  }
  if (params.category) {
    bindings.push(params.category)
    conditions.push(`c.category = $${bindings.length}`)
  }
  if (params.complexity) {
    bindings.push(params.complexity)
    conditions.push(`c.complexity = $${bindings.length}`)
  }
  if (params.minRating) {
    bindings.push(params.minRating)
    conditions.push(`(c.rating_sum::float / NULLIF(c.rating_count, 0)) >= $${bindings.length}`)
  }

  const whereClause = conditions.join(' AND ')

  const orderExpr = {
    relevance: '1 - (c.embedding <=> $1::vector)',
    rating: 'c.rating_sum::float / NULLIF(c.rating_count, 0)',
    downloads: 'c.download_count',
    recent: 'EXTRACT(EPOCH FROM c.created_at)',
  }[sortBy]

  bindings.push(limit)
  bindings.push(offset)

  const query = `
    SELECT c.*, 1 - (c.embedding <=> $1::vector) AS relevance_score
    FROM components c
    WHERE ${whereClause}
    ORDER BY ${orderExpr} DESC NULLS LAST
    LIMIT $${bindings.length - 1} OFFSET $${bindings.length}
  `

  const countQuery = `
    SELECT COUNT(*)::int AS total FROM components c WHERE ${whereClause}
  `

  const [resultsRes, countRes] = await Promise.all([
    pool.query(query, bindings),
    pool.query(countQuery, bindings.slice(0, bindings.length - 2)),
  ])

  return {
    results: resultsRes.rows as SearchResult[],
    total: countRes.rows[0]?.total ?? 0,
  }
}

export async function getComponentById(id: string): Promise<Component | undefined> {
  const db = getDb()
  return db.query.components.findFirst({ where: eq(components.id, id) })
}

export async function createComponent(data: NewComponent & { embedding?: number[] }): Promise<Component> {
  const pool = getPool()

  const { embedding, ...rest } = data

  // Insert without embedding first
  const db = getDb()
  const [comp] = await db.insert(components).values(rest).returning()
  if (!comp) throw new Error('Failed to create component')

  // Set embedding if provided
  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`
    await pool.query(
      `UPDATE components SET embedding = $1::vector WHERE id = $2`,
      [embeddingStr, comp.id]
    )
  }

  return comp
}

export async function updateComponent(id: string, data: Partial<Component>): Promise<Component> {
  const db = getDb()
  const [comp] = await db.update(components).set({ ...data, updatedAt: new Date() }).where(eq(components.id, id)).returning()
  if (!comp) throw new Error('Component not found')
  return comp
}

export async function getTrendingComponents(period: 'day' | 'week' | 'month', limit = 20): Promise<Component[]> {
  const pool = getPool()
  const interval = { day: '1 day', week: '7 days', month: '30 days' }[period]

  const res = await pool.query(`
    SELECT c.*, COUNT(de.id) AS download_recent
    FROM components c
    LEFT JOIN download_events de
      ON de.component_id = c.id
      AND de.created_at > NOW() - INTERVAL '${interval}'
    WHERE c.flagged = false AND c.revoked = false
    GROUP BY c.id
    ORDER BY download_recent DESC, c.download_count DESC
    LIMIT $1
  `, [limit])

  return res.rows as Component[]
}

export async function getPopularComponents(limit = 20): Promise<Component[]> {
  const db = getDb()
  return db.query.components.findMany({
    where: and(eq(components.flagged, false), eq(components.revoked, false)),
    orderBy: [desc(components.downloadCount)],
    limit,
  })
}

export async function checkComponentRevocations(ids: string[]): Promise<Component[]> {
  const db = getDb()
  return db.query.components.findMany({
    where: and(eq(components.revoked, true), inArray(components.id, ids)),
  })
}
