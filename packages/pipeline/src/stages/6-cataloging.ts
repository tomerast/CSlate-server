import { PipelineContext, StageResult } from '../types'
import { callAnthropic, buildCatalogingPrompt, CATALOGING_SYSTEM } from '@cslate/llm'

interface CatalogingOutput {
  summary: string
  category: string
  subcategory: string
  complexity: 'simple' | 'moderate' | 'complex'
  contextSummary: string
  tags: string[]
  aiHints: {
    modificationHints: string[]
    extensionPoints: string[]
  }
}

export async function cataloging(ctx: PipelineContext): Promise<StageResult> {
  const start = Date.now()

  try {
    const model = process.env.LLM_CATALOG_MODEL ?? 'claude-haiku-4-5-20251001'
    const prompt = buildCatalogingPrompt({
      componentName: ctx.manifest.name,
      manifest: ctx.manifest as Record<string, unknown>,
      files: ctx.files,
      contextMd: ctx.files['context.md'],
    })

    const responseText = await callAnthropic({ model, system: CATALOGING_SYSTEM, prompt })
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
        tags: output.tags,
        aiHints: output.aiHints,
      },
    }
  } catch (err) {
    // Cataloging always passes — log error and return minimal data
    return {
      stage: 'cataloging',
      status: 'passed',
      duration: Date.now() - start,
      data: {
        summary: ctx.manifest.description,
        category: 'utility',
        subcategory: '',
        complexity: 'moderate',
        contextSummary: '',
        tags: ctx.manifest.tags,
        aiHints: { modificationHints: [], extensionPoints: [] },
      },
    }
  }
}
