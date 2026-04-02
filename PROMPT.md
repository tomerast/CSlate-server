# Ralph Loop: Phase 1 — Static Analysis

## Mission

Build the deterministic static analysis phase for the CSlate reviewer agent. This runs BEFORE any LLM calls. It uses TypeScript AST parsing, regex pattern matching, and type checking to surface obvious issues cheaply. Critical findings here short-circuit the entire pipeline — no LLM spend needed.

## Scope

Build everything in `packages/pipeline/src/reviewer-agent/static/`.

## Key Files

**Create:**
- `packages/pipeline/src/reviewer-agent/static/index.ts` — `runStaticAnalysis()` entry point
- `packages/pipeline/src/reviewer-agent/static/ast-parser.ts` — AST-based code structure extraction
- `packages/pipeline/src/reviewer-agent/static/pattern-matcher.ts` — Regex security pattern matching
- `packages/pipeline/src/reviewer-agent/static/type-checker.ts` — TypeScript compiler API type checking
- `packages/pipeline/src/reviewer-agent/static/dependency-analyzer.ts` — Import graph + circular dep detection
- Tests in `packages/pipeline/src/reviewer-agent/static/__tests__/`

**Read for reference (do NOT modify):**
- `packages/pipeline/src/reviewer-agent/types.ts` — ALL shared types (StaticAnalysisResult, StaticFinding, CodeStructureMap, FileStructure, BridgeCallInfo, etc.)
- `packages/pipeline/src/stages/2-security-scan.ts` — Existing security patterns to migrate
- `packages/pipeline/src/stages/4-quality-review.ts` — Existing quality checks to reference
- `packages/pipeline/src/stages/5-test-render.ts` — Existing tsc wrapper to reference

## First Step: Install Dependencies

```bash
pnpm add @typescript-eslint/typescript-estree --filter @cslate/pipeline
pnpm install
```

## Interface Contract

```typescript
// packages/pipeline/src/reviewer-agent/static/index.ts
import { StaticAnalysisResult } from '../types'

export async function runStaticAnalysis(
  files: Record<string, string>,   // filename → file content
  manifest: Record<string, unknown>,
): Promise<StaticAnalysisResult>
```

## Implementation: ast-parser.ts

Use `@typescript-eslint/typescript-estree` to parse files and extract `FileStructure`:

```typescript
import { parse } from '@typescript-eslint/typescript-estree'
import type { FileStructure, ExportInfo, ImportInfo, FunctionInfo, BridgeCallInfo, DOMAccessInfo, DynamicExprInfo, CodeStructureMap } from '../types'

export function parseFileStructure(filename: string, content: string): FileStructure {
  let ast: any
  try {
    ast = parse(content, { jsx: true, tolerant: true, range: true, loc: true })
  } catch {
    return { exports: [], imports: [], functions: [], classes: [], bridgeCalls: [], domAccess: [], dynamicExpressions: [] }
  }

  const structure: FileStructure = {
    exports: [],
    imports: [],
    functions: [],
    classes: [],
    bridgeCalls: [],
    domAccess: [],
    dynamicExpressions: [],
  }

  // Walk AST to extract: ImportDeclaration, ExportNamedDeclaration, ExportDefaultDeclaration,
  // FunctionDeclaration, ClassDeclaration, CallExpression (for bridge.* calls),
  // MemberExpression (for window.*, document.*, globalThis.*),
  // CallExpression (for eval(), new Function())
  // ...

  return structure
}

export function buildCodeStructureMap(files: Record<string, string>): CodeStructureMap {
  const fileStructures: Record<string, FileStructure> = {}
  const dependencyGraph: Record<string, string[]> = {}

  for (const [filename, content] of Object.entries(files)) {
    const structure = parseFileStructure(filename, content)
    fileStructures[filename] = structure
    // Build dep graph from imports
    dependencyGraph[filename] = structure.imports.map(i => i.source)
  }

  // Detect circular dependencies via DFS
  const circularDependencies = detectCircularDeps(dependencyGraph)

  // Find exports not imported anywhere
  const unusedExports = findUnusedExports(fileStructures)

  return { files: fileStructures, dependencyGraph, unusedExports, circularDependencies }
}
```

## Implementation: pattern-matcher.ts

