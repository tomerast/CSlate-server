import type { ComponentManifest } from '../../types'
import type { StaticAnalysisResult, StaticFinding } from '../types'
import { runPatternMatching } from './pattern-matcher'
import { buildCodeStructureMap } from './ast-parser'
import { runTypeCheck } from './type-checker'

// TS error codes that indicate real type safety failures (dimension 6 — types/interfaces)
const CRITICAL_TS_CODES = new Set(['TS2345', 'TS2322', 'TS2339', 'TS2554', 'TS2551', 'TS2304'])

export async function runStaticAnalysis(
  files: Record<string, string>,
  manifest: ComponentManifest,
): Promise<StaticAnalysisResult> {
  const startTime = Date.now()

  // Phase 1: Pattern matching (fast, no AST)
  const { criticalFindings, warnings } = runPatternMatching(files)

  // Phase 2: AST parsing and code structure
  const codeStructure = buildCodeStructureMap(files)

  // Phase 3: Type checking
  const typeCheckResult = runTypeCheck(files)

  // Promote critical TS errors to static critical findings
  const tsFindings: StaticFinding[] = typeCheckResult.errors
    .filter(e => CRITICAL_TS_CODES.has(e.code))
    .map(e => ({
      analyzer: 'typescript',
      dimension: 6,
      severity: 'critical' as const,
      file: e.file,
      line: e.line,
      pattern: e.code,
      message: e.message,
      evidence: e.message,
    }))

  // TS warning-level errors (not in critical set) → warnings
  const tsWarnings: StaticFinding[] = typeCheckResult.errors
    .filter(e => !CRITICAL_TS_CODES.has(e.code))
    .map(e => ({
      analyzer: 'typescript',
      dimension: 6,
      severity: 'warning' as const,
      file: e.file,
      line: e.line,
      pattern: e.code,
      message: e.message,
      evidence: e.message,
    }))

  return {
    criticalFindings: [...criticalFindings, ...tsFindings],
    warnings: [...warnings, ...tsWarnings],
    codeStructure,
    typeCheckResult,
    duration: Date.now() - startTime,
  }
}
