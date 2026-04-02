import type { ReviewerKnowledgeBase } from '../types'

export function injectKnowledge(
  basePrompt: string,
  kb: ReviewerKnowledgeBase,
  dimensions: number[],
): string {
  const relevantStandards = kb.codeStandards
    .filter(s => dimensions.includes(s.dimension))
    .filter(s => s.confidence > 30)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)

  const relevantPatterns = kb.patternLibrary
    .filter(p => dimensions.includes(p.dimension) && p.type === 'rejected')
    .slice(0, 10)

  if (relevantStandards.length === 0 && relevantPatterns.length === 0) return basePrompt

  let injection = '\n\n## Learned Standards for This Review\n'
  for (const s of relevantStandards) {
    injection += `- [Dim ${s.dimension}] ${s.rule} (confidence: ${s.confidence}%)\n`
  }

  if (relevantPatterns.length > 0) {
    injection += '\n## Known Bad Patterns to Watch For\n'
    for (const p of relevantPatterns) {
      injection += `- [Dim ${p.dimension}] ${p.patternDesc}\n`
    }
  }

  return basePrompt + injection
}
