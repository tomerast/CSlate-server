import { eq, and, desc } from 'drizzle-orm'
import { getDb, getPool } from '../client'
import { pipelines, type Pipeline, type NewPipeline } from '../schema/pipelines'
import { pipelineUploads, type PipelineUpload, type NewPipelineUpload } from '../schema/pipeline-uploads'

export interface PipelineSearchParams {
  queryEmbedding: number[]
  tags?: string[]
  category?: string
  strategyType?: string
  minRating?: number
  sortBy?: 'relevance' | 'rating' | 'downloads' | 'recent'
  limit?: number
  offset?: number
}

export interface PipelineSearchResult extends Pipeline {
  relevanceScore: number
}

export async function searchPipelines(params: PipelineSearchParams): Promise<{ results: PipelineSearchResult[], total: number }> {
  const pool = getPool()
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const validSortOptions = ['relevance', 'rating', 'downloads', 'recent'] as const
  const sortBy = validSortOptions.includes(params.sortBy as typeof validSortOptions[number])
    ? params.sortBy!
    : 'relevance'

  const embeddingStr = `[${params.queryEmbedding.join(',')}]`

  const conditions: string[] = [
    'p.flagged = false',
    'p.revoked = false',
  ]
  const bindings: unknown[] = [embeddingStr]

  if (params.tags?.length) {
    bindings.push(params.tags)
    conditions.push(`p.tags && $${bindings.length}::text[]`)
  }
  if (params.category) {
    bindings.push(params.category)
    conditions.push(`p.category = $${bindings.length}`)
  }
  if (params.strategyType) {
    bindings.push(params.strategyType)
    conditions.push(`p.strategy_type = $${bindings.length}`)
  }
  if (params.minRating) {
    bindings.push(params.minRating)
    conditions.push(`(p.rating_sum::float / NULLIF(p.rating_count, 0)) >= $${bindings.length}`)
  }

  const whereClause = conditions.join(' AND ')

  const orderExpr = {
    relevance: '1 - (p.embedding <=> $1::vector)',
    rating: 'p.rating_sum::float / NULLIF(p.rating_count, 0)',
    downloads: 'p.download_count',
    recent: 'EXTRACT(EPOCH FROM p.created_at)',
  }[sortBy]

  bindings.push(limit)
  bindings.push(offset)

  const query = `
    SELECT p.*, 1 - (p.embedding <=> $1::vector) AS relevance_score
    FROM pipelines p
    WHERE ${whereClause}
    ORDER BY ${orderExpr} DESC NULLS LAST
    LIMIT $${bindings.length - 1} OFFSET $${bindings.length}
  `

  const countQuery = `
    SELECT COUNT(*)::int AS total FROM pipelines p WHERE ${whereClause}
  `

  const [resultsRes, countRes] = await Promise.all([
    pool.query(query, bindings),
    pool.query(countQuery, bindings.slice(0, bindings.length - 2)),
  ])

  return {
    results: resultsRes.rows as PipelineSearchResult[],
    total: countRes.rows[0]?.total ?? 0,
  }
}

export async function getPipelineById(id: string): Promise<Pipeline | undefined> {
  const db = getDb()
  return db.query.pipelines.findFirst({ where: eq(pipelines.id, id) })
}

export async function createPipeline(data: NewPipeline & { embedding?: number[] }): Promise<Pipeline> {
  const pool = getPool()
  const { embedding, ...rest } = data

  const db = getDb()
  const [pipeline] = await db.insert(pipelines).values(rest).returning()
  if (!pipeline) throw new Error('Failed to create pipeline')

  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`
    await pool.query(
      `UPDATE pipelines SET embedding = $1::vector WHERE id = $2`,
      [embeddingStr, pipeline.id]
    )
  }

  return pipeline
}

type PipelineUpdateFields = Partial<Pick<Pipeline,
  'flagged' | 'revoked' | 'revokeReason' | 'revokedAt' |
  'summary' | 'contextSummary' | 'category' | 'subcategory' |
  'complexity' | 'downloadCount' | 'ratingSum' | 'ratingCount' |
  'manifest' | 'tags' | 'description' | 'updatedAt' | 'storageKey'
>>

export async function updatePipeline(id: string, data: PipelineUpdateFields): Promise<Pipeline> {
  const db = getDb()
  const [pipeline] = await db.update(pipelines).set({ ...data, updatedAt: new Date() }).where(eq(pipelines.id, id)).returning()
  if (!pipeline) throw new Error('Pipeline not found')
  return pipeline
}

export async function incrementDownloadCount(id: string): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE pipelines SET download_count = download_count + 1 WHERE id = $1`,
    [id]
  )
}

export async function getPopularPipelines(limit = 20): Promise<Pipeline[]> {
  const db = getDb()
  return db.query.pipelines.findMany({
    where: and(eq(pipelines.flagged, false), eq(pipelines.revoked, false)),
    orderBy: [desc(pipelines.downloadCount)],
    limit,
  })
}

// Upload staging
export async function createPipelineUpload(data: NewPipelineUpload): Promise<PipelineUpload> {
  const db = getDb()
  const [upload] = await db.insert(pipelineUploads).values(data).returning()
  if (!upload) throw new Error('Failed to create pipeline upload')
  return upload
}

export async function getPipelineUploadById(id: string): Promise<PipelineUpload | undefined> {
  const db = getDb()
  return db.query.pipelineUploads.findFirst({ where: eq(pipelineUploads.id, id) })
}

export async function updatePipelineUpload(id: string, data: Partial<PipelineUpload>): Promise<PipelineUpload> {
  const db = getDb()
  const [upload] = await db.update(pipelineUploads).set({ ...data, updatedAt: new Date() }).where(eq(pipelineUploads.id, id)).returning()
  if (!upload) throw new Error('Pipeline upload not found')
  return upload
}
