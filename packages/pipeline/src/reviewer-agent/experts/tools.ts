import { buildTool, type CSTool } from '@cslate/shared/agent'
import { z } from 'zod'
import type { StaticAnalysisResult } from '../types'

export function buildExpertTools(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
): CSTool[] {
  return [
    buildTool({
      name: 'readFile',
      description: 'Read the full content of a file from the submitted component package.',
      inputSchema: z.object({
        filename: z.string().describe('Filename to read, e.g. ui.tsx or logic/data.ts'),
      }),
      isReadOnly: () => true,
      call: async ({ filename }) => {
        const content = files[filename]
        if (!content) return { data: `File not found: ${filename}. Available: ${Object.keys(files).join(', ')}` }
        return { data: content }
      },
    }),

    buildTool({
      name: 'listFiles',
      description: 'List all files in the submitted component package.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: Object.keys(files).join('\n') }),
    }),

    buildTool({
      name: 'searchCode',
      description: 'Search for a pattern across all files. Returns file:line matches.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        filename: z.string().optional().describe('Limit to this file only'),
      }),
      isReadOnly: () => true,
      call: async ({ pattern, filename }) => {
        const regex = new RegExp(pattern, 'gm')
        const results: string[] = []
        const targetFiles = filename ? { [filename]: files[filename] ?? '' } : files
        for (const [fname, content] of Object.entries(targetFiles)) {
          content.split('\n').forEach((line, idx) => {
            const matched = regex.test(line)
            regex.lastIndex = 0
            if (matched) results.push(`${fname}:${idx + 1}: ${line.trim()}`)
          })
        }
        return { data: results.slice(0, 50).join('\n') || 'No matches found' }
      },
    }),

    buildTool({
      name: 'checkPattern',
      description: 'Check if a specific pattern exists in a file with surrounding context.',
      inputSchema: z.object({
        filename: z.string(),
        pattern: z.string(),
        contextLines: z.number().optional().default(3),
      }),
      isReadOnly: () => true,
      call: async ({ filename, pattern, contextLines = 3 }) => {
        const content = files[filename]
        if (!content) return { data: `File not found: ${filename}` }
        const regex = new RegExp(pattern, 'm')
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
      name: 'getManifest',
      description: 'Get the component manifest to check declared data sources, inputs, outputs.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: JSON.stringify(manifest, null, 2) }),
    }),

    buildTool({
      name: 'getStaticAnalysisFindings',
      description: 'Get findings from Phase 1 static analysis. Use as starting point, then verify with other tools.',
      inputSchema: z.object({
        severity: z.enum(['critical', 'warning', 'all']).optional().default('all'),
      }),
      isReadOnly: () => true,
      call: async ({ severity = 'all' }) => {
        const findings = severity === 'critical' ? staticResult.criticalFindings
          : severity === 'warning' ? staticResult.warnings
          : [...staticResult.criticalFindings, ...staticResult.warnings]
        return { data: JSON.stringify(findings.slice(0, 20), null, 2) }
      },
    }),
  ]
}
