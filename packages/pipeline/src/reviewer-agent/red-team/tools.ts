import { buildTool } from '@cslate/shared/agent'
import { z } from 'zod'
import { BRIDGE_API_SPEC, PLATFORM_CONSTRAINTS } from './platform-spec'
import type { StaticAnalysisResult, ExpertAgentResult } from '../types'

export function buildRedTeamTools(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
) {
  return [
    buildTool({
      name: 'readFile',
      description: 'Read file content to find attack vectors.',
      inputSchema: z.object({ filename: z.string() }),
      isReadOnly: () => true,
      call: async ({ filename }) => {
        const content = files[filename]
        return { data: content ?? `File not found: ${filename}. Available: ${Object.keys(files).join(', ')}` }
      },
    }),

    buildTool({
      name: 'listFiles',
      description: 'List all submitted files.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: Object.keys(files).join('\n') }),
    }),

    buildTool({
      name: 'searchCode',
      description: 'Search for patterns that might indicate attack vectors.',
      inputSchema: z.object({
        pattern: z.string(),
        filename: z.string().optional(),
      }),
      isReadOnly: () => true,
      call: async ({ pattern, filename }) => {
        const regex = new RegExp(pattern, 'gm')
        const results: string[] = []
        const targetFiles = filename ? { [filename]: files[filename] ?? '' } : files
        for (const [fname, content] of Object.entries(targetFiles)) {
          const lines = content.split('\n')
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              results.push(`${fname}:${idx + 1}: ${line.trim()}`)
              regex.lastIndex = 0
            }
          })
        }
        return { data: results.join('\n') || 'No matches' }
      },
    }),

    buildTool({
      name: 'getBridgeAPISpec',
      description:
        'Get the CSlate bridge API spec — what bridge.fetch/subscribe/getConfig can do, sandbox restrictions, and side-channel risks.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: BRIDGE_API_SPEC }),
    }),

    buildTool({
      name: 'getPlatformConstraints',
      description: 'Get CSlate platform security constraints: what is blocked, what is allowed, known side-channel risks.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: PLATFORM_CONSTRAINTS }),
    }),

    buildTool({
      name: 'getExpertFindings',
      description: 'Get all findings from Phase 2 expert agents — use as leads for deeper probing.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({
        data: JSON.stringify(
          expertResults.flatMap(r => r.findings.filter(f => f.severity !== 'info')),
          null,
          2,
        ),
      }),
    }),

    buildTool({
      name: 'getManifest',
      description: 'Get the component manifest to identify declared vs actual behavior mismatches.',
      inputSchema: z.object({}),
      isReadOnly: () => true,
      call: async () => ({ data: JSON.stringify(manifest, null, 2) }),
    }),
  ]
}
