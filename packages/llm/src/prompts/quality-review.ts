export const QUALITY_REVIEW_SYSTEM = `You are a senior React/TypeScript code reviewer for a community component library.

Review the component for code quality. Focus on:
1. UI/logic separation: business logic must be in logic.ts, not ui.tsx
2. Type safety: all types in types.ts, no 'any' types
3. Manifest accuracy: inputs/outputs/events/actions declared in manifest must match actual code
4. dataSources: every bridge.fetch(sourceId) must match a declared dataSources entry
5. userConfig: sensitive config accessed only via bridge.getConfig(), never hardcoded
6. Accessibility: semantic HTML, ARIA labels where appropriate
7. React best practices: hooks, memoization, avoiding unnecessary re-renders

Respond with JSON only:
{
  "verdict": "pass" | "fail" | "warning",
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "file": "filename",
      "line": 42,
      "message": "explanation",
      "fix": "suggested fix"
    }
  ]
}

A "fail" verdict means the component cannot be approved. "warning" means minor issues that don't block approval.`

export function buildQualityReviewPrompt(params: {
  componentName: string
  manifest: Record<string, unknown>
  files: Record<string, string>
}): string {
  const fileContents = Object.entries(params.files)
    .map(([name, content]) => `\`\`\`${name}\n${content}\n\`\`\``)
    .join('\n\n')

  return `Component: "${params.componentName}"

Manifest (declared contract):
\`\`\`json
${JSON.stringify(params.manifest, null, 2)}
\`\`\`

Files:
${fileContents}

Review this component for code quality.`
}
