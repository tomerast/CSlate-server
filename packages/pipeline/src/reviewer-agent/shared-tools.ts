import { buildTool, type CSTool } from '@cslate/shared/agent'
import { z } from 'zod'
import type { StaticAnalysisResult } from './types'

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
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'gm')
      } catch (err) {
        return { data: `Invalid regex pattern: ${(err as Error).message}` }
      }
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

export function buildGetComponentContextTool(files: Record<string, string>): CSTool {
  return buildTool({
    name: 'getComponentContext',
    description: 'Extract React-specific information from the component: hooks used, props interface, event handlers, effects with dependencies, and render structure. Use this to understand React patterns and identify potential issues.',
    inputSchema: z.object({}),
    isReadOnly: () => true,
    call: async () => {
      const sections: string[] = []

      for (const [fname, content] of Object.entries(files)) {
        if (!fname.endsWith('.tsx') && !fname.endsWith('.jsx')) continue

        const fileInfo: string[] = [`## ${fname}`]

        // Hooks usage
        const hookMatches = [...content.matchAll(/\b(use[A-Z]\w*)\s*[(<]/g)]
        const hooks = [...new Set(hookMatches.map(m => m[1]))]
        if (hooks.length > 0) {
          fileInfo.push(`**Hooks:** ${hooks.join(', ')}`)
        }

        // Props interface
        const propsMatch = content.match(/(?:interface|type)\s+(\w*Props\w*)\s*[={]([^}]*)}/)
        if (propsMatch) {
          fileInfo.push(`**Props type:** ${propsMatch[1]}`)
          const propLines = propsMatch[2].split('\n').filter(l => l.trim()).map(l => `  ${l.trim()}`)
          if (propLines.length > 0) fileInfo.push(propLines.join('\n'))
        }

        // useEffect with dependencies
        const effectRegex = /useEffect\(\s*\(\)\s*=>\s*\{[^]*?\}\s*,\s*\[([^\]]*)\]\s*\)/g
        const effects: string[] = []
        let effectMatch
        while ((effectMatch = effectRegex.exec(content)) !== null) {
          const deps = effectMatch[1].trim()
          const lineNum = content.substring(0, effectMatch.index).split('\n').length
          const hasCleanup = effectMatch[0].includes('return ')
          effects.push(`  - Line ${lineNum}: deps=[${deps || 'none'}]${hasCleanup ? '' : ' ⚠️ NO CLEANUP'}`)
        }
        if (effects.length > 0) {
          fileInfo.push(`**Effects (${effects.length}):**`)
          fileInfo.push(...effects)
        }

        // Event handlers
        const handlerMatches = [...content.matchAll(/\b(on[A-Z]\w*|handle[A-Z]\w*)\s*[=:(]/g)]
        const handlers = [...new Set(handlerMatches.map(m => m[1]))]
        if (handlers.length > 0) {
          fileInfo.push(`**Event handlers:** ${handlers.join(', ')}`)
        }

        // State variables
        const stateMatches = [...content.matchAll(/\bconst\s+\[(\w+),\s*set(\w+)\]\s*=\s*useState/g)]
        if (stateMatches.length > 0) {
          fileInfo.push(`**State:** ${stateMatches.map(m => m[1]).join(', ')}`)
        }

        // Refs
        const refMatches = [...content.matchAll(/\bconst\s+(\w+)\s*=\s*useRef/g)]
        if (refMatches.length > 0) {
          fileInfo.push(`**Refs:** ${refMatches.map(m => m[1]).join(', ')}`)
        }

        // Memoized values/callbacks
        const memoMatches = [...content.matchAll(/\bconst\s+(\w+)\s*=\s*(useMemo|useCallback)/g)]
        if (memoMatches.length > 0) {
          fileInfo.push(`**Memoized:** ${memoMatches.map(m => `${m[1]} (${m[2]})`).join(', ')}`)
        }

        if (fileInfo.length > 1) sections.push(fileInfo.join('\n'))
      }

      return { data: sections.length > 0 ? sections.join('\n\n') : 'No React component files (.tsx/.jsx) found' }
    },
  })
}

