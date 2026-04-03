import { PipelineContext, StageResult } from '../types'
import { getEmbedding } from '@cslate/llm'
import { getPool, createComponent, searchComponents } from '@cslate/db'
import { eq, and } from 'drizzle-orm'
import { getDb, components } from '@cslate/db'
import { createLogger } from '@cslate/logger'
const log = createLogger('pipeline:embedding')

function buildEmbeddingText(ctx: PipelineContext, catalogData: Record<string, unknown>): string {
  const m = ctx.manifest
  const summary = (catalogData['summary'] as string) ?? m.description
  const contextSummary = (catalogData['contextSummary'] as string) ?? ''
  const dataSourceDescs = (m.dataSources ?? []).map(ds => ds.description ?? ds.name).join(', ')
  const inputDescs = (m.inputs ?? []).map(i => i.description ?? i.name).join(', ')
  const outputDescs = (m.outputs ?? []).map(o => o.description ?? o.name).join(', ')

  return [
    `Component: ${m.name}`,
    `Description: ${m.description}`,
    `Tags: ${m.tags.join(', ')}`,
    `Summary: ${summary}`,
    contextSummary ? `Context: ${contextSummary}` : '',
    dataSourceDescs ? `Data Sources: ${dataSourceDescs}` : '',
    inputDescs ? `Inputs: ${inputDescs}` : '',
    outputDescs ? `Outputs: ${outputDescs}` : '',
  ].filter(Boolean).join('\n')
}

export async function embeddingAndStore(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()

  try {
    log.debug({ uploadId: ctx.uploadId }, 'embedding start')
    // Get catalog data from previous stage
    const catalogResult = ctx.previousResults.find(r => r.stage === 'cataloging')
    const catalogData = catalogResult?.data ?? {}

    // Build embedding text and generate embedding
    const embeddingText = buildEmbeddingText(ctx, catalogData)
    const embedding = await getEmbedding(embeddingText)
    log.debug({ uploadId: ctx.uploadId, embeddingDims: embedding.length }, 'embedding generated')

    // Check for existing component with same name + author (versioning)
    const db = getDb()
    const upload = await db.query.uploads.findFirst({
      where: (u, { eq }) => eq(u.id, ctx.uploadId),
      columns: { authorId: true, storageKey: true },
    })

    let parentId: string | undefined
    if (upload) {
      const existing = await db.query.components.findFirst({
        where: and(
          eq(components.name, ctx.manifest.name),
          eq(components.authorId, upload.authorId ?? ''),
        ),
        columns: { id: true },
      })
      if (existing) parentId = existing.id
    }

    // Compute ai.similarTo — top 5 nearest neighbors
    const { results: similar } = await searchComponents({
      queryEmbedding: embedding,
      limit: 6,
    })
    const similarTo = similar
      .filter(c => c.name !== ctx.manifest.name)
      .slice(0, 5)
      .map(c => c.name)
    log.debug({ uploadId: ctx.uploadId, similarCount: similarTo.length, similarTo }, 'similar components found')

    // Prepare enriched manifest
    const enrichedManifest = {
      ...ctx.manifest,
      ai: {
        ...ctx.manifest.ai,
        modificationHints: (catalogData['aiHints'] as { modificationHints?: string[] })?.modificationHints ?? [],
        extensionPoints: (catalogData['aiHints'] as { extensionPoints?: string[] })?.extensionPoints ?? [],
        similarTo,
      },
    }

    // Store component in DB
    const component = await createComponent({
      name: ctx.manifest.name,
      title: ctx.manifest.title,
      description: ctx.manifest.description,
      tags: ctx.manifest.tags,
      version: ctx.manifest.version,
      category: (catalogData['category'] as string) ?? undefined,
      subcategory: (catalogData['subcategory'] as string) ?? undefined,
      complexity: (catalogData['complexity'] as string) ?? undefined,
      summary: (catalogData['summary'] as string) ?? undefined,
      contextSummary: (catalogData['contextSummary'] as string) ?? undefined,
      authorId: upload?.authorId ?? undefined,
      manifest: enrichedManifest,
      storageKey: upload?.storageKey ?? '',
      parentId: parentId ?? undefined,
      embedding,
    })
    log.info({ uploadId: ctx.uploadId, componentId: component.id, componentName: ctx.manifest.name }, 'component stored')

    // Update upload with component_id
    if (upload) {
      const pool = getPool()
      await pool.query(
        `UPDATE uploads SET component_id = $1, status = 'approved', updated_at = now() WHERE id = $2`,
        [component.id, ctx.uploadId]
      )
    }

    return {
      stage: 'embedding',
      status: 'passed',
      duration: Date.now() - start,
      data: { componentId: component.id },
    }
  } catch (err) {
    log.warn({ uploadId: ctx.uploadId, err }, 'embedding/store failed')
    return {
      stage: 'embedding',
      status: 'failed',
      duration: Date.now() - start,
      issues: [{
        severity: 'critical',
        message: `Embedding/store failed: ${err instanceof Error ? err.message : String(err)}`,
      }],
    }
  }
}
