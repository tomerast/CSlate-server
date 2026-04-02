import type { FileStructure } from '../types'

export function detectCircularDeps(graph: Record<string, string[]>): string[][] {
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycles: string[][] = []

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      cycles.push(path.slice(cycleStart))
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    inStack.add(node)
    for (const dep of graph[node] ?? []) {
      const resolved = Object.keys(graph).find(
        k => k === dep || k.replace(/\.[^.]+$/, '') === dep || dep.endsWith(k.replace(/\.[^.]+$/, ''))
      )
      if (resolved) dfs(resolved, [...path, node])
    }
    inStack.delete(node)
  }

  for (const node of Object.keys(graph)) {
    dfs(node, [])
  }

  return cycles
}

export function findUnusedExports(fileStructures: Record<string, FileStructure>): { file: string; name: string }[] {
  const importedNames = new Set<string>()
  for (const structure of Object.values(fileStructures)) {
    for (const imp of structure.imports) {
      for (const spec of imp.specifiers) {
        importedNames.add(spec)
      }
    }
  }

  const unused: { file: string; name: string }[] = []
  for (const [file, structure] of Object.entries(fileStructures)) {
    for (const exp of structure.exports) {
      if (exp.type === 'default') continue
      if (!importedNames.has(exp.name)) {
        unused.push({ file, name: exp.name })
      }
    }
  }
  return unused
}
