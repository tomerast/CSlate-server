import ts from 'typescript'
import type { TypeCheckResult, TypeCheckError } from '../types'

const BRIDGE_STUB = `
declare const bridge: {
  fetch(sourceId: string, params?: Record<string, unknown>): Promise<unknown>
  subscribe(sourceId: string, callback: (data: unknown) => void): () => void
  getConfig(key: string): string | undefined
}
`

export function runTypeCheck(files: Record<string, string>): TypeCheckResult {
  const sourceFiles = new Map<string, string>()

  for (const [filename, content] of Object.entries(files)) {
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) {
      sourceFiles.set('/' + filename, content)
    }
  }

  if (sourceFiles.size === 0) {
    return { success: true, errors: [] }
  }

  sourceFiles.set('/bridge.d.ts', BRIDGE_STUB)

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
  host.readFile = (f) => sourceFiles.get(f) ?? ts.sys.readFile(f)

  const tsFiles = [...sourceFiles.keys()].filter(f => !f.endsWith('.d.ts'))
  // Include bridge.d.ts as a root file so ambient declarations are available
  const rootFiles = [...tsFiles, '/bridge.d.ts']

  const program = ts.createProgram(
    rootFiles,
    {
      strict: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
    },
    host,
  )

  const allDiagnostics = ts.getPreEmitDiagnostics(program)
  const errors: TypeCheckError[] = []

  allDiagnostics.forEach(diagnostic => {
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      errors.push({
        file: diagnostic.file.fileName.replace(/^\//, ''),
        line: line + 1,
        column: character + 1,
        code: `TS${diagnostic.code}`,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      })
    }
  })

  return { success: errors.length === 0, errors }
}
