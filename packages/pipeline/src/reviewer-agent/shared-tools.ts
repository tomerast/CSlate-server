import { buildTool, type CSTool } from '@cslate/shared/agent'
import { z } from 'zod'

/**
 * Core tools shared across expert, red-team, and judge agents.
 * Phase-specific tools are composed on top of these in each phase's tools.ts.
 */

export function buildReadFileTool(files: Record<string, string>): CSTool {
  return buildTool({
    name: 'readFile',
    description: 'Read the full content of a file from the submitted component package.',
    inputSchema: z.object({
      filename: z.string().describe('Filename to read, e.g. ui.tsx or logic/data.ts'),
    }),
    isReadOnly: () => true,
    call: async ({ filename }: { filename: string }) => {
      const content = files[filename]
      if (!content) return { data: `File not found: ${filename}. Available: ${Object.keys(files).join(', ')}` }
      return { data: content }
    },
  })
}

export function buildListFilesTool(files: Record<string, string>): CSTool {
  return buildTool({
    name: 'listFiles',
    description: 'List all files in the submitted component package.',
    inputSchema: z.object({}),
    isReadOnly: () => true,
    call: async () => ({ data: Object.keys(files).join('\n') }),
  })
}

const MAX_SEARCH_RESULTS = 50

export function buildSearchCodeTool(files: Record<string, string>): CSTool {
  return buildTool({
    name: 'searchCode',
    description: 'Search for a regex pattern across all files. Returns file:line matches.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      filename: z.string().optional().describe('Limit to this file only'),
    }),
    isReadOnly: () => true,
    call: async ({ pattern, filename }: { pattern: string; filename?: string }) => {
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
      return { data: results.slice(0, MAX_SEARCH_RESULTS).join('\n') || 'No matches found' }
    },
  })
}

export function buildGetManifestTool(manifest: Record<string, unknown>): CSTool {
  return buildTool({
    name: 'getManifest',
    description: 'Get the component manifest to check declared data sources, inputs, outputs.',
    inputSchema: z.object({}),
    isReadOnly: () => true,
    call: async () => ({ data: JSON.stringify(manifest, null, 2) }),
  })
}
