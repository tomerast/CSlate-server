import { getEmbedding } from '@cslate/llm'
import { getPool } from '@cslate/db'
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

    // TODO(data-layer): Replace with createPipeline() from @cslate/db once
    // the pipeline DB schema and queries are implemented (data-pipelines-data-layer branch).
    // For now, update the upload record with approved status and storage key.
    const pool = getPool()
    await pool.query(
      `UPDATE uploads SET status = 'approved', storage_key = $1, updated_at = now() WHERE id = $2`,
      [storageKey, ctx.uploadId],
    )

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