```typescript
import type { StaticFinding } from '../types'

interface PatternDef {
  pattern: RegExp
  message: string
  dimension: number
  severity: 'critical' | 'warning' | 'info'
  analyzer: string
}

const CRITICAL_PATTERNS: PatternDef[] = [
  { pattern: /\beval\s*\(/,                    message: 'eval() — dynamic code execution', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /new\s+Function\s*\(/,             message: 'Function constructor — dynamic code execution', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /\.__proto__/,                     message: 'Prototype pollution via __proto__', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /constructor\.prototype/,          message: 'Prototype pollution via constructor.prototype', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /dangerouslySetInnerHTML/,          message: 'XSS risk: dangerouslySetInnerHTML', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /window\.require\s*\(/,            message: 'window.require — Node.js access attempt', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /\bprocess\.env\b/,               message: 'process.env access — blocked in sandbox', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /(?:password|secret|api[_-]?key|token|auth)\s*[=:]\s*["'][^"']{8,}["']/i, message: 'Hardcoded credential', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /AKIA[0-9A-Z]{16}/,               message: 'AWS Access Key', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /sk-[a-zA-Z0-9]{32,}/,            message: 'API Key (sk- prefix)', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/,            message: 'GitHub Personal Access Token', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /-----BEGIN.*PRIVATE KEY-----/,    message: 'Private key in source', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /\batob\s*\(|btoa\s*\(/,          message: 'Base64 encoding — potential obfuscation', dimension: 1, severity: 'critical', analyzer: 'pattern-matcher' },
]

const WARNING_PATTERNS: PatternDef[] = [
  { pattern: /console\.(log|debug|info)\s*\(/, message: 'Console output in component', dimension: 8, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /\/\/\s*(TODO|FIXME|HACK|XXX)/,   message: 'Unresolved TODO/FIXME comment', dimension: 8, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /localStorage\.|sessionStorage\./, message: 'Storage API — blocked in sandbox', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /document\.cookie/,               message: 'Cookie access — blocked in sandbox', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /\bfetch\s*\(/,                   message: 'Direct fetch() — use bridge.fetch() instead', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /new\s+WebSocket\s*\(/,           message: 'WebSocket — use bridge.subscribe() instead', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
]

export function runPatternMatching(files: Record<string, string>): {
  criticalFindings: StaticFinding[]
  warnings: StaticFinding[]
} {
  const criticalFindings: StaticFinding[] = []
  const warnings: StaticFinding[] = []

  for (const [filename, content] of Object.entries(files)) {
    const lines = content.split('\n')
    lines.forEach((line, idx) => {
      const lineNumber = idx + 1
      // Skip comment lines for some patterns
      const isComment = line.trim().startsWith('//')

      for (const def of CRITICAL_PATTERNS) {
        if (isComment && def.dimension !== 3) continue  // Still check credentials in comments
        if (def.pattern.test(line)) {
          criticalFindings.push({
            analyzer: def.analyzer,
            dimension: def.dimension,
            severity: def.severity,
            file: filename,
            line: lineNumber,
            pattern: def.pattern.toString(),
            message: def.message,
            evidence: line.trim(),
          })
        }
      }

      for (const def of WARNING_PATTERNS) {
        if (def.pattern.test(line)) {
          warnings.push({
            analyzer: def.analyzer,
            dimension: def.dimension,
            severity: def.severity,
            file: filename,
            line: lineNumber,
            pattern: def.pattern.toString(),
            message: def.message,
            evidence: line.trim(),
          })
        }
      }
    })
  }

  return { criticalFindings, warnings }
}
```

## Implementation: type-checker.ts

```typescript
import ts from 'typescript'
import type { TypeCheckResult, TypeCheckError } from '../types'

export function runTypeCheck(files: Record<string, string>): TypeCheckResult {
  // Create in-memory source files
  const sourceFiles = new Map<string, string>()
  for (const [filename, content] of Object.entries(files)) {
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) {
      sourceFiles.set('/' + filename, content)
    }
  }

  // Add bridge type stub so bridge.fetch etc. don't cause "not defined" errors
  sourceFiles.set('/bridge.d.ts', `
    declare const bridge: {
      fetch(sourceId: string, params?: Record<string, unknown>): Promise<unknown>
      subscribe(sourceId: string, callback: (data: unknown) => void): () => void
      getConfig(key: string): string | undefined
    }
  `)

  const host = ts.createCompilerHost({})
  const origGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion) => {
    const content = sourceFiles.get(fileName)
    if (content !== undefined) {
      return ts.createSourceFile(fileName, content, languageVersion, true)
    }
    return origGetSourceFile(fileName, languageVersion)
  }
  host.fileExists = (f) => sourceFiles.has(f) || ts.sys.fileExists(f)

  const program = ts.createProgram(
    [...sourceFiles.keys()].filter(f => !f.endsWith('.d.ts')),
    { strict: true, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true },
    host,
  )

  const allDiagnostics = ts.getPreEmitDiagnostics(program)
  const errors: TypeCheckError[] = []

  allDiagnostics.forEach(diagnostic => {
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      errors.push({
        file: diagnostic.file.fileName.replace('/', ''),
        line: line + 1,
        column: character + 1,
        code: `TS${diagnostic.code}`,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      })
    }
  })

  return { success: errors.length === 0, errors }
}
```

## Implementation: index.ts

```typescript
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
```

## TDD Approach

1. **pattern-matcher.test.ts**: 
   - Test each critical pattern with matching code → verify finding produced
   - Test non-matching code → verify no finding
   - Test bridge.fetch() is NOT flagged as direct fetch

2. **ast-parser.test.ts**:
   - Test with `export function foo() {}` → exports contains foo
   - Test with `bridge.fetch('sourceId')` → bridgeCalls contains it with isDynamic: false
   - Test with `bridge.fetch(dynamicVar)` → bridgeCalls contains it with isDynamic: true

3. **type-checker.test.ts**:
   - Test with valid TypeScript → success: true, errors: []
   - Test with `const x: string = 42` → error TS2322 detected

4. **index.test.ts**:
   - Integration: run against mock component with eval() → criticalFindings.length > 0
   - Performance: 5 typical files complete in < 5 seconds

Test command: `npx vitest run packages/pipeline/src/reviewer-agent/static/__tests__/ --reporter verbose`

## When You're Done

`runStaticAnalysis` returns complete `StaticAnalysisResult`, critical patterns detected, TypeScript errors surfaced, tests pass.

<promise>STATIC ANALYSIS COMPLETE</promise>
