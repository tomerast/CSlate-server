import { callAnthropic } from '@cslate/llm'
import type { PipelineReviewContext, StageResult } from '../pipeline-types'

const PIPELINE_CATALOGING_SYSTEM = `You are a technical writer generating catalog metadata for a data pipeline library.

Given a pipeline's code and manifest, generate structured metadata to help users discover and understand it.

Respond with JSON only — no markdown, no explanation:
{
  "summary": "2-3 sentence description of what this pipeline does and how",
  "category": "one of: finance, weather, social, news, ecommerce, analytics, iot, other",
  "subcategory": "specific subcategory string",
  "complexity": "simple" | "moderate" | "complex",
  "contextSummary": "1 sentence optimized for embedding context",
  "modificationHints": ["how to customize this pipeline"],
  "extensionPoints": ["what can be added to this pipeline"]
}`

export async function catalogPipeline(
  ctx: PipelineReviewContext,
): Promise<StageResult> {
  const start = Date.now()

  try {
    const model = process.env.LLM_CATALOG_MODEL ?? 'claude-haiku-4-5-20251001'

    const fileContents = Object.entries(ctx.files)
      .filter(([n]) => n.endsWith('.ts') || n.endsWith('.js'))
      .map(([n, c]) => `\`\`\`${n}\n${c}\n\`\`\``)
      .join('\n\n')

    const prompt = `Pipeline: ${ctx.manifest.name}
Description: ${ctx.manifest.description}
Tags: ${ctx.manifest.tags.join(', ')}
Strategy: ${ctx.manifest.strategy.type}
Secrets needed: ${Object.keys(ctx.manifest.secrets).join(', ') || 'none'}

Code:
${fileContents}

Generate catalog metadata for this pipeline.`

    const responseText = await callAnthropic({ model, system: PIPELINE_CATALOGING_SYSTEM, prompt })

    interface CatalogingOutput {
      summary: string
      category: string
      subcategory: string
      complexity: 'simple' | 'moderate' | 'complex'
      contextSummary: string
      modificationHints: string[]
      extensionPoints: string[]
    }

    const output = JSON.parse(responseText) as CatalogingOutput

    return {
      stage: 'cataloging',
      status: 'passed',
      duration: Date.now() - start,
      data: {
        summary: output.summary,
        category: output.category,
        subcategory: output.subcategory,
        complexity: output.complexity,
        contextSummary: output.contextSummary,
        modificationHints: output.modificationHints,
        extensionPoints: output.extensionPoints,
      },
    }
  } catch {
    // Cataloging failure is non-fatal — return minimal fallback data
    return {
      stage: 'cataloging',
      status: 'passed',
      duration: Date.now() - start,
      data: {
        summary: ctx.manifest.description,
        category: 'other',
        subcategory: '',
        complexity: 'moderate',
        contextSummary: ctx.manifest.description,
        modificationHints: [],
        extensionPoints: [],
      },
    }
  }
}