export function buildAnalyzeComponentTool(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
  staticResult: StaticAnalysisResult,
): CSTool {
  return buildTool({
    name: 'analyzeComponent',
    description: 'Get a high-level summary of the component: what it renders, its state, effects, event handlers, bridge calls, exports, and how it compares to manifest claims. Use this FIRST to understand the component before diving into details.',
    inputSchema: z.object({}),
    isReadOnly: () => true,
    call: async () => {
      const { codeStructure } = staticResult
      const sections: string[] = []

      // File overview
      const fileNames = Object.keys(files)
      sections.push(`## Files (${fileNames.length})`)
      for (const fname of fileNames) {
        const lines = files[fname]!.split('\n').length
        const structure = codeStructure.files[fname]
        const exports = structure?.exports.map(e => `${e.type}:${e.name}`).join(', ') ?? 'none'
        sections.push(`- ${fname} (${lines} lines) — exports: ${exports}`)
      }

      // Functions
      const allFunctions = Object.entries(codeStructure.files).flatMap(
        ([file, s]) => s.functions.map(f => ({ ...f, file }))
      )
      if (allFunctions.length > 0) {
        sections.push(`\n## Functions (${allFunctions.length})`)
        for (const f of allFunctions) {
          const flags = [f.isAsync ? 'async' : '', f.isExported ? 'exported' : ''].filter(Boolean).join(', ')
          sections.push(`- ${f.file}:${f.line} ${f.name}(${f.params.join(', ')}) [${f.lineCount} lines${flags ? ', ' + flags : ''}]`)
        }
      }

      // Bridge calls
      const allBridgeCalls = Object.values(codeStructure.files).flatMap(s => s.bridgeCalls)
      if (allBridgeCalls.length > 0) {
        sections.push(`\n## Bridge API Calls (${allBridgeCalls.length})`)
        for (const bc of allBridgeCalls) {
          const dynamic = bc.isDynamic ? ' ⚠️ DYNAMIC' : ''
          sections.push(`- ${bc.file}:${bc.line} bridge.${bc.type}(${bc.sourceId ?? '???'})${dynamic}`)
        }
      }

      // DOM access
      const allDomAccess = Object.values(codeStructure.files).flatMap(s => s.domAccess)
      if (allDomAccess.length > 0) {
        sections.push(`\n## DOM/Global Access (${allDomAccess.length})`)
        for (const da of allDomAccess) {
          sections.push(`- ${da.file}:${da.line} ${da.type}.${da.property ?? '*'}`)
        }
      }

      // Dynamic expressions
      const allDynamic = Object.values(codeStructure.files).flatMap(s => s.dynamicExpressions)
      if (allDynamic.length > 0) {
        sections.push(`\n## Dynamic Expressions (${allDynamic.length}) ⚠️`)
        for (const de of allDynamic) {
          sections.push(`- ${de.file}:${de.line} ${de.type} [${de.risk} risk]`)
        }
      }

      // Dependency issues
      if (codeStructure.circularDependencies.length > 0) {
        sections.push(`\n## Circular Dependencies ⚠️`)
        for (const cycle of codeStructure.circularDependencies) {
          sections.push(`- ${cycle.join(' → ')}`)
        }
      }
      if (codeStructure.unusedExports.length > 0) {
        sections.push(`\n## Unused Exports`)
        for (const ue of codeStructure.unusedExports) {
          sections.push(`- ${ue.file}: ${ue.name}`)
        }
      }

      // Manifest comparison
      const manifestSources = (manifest as any).dataSources?.map((ds: any) => ds.id) ?? []
      const codeSources = [...new Set(allBridgeCalls.filter(bc => bc.sourceId).map(bc => bc.sourceId))]
      const unusedSources = manifestSources.filter((s: string) => !codeSources.includes(s))
      const undeclaredSources = codeSources.filter(s => !manifestSources.includes(s))
      if (unusedSources.length > 0 || undeclaredSources.length > 0) {
        sections.push(`\n## Manifest vs Code Mismatch`)
        if (unusedSources.length > 0) sections.push(`- Declared but unused sources: ${unusedSources.join(', ')}`)
        if (undeclaredSources.length > 0) sections.push(`- Used but undeclared sources: ${undeclaredSources.join(', ')} ⚠️ SECURITY`)
      }

      return { data: sections.join('\n') }
    },
  })
}
