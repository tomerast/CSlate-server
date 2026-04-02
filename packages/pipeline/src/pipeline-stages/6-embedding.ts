import { getEmbedding } from '@cslate/llm'
import { createPipeline, updatePipelineUpload } from '@cslate/db'
import { putFile } from '@cslate/storage'
import type { PipelineReviewContext, StageResult } from '../pipeline-types'

function pipelineStorageKey(uploadId: string, filename: string): string {
  return `packages/pipeline-uploads/${uploadId}/${filename}`
}

async function storePipelineFiles(
  uploadId: string,
  files: Record<string, string>,
): Promise<string> {
  const baseKey = `packages/pipeline-uploads/${uploadId}`
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      putFile(pipelineStorageKey(uploadId, filename), content),
    ),
  )
  return baseKey
}

export async function embedAndStorePipeline(
  ctx: PipelineReviewContext,
): Promise<StageResult> {
  const start = Date.now()

  try {
    const catalogResult = ctx.previousResults.find((r) => r.stage === 'cataloging')
    const catalogData = catalogResult?.data ?? {}

    // Generate embedding text from manifest + catalog data
    const embeddingText = [
      `Pipeline: ${ctx.manifest.name}`,
      `Description: ${ctx.manifest.description}`,
      `Tags: ${ctx.manifest.tags.join(' ')}`,
      `Strategy: ${ctx.manifest.strategy.type}`,
      catalogData['summary'] ? `Summary: ${catalogData['summary']}` : '',
      catalogData['contextSummary'] ? `Context: ${catalogData['contextSummary']}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const embedding = await getEmbedding(embeddingText)

    // Store source files to R2
    const storageKey = await storePipelineFiles(ctx.uploadId, ctx.files)

    // Create pipeline record in DB with embedding
    const pipeline = await createPipeline({
      name: ctx.manifest.name,
      pipelineId: ctx.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      description: ctx.manifest.description,
      tags: ctx.manifest.tags,
      version: ctx.manifest.version,
      strategyType: ctx.manifest.strategy.type,
      secretNames: Object.keys(ctx.manifest.secrets),
      outputSchema: ctx.manifest.outputSchema,
      manifest: ctx.manifest,
      storageKey,
      authorId: (ctx as unknown as Record<string, unknown>).authorId as string,
      summary: (catalogData['summary'] as string) ?? null,
      contextSummary: (catalogData['contextSummary'] as string) ?? null,
      category: (catalogData['category'] as string) ?? null,
      embedding,
    })

    // Update upload record to link to the created pipeline
    await updatePipelineUpload(ctx.uploadId, {
      status: 'approved',
      storageKey,
      pipelineId: pipeline.id,
    })

    return {
      stage: 'embedding-store',
      status: 'passed',
      duration: Date.now() - start,
      data: {
        storageKey,
        embeddingDimensions: embedding.length,
      },
    }
  } catch (err) {
    return {
      stage: 'embedding-store',
      status: 'failed',
      duration: Date.now() - start,
      issues: [
        {
          severity: 'critical',
          message: `Embedding/store failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    }
  }
}
