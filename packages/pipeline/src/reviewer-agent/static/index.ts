import type { StaticAnalysisResult } from '../types'
import { buildCodeStructureMap } from './ast-parser'
import { runPatternMatching } from './pattern-matcher'
import { runTypeCheck } from './type-checker'

export async function runStaticAnalysis(
  files: Record<string, string>,
  manifest: Record<string, unknown>,
): Promise<StaticAnalysisResult> {
  const startTime = Date.now()

  const [codeStructure, { criticalFindings, warnings }, typeCheckResult] = await Promise.all([
    Promise.resolve(buildCodeStructureMap(files)),
    Promise.resolve(runPatternMatching(files)),
    Promise.resolve(runTypeCheck(files)),
  ])

  // Promote certain TypeScript errors to critical findings
  for (const error of typeCheckResult.errors) {
    if (['TS2345', 'TS2322', 'TS2551'].includes(error.code)) {
      criticalFindings.push({
        analyzer: 'typescript',
        dimension: 6,
        severity: 'critical',
        file: error.file,
        line: error.line,
        pattern: error.code,
        message: error.message,
        evidence: `TypeScript error ${error.code} at ${error.file}:${error.line}:${error.column}`,
      })
    }
  }

  return { criticalFindings, warnings, codeStructure, typeCheckResult, duration: Date.now() - startTime }
}
