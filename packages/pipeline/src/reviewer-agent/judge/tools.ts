import { z } from 'zod'
import { buildTool } from '@cslate/shared/agent'
import type { ExpertFinding } from '../types'
import { buildReadFileTool, buildSearchCodeTool } from '../shared-tools'

export function buildJudgeTools(
  files: Record<string, string>,
  allFindings: ExpertFinding[],
) {
  return [
    buildReadFileTool(files),
    buildSearchCodeTool(files),

    buildTool({
      name: 'verifyFinding',
      description: 'Verify a specific finding by searching for its evidence in the actual code. Returns whether the evidence is confirmed, modified, or absent.',
      inputSchema: z.object({
        filename: z.string(),
        line: z.number().optional(),
        evidencePattern: z.string().describe('Pattern from the finding evidence to search for'),
      }),
      isReadOnly: () => true,
      call: async ({ filename, line, evidencePattern }: { filename: string; line?: number; evidencePattern: string }) => {
        const content = files[filename]
        if (!content) return { data: `File ${filename} not found — finding is hallucinated` }
        let regex: RegExp
        try {
          regex = new RegExp(evidencePattern, 'm')
        } catch (err) {
          return { data: `Invalid evidence pattern: ${(err as Error).message}. Try a simpler search string.` }
        }
        const found = regex.test(content)
        if (found && line) {
          const lines = content.split('\n')
          const actualLine = lines.findIndex(l => regex.test(l)) + 1
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
      call: async ({ severity }: { severity: string }) => ({
        data: JSON.stringify(
          severity === 'all' ? allFindings : allFindings.filter(f => f.severity === severity),
          null, 2,
        ),
      }),
    }),
  ]
}
