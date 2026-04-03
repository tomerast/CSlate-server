import { buildTool } from '@cslate/shared/agent'
import { z } from 'zod'
import { BRIDGE_API_SPEC, PLATFORM_CONSTRAINTS } from './platform-spec'
import type { StaticAnalysisResult, ExpertAgentResult } from '../types'
import { buildReadFileTool, buildListFilesTool, buildSearchCodeTool, buildGetManifestTool, buildAnalyzeComponentTool } from '../shared-tools'

export function buildRedTeamTools(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
  expertResults: ExpertAgentResult[],
) {
  return [
    buildReadFileTool(files),
    buildListFilesTool(files),
    buildSearchCodeTool(files),
    buildGetManifestTool(manifest),
    buildAnalyzeComponentTool(files, manifest, staticResult),

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
  ]
}
