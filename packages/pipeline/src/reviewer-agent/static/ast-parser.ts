import { parse } from '@typescript-eslint/typescript-estree'
import type {
  FileStructure,
  ExportInfo,
  ImportInfo,
  FunctionInfo,
  ClassInfo,
  BridgeCallInfo,
  DOMAccessInfo,
  DynamicExprInfo,
  CodeStructureMap,
} from '../types'
import { detectCircularDeps, findUnusedExports } from './dependency-analyzer'

const DOM_GLOBALS = new Set(['window', 'document', 'globalThis', 'navigator', 'location'])

function walkNode(node: any, visitors: Record<string, (n: any) => void>): void {
  if (!node || typeof node !== 'object') return
  const visitor = visitors[node.type]
  if (visitor) visitor(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const item of child) walkNode(item, visitors)
    } else if (child && typeof child === 'object' && child.type) {
      walkNode(child, visitors)
    }
  }
}

function getLine(node: any): number {
  return node?.loc?.start?.line ?? 0
}

function extractFunctionInfo(node: any, isExported: boolean): FunctionInfo | null {
  const name = node.id?.name ?? node.key?.name
  if (!name) return null
  const params = (node.params ?? []).map((p: any) => p.name ?? p.left?.name ?? p.argument?.name ?? '?')
  const returnType = node.returnType?.typeAnnotation?.type ?? undefined
  const startLine = getLine(node)
  const endLine = node.loc?.end?.line ?? startLine
  return {
    name,
    params,
    returnType,
    line: startLine,
    lineCount: endLine - startLine + 1,
    isAsync: node.async ?? false,
    isExported,
  }
}

function isBridgeCall(node: any): { type: 'fetch' | 'subscribe' | 'getConfig'; args: any[] } | null {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee
  if (callee.type !== 'MemberExpression') return null
  if (callee.object?.name !== 'bridge') return null
  const method = callee.property?.name
  if (method === 'fetch' || method === 'subscribe' || method === 'getConfig') {
    return { type: method, args: node.arguments ?? [] }
  }
  return null
}

function getStaticStringArg(arg: any): string | undefined {
  if (!arg) return undefined
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral' && arg.quasis?.length === 1) return arg.quasis[0].value.raw
  return undefined
}

