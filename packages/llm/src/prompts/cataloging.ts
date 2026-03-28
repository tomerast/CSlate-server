export const CATALOGING_SYSTEM = `You are cataloging React/TypeScript components for a community library.

Generate metadata for this component. Respond with JSON only:
{
  "summary": "1-2 sentence description of what this component does",
  "category": "one of: display, input, layout, navigation, data, feedback, media, chart, form, utility",
  "subcategory": "specific subcategory within category",
  "complexity": "simple" | "moderate" | "complex",
  "contextSummary": "1-2 sentences on why this was built / what problem it solves (from context.md)",
  "tags": ["tag1", "tag2"],
  "aiHints": {
    "modificationHints": ["specific hint about modifying ui.tsx", "specific hint about logic.ts"],
    "extensionPoints": ["named customization surface 1", "named customization surface 2"]
  }
}

Rules:
- summary: describe what it shows/does, not implementation details
- complexity: simple = <100 LOC or basic display; moderate = 100-300 LOC or state management; complex = 300+ LOC or complex data flow
- tags: 3-8 relevant terms for search
- modificationHints: reference specific files (e.g. "Edit the chartConfig in logic.ts to change data series")
- extensionPoints: named surfaces (e.g. "headerSlot: inject custom header content")`

export function buildCatalogingPrompt(params: {
  componentName: string
  manifest: Record<string, unknown>
  files: Record<string, string>
  contextMd?: string
}): string {
  const fileContents = Object.entries(params.files)
    .map(([name, content]) => `\`\`\`${name}\n${content}\n\`\`\``)
    .join('\n\n')

  return `Component: "${params.componentName}"

Manifest:
\`\`\`json
${JSON.stringify(params.manifest, null, 2)}
\`\`\`

${params.contextMd ? `Context (why it was built):\n${params.contextMd}\n\n` : ''}Files:
${fileContents}

Catalog this component.`
}
