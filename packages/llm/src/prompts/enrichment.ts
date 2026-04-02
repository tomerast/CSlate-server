// Enrichment prompts are used in the cataloging stage to generate ai.similarTo
// The actual similarity search uses pgvector — this prompt generates the ai hints portion

export function buildEnrichmentPrompt(params: {
  componentName: string
  summary: string
  similarComponents: Array<{ name: string; summary: string }>
}): string {
  const similarList = params.similarComponents
    .map(c => `- ${c.name}: ${c.summary}`)
    .join('\n')

  return `Component: "${params.componentName}"
Summary: "${params.summary}"

Similar components already in the library:
${similarList}

Explain in 1 sentence how this component differs from the similar ones listed, or confirm it fills a unique niche.`
}