function getNodeText(node: any, content: string): string {
  if (node?.range) {
    return content.slice(node.range[0], node.range[1])
  }
  return ''
}

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

  walkNode(ast, {
    ImportDeclaration(node: any) {
      const specifiers: string[] = []
      let isDefault = false
      for (const spec of node.specifiers ?? []) {
        if (spec.type === 'ImportDefaultSpecifier') {
          isDefault = true
          specifiers.push(spec.local.name)
        } else if (spec.type === 'ImportSpecifier') {
          specifiers.push(spec.imported.name)
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          specifiers.push(`* as ${spec.local.name}`)
        }
      }
      const imp: ImportInfo = {
        source: node.source.value,
        specifiers,
        isDefault,
        line: getLine(node),
      }
      structure.imports.push(imp)
    },

    ExportNamedDeclaration(node: any) {
      const decl = node.declaration
      if (!decl) {
        // export { foo, bar }
        for (const spec of node.specifiers ?? []) {
          structure.exports.push({
            name: spec.exported.name,
            type: 'variable',
            line: getLine(node),
          })
        }
        return
      }
      if (decl.type === 'FunctionDeclaration') {
        const name = decl.id?.name
        if (name) {
          structure.exports.push({ name, type: 'function', line: getLine(decl) })
          const fn = extractFunctionInfo(decl, true)
          if (fn) structure.functions.push(fn)
        }
      } else if (decl.type === 'ClassDeclaration') {
        const name = decl.id?.name
        if (name) {
          structure.exports.push({ name, type: 'class', line: getLine(decl) })
        }
      } else if (decl.type === 'VariableDeclaration') {
        for (const declarator of decl.declarations ?? []) {
          const name = declarator.id?.name
          if (name) {
            structure.exports.push({ name, type: 'variable', line: getLine(decl) })
          }
        }
      } else if (decl.type === 'TSTypeAliasDeclaration') {
        structure.exports.push({ name: decl.id?.name, type: 'type', line: getLine(decl) })
      } else if (decl.type === 'TSInterfaceDeclaration') {
        structure.exports.push({ name: decl.id?.name, type: 'interface', line: getLine(decl) })
      } else if (decl.type === 'TSEnumDeclaration') {
        structure.exports.push({ name: decl.id?.name, type: 'enum', line: getLine(decl) })
      }
    },

    ExportDefaultDeclaration(node: any) {
      const decl = node.declaration
      const name = decl?.id?.name ?? 'default'
      structure.exports.push({ name, type: 'default', line: getLine(node) })
      if (decl?.type === 'FunctionDeclaration') {
        const fn = extractFunctionInfo(decl, true)
        if (fn) structure.functions.push(fn)
      }
    },

    FunctionDeclaration(node: any) {
      if (!node.id?.name) return
      // Avoid double-adding exported functions
      const alreadyAdded = structure.functions.some(f => f.name === node.id.name && f.line === getLine(node))
      if (!alreadyAdded) {
        const fn = extractFunctionInfo(node, false)
        if (fn) structure.functions.push(fn)
      }
    },

    ClassDeclaration(node: any) {
      if (!node.id?.name) return
      const methods: string[] = []
      for (const member of node.body?.body ?? []) {
        if (member.type === 'MethodDefinition' && member.key?.name) {
          methods.push(member.key.name)
        }
      }
      const isExported = structure.exports.some(e => e.name === node.id.name)
      structure.classes.push({
        name: node.id.name,
        methods,
        line: getLine(node),
        isExported,
      })
    },

    CallExpression(node: any) {
      // Detect eval()
      if (node.callee?.type === 'Identifier' && node.callee.name === 'eval') {
        structure.dynamicExpressions.push({
          type: 'eval',
          file: filename,
          line: getLine(node),
          expression: getNodeText(node, content),
          risk: 'high',
        })
      }

      // Detect bridge calls
      const bridgeCall = isBridgeCall(node)
      if (bridgeCall) {
        const firstArg = bridgeCall.args[0]
        const sourceId = getStaticStringArg(firstArg)
        const isDynamic = !sourceId && !!firstArg
        const info: BridgeCallInfo = {
          type: bridgeCall.type,
          sourceId,
          isDynamic,
          file: filename,
          line: getLine(node),
          expression: getNodeText(node, content),
        }
        structure.bridgeCalls.push(info)
      }
    },

    NewExpression(node: any) {
      // Detect new Function()
      if (node.callee?.type === 'Identifier' && node.callee.name === 'Function') {
        structure.dynamicExpressions.push({
          type: 'Function',
          file: filename,
          line: getLine(node),
          expression: getNodeText(node, content),
          risk: 'high',
        })
      }
    },

    MemberExpression(node: any) {
      // Detect window.*, document.*, globalThis.*, navigator.*, location.*
      const objectName = node.object?.name
      if (objectName && DOM_GLOBALS.has(objectName)) {
        structure.domAccess.push({
          type: objectName as DOMAccessInfo['type'],
          property: node.property?.name,
          file: filename,
          line: getLine(node),
          expression: getNodeText(node, content),
        })
      }
    },
  })

  return structure
}

export function buildCodeStructureMap(files: Record<string, string>): CodeStructureMap {
  const fileStructures: Record<string, FileStructure> = {}
  const dependencyGraph: Record<string, string[]> = {}

  for (const [filename, content] of Object.entries(files)) {
    const structure = parseFileStructure(filename, content)
    fileStructures[filename] = structure
    dependencyGraph[filename] = structure.imports.map(i => i.source)
  }

  const circularDependencies = detectCircularDeps(dependencyGraph)
  const unusedExports = findUnusedExports(fileStructures)

  return { files: fileStructures, dependencyGraph, unusedExports, circularDependencies }
}
