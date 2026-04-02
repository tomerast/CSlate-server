import { z } from 'zod'
import { buildTool } from '@cslate/shared/agent'
import { ExpertFinding } from '../types'

export function buildJudgeTools(
  files: Record<string, string>,
  allFindings: ExpertFinding[],
) {
  return [
    buildTool({
      name: 'readFile',
      description: 'Read a file to verify whether a finding actually exists in the code.',
      inputSchema: z.object({ filename: z.string() }),
      isReadOnly: () => true,
      call: async ({ filename }) => ({
        data: files[filename] ?? `Not found. Available: ${Object.keys(files).join(', ')}`,
      }),
    }),

    buildTool({
      name: 'verifyFinding',
      description: 'Verify a specific finding by searching for its evidence in the actual code. Returns whether the evidence is confirmed, modified, or absent.',
      inputSchema: z.object({
        filename: z.string(),
        line: z.number().optional(),
        evidencePattern: z.string().describe('Pattern from the finding evidence to search for'),
      }),
      isReadOnly: () => true,
      call: async ({ filename, line, evidencePattern }) => {
        const content = files[filename]
        if (!content) return { data: `File ${filename} not found — finding is hallucinated` }
        const regex = new RegExp(evidencePattern, 'm')
        const found = regex.test(content)
        if (found && line) {
          const lines = content.split('\n')
          const actualLine = content.split('\n').findIndex(l => new RegExp(evidencePattern, 'm').test(l)) + 1
          const context = lines.slice(Math.max(0, actualLine - 3), actualLine + 3).join('\n')
          return { data: `CONFIRMED at line ${actualLine}:\n${context}` }
        }
        return { data: found ? 'CONFIRMED: pattern found in file' : 'NOT FOUND: pattern absent — likely hallucinated' }
      },
    }),

    buildTool({
      name: 'listFindings',
      description: 'Get all findings from expert agents organized by dimension and severity.',
      inputSchema: z.object({
        severity: z.enum(['critical', 'warning', 'info', 'all']).default('all'),
      }),
      isReadOnly: () => true,
      call: async ({ severity }) => ({
        data: JSON.stringify(
          severity === 'all' ? allFindings : allFindings.filter(f => f.severity === severity),
          null, 2,
        ),
      }),
    }),

    buildTool({
      name: 'searchCode',
      description: 'Search for a pattern across all files to find evidence.',
      inputSchema: z.object({ pattern: z.string() }),
      isReadOnly: () => true,
      call: async ({ pattern }) => {
        const results: string[] = []
        for (const [fname, content] of Object.entries(files)) {
          const regex = new RegExp(pattern, 'gm')
          content.split('\n').forEach((lineText, idx) => {
            if (regex.test(lineText)) {
              results.push(`${fname}:${idx + 1}: ${lineText.trim()}`)
              regex.lastIndex = 0
            }
          })
        }
        return { data: results.join('\n') || 'No matches found' }
      },
    }),
  ]
}
