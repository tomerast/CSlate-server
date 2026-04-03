import { buildTool, type CSTool } from '@cslate/shared/agent'
import { z } from 'zod'
import type { StaticAnalysisResult } from '../types'
import { buildReadFileTool, buildListFilesTool, buildSearchCodeTool, buildGetManifestTool, buildAnalyzeComponentTool, buildGetComponentContextTool } from '../shared-tools'

export function buildExpertTools(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
): CSTool[] {
  return [
    buildReadFileTool(files),
    buildListFilesTool(files),
    buildSearchCodeTool(files),
    buildGetManifestTool(manifest),
    buildAnalyzeComponentTool(files, manifest, staticResult),
    buildGetComponentContextTool(files),

    buildTool({
      name: 'checkPattern',
      description: 'Check if a specific pattern exists in a file with surrounding context.',
      inputSchema: z.object({
        filename: z.string(),
        pattern: z.string(),
        contextLines: z.number().optional().default(3),
      }),
      isReadOnly: () => true,
      call: async ({ filename, pattern, contextLines = 3 }: { filename: string; pattern: string; contextLines?: number }) => {
        const content = files[filename]
        if (!content) return { data: `File not found: ${filename}` }
        let regex: RegExp
        try {
          regex = new RegExp(pattern, 'm')
        } catch (err) {
          return { data: `Invalid regex pattern: ${(err as Error).message}` }
        }
        const match = regex.exec(content)
        if (!match) return { data: 'Pattern not found' }
        const lines = content.split('\n')
        const matchLine = content.substring(0, match.index).split('\n').length
        const start = Math.max(0, matchLine - contextLines - 1)
        const end = Math.min(lines.length, matchLine + contextLines)
        const snippet = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
        return { data: `Match at line ${matchLine}:\n${snippet}` }
      },
    }),

    buildTool({
      name: 'getStaticAnalysisFindings',
      description: 'Get findings from Phase 1 static analysis. Use as starting point, then verify with other tools.',
      inputSchema: z.object({
        severity: z.enum(['critical', 'warning', 'all']).optional().default('all'),
      }),
      isReadOnly: () => true,
      call: async ({ severity = 'all' }: { severity?: string }) => {
        const findings = severity === 'critical' ? staticResult.criticalFindings
          : severity === 'warning' ? staticResult.warnings
          : [...staticResult.criticalFindings, ...staticResult.warnings]
        return { data: JSON.stringify(findings.slice(0, 20), null, 2) }
      },
    }),
  ]
}
