import { describe, test, expect } from 'vitest'
import { parseFileStructure, buildCodeStructureMap } from '../ast-parser'

describe('parseFileStructure', () => {
  test('extracts named function export', () => {
    const code = 'export function foo() { return 1 }'
    const structure = parseFileStructure('index.ts', code)
    expect(structure.exports).toContainEqual(
      expect.objectContaining({ name: 'foo', type: 'function' })
    )
  })

  test('extracts default export', () => {
    const code = 'export default function MyComponent() { return null }'
    const structure = parseFileStructure('ui.tsx', code)
    expect(structure.exports.some(e => e.type === 'default')).toBe(true)
  })

  test('extracts import declaration', () => {
    const code = "import React from 'react'"
    const structure = parseFileStructure('ui.tsx', code)
    expect(structure.imports).toContainEqual(
      expect.objectContaining({ source: 'react', isDefault: true })
    )
  })

  test('extracts named imports', () => {
    const code = "import { useState, useEffect } from 'react'"
    const structure = parseFileStructure('ui.tsx', code)
    const reactImport = structure.imports.find(i => i.source === 'react')
    expect(reactImport).toBeDefined()
    expect(reactImport?.specifiers).toContain('useState')
    expect(reactImport?.specifiers).toContain('useEffect')
    expect(reactImport?.isDefault).toBe(false)
  })

  test('extracts function info', () => {
    const code = 'export async function fetchData(url: string, timeout: number) { return fetch(url) }'
    const structure = parseFileStructure('logic.ts', code)
    const fn = structure.functions.find(f => f.name === 'fetchData')
    expect(fn).toBeDefined()
    expect(fn?.isAsync).toBe(true)
    expect(fn?.isExported).toBe(true)
    expect(fn?.params).toContain('url')
  })

  test('extracts class info', () => {
    const code = 'export class MyService { greet() { return "hello" } }'
    const structure = parseFileStructure('service.ts', code)
    const cls = structure.classes.find(c => c.name === 'MyService')
    expect(cls).toBeDefined()
    expect(cls?.isExported).toBe(true)
    expect(cls?.methods).toContain('greet')
  })

  test('detects bridge.fetch() with static source ID', () => {
    const code = 'bridge.fetch("my-source")'
    const structure = parseFileStructure('index.ts', code)
    const call = structure.bridgeCalls.find(c => c.type === 'fetch')
    expect(call).toBeDefined()
    expect(call?.isDynamic).toBe(false)
    expect(call?.sourceId).toBe('my-source')
  })

  test('detects bridge.fetch() with dynamic source ID', () => {
    const code = 'bridge.fetch(dynamicVar)'
    const structure = parseFileStructure('index.ts', code)
    const call = structure.bridgeCalls.find(c => c.type === 'fetch')
    expect(call).toBeDefined()
    expect(call?.isDynamic).toBe(true)
  })

  test('detects bridge.subscribe() call', () => {
    const code = 'bridge.subscribe("my-stream", (data) => console.log(data))'
    const structure = parseFileStructure('index.ts', code)
    const call = structure.bridgeCalls.find(c => c.type === 'subscribe')
    expect(call).toBeDefined()
    expect(call?.sourceId).toBe('my-stream')
  })

  test('detects bridge.getConfig() call', () => {
    const code = 'const val = bridge.getConfig("MY_KEY")'
    const structure = parseFileStructure('index.ts', code)
    const call = structure.bridgeCalls.find(c => c.type === 'getConfig')
    expect(call).toBeDefined()
  })

  test('detects window access', () => {
    const code = 'const h = window.innerHeight'
    const structure = parseFileStructure('index.ts', code)
    const access = structure.domAccess.find(d => d.type === 'window')
    expect(access).toBeDefined()
    expect(access?.property).toBe('innerHeight')
  })

  test('detects document access', () => {
    const code = 'document.getElementById("root")'
    const structure = parseFileStructure('index.ts', code)
    const access = structure.domAccess.find(d => d.type === 'document')
    expect(access).toBeDefined()
  })

  test('detects eval() as dynamic expression', () => {
    const code = 'eval("bad")'
    const structure = parseFileStructure('index.ts', code)
    const expr = structure.dynamicExpressions.find(e => e.type === 'eval')
    expect(expr).toBeDefined()
    expect(expr?.risk).toBe('high')
  })

  test('detects new Function() as dynamic expression', () => {
    const code = 'const fn = new Function("return 1")'
    const structure = parseFileStructure('index.ts', code)
    const expr = structure.dynamicExpressions.find(e => e.type === 'Function')
    expect(expr).toBeDefined()
    expect(expr?.risk).toBe('high')
  })

  test('returns empty structure on parse error', () => {
    const code = '{{{{ invalid syntax'
    const structure = parseFileStructure('broken.ts', code)
    expect(structure.exports).toEqual([])
    expect(structure.imports).toEqual([])
    expect(structure.functions).toEqual([])
  })

  test('includes line numbers in exports', () => {
    const code = '\n\nexport function foo() {}'
    const structure = parseFileStructure('index.ts', code)
    const exp = structure.exports.find(e => e.name === 'foo')
    expect(exp?.line).toBe(3)
  })
})

describe('buildCodeStructureMap', () => {
  test('builds structure map from multiple files', () => {
    const files = {
      'index.ts': "import { helper } from './helper'\nexport function main() {}",
      'helper.ts': 'export function helper() {}',
    }
    const map = buildCodeStructureMap(files)
    expect(map.files['index.ts']).toBeDefined()
    expect(map.files['helper.ts']).toBeDefined()
  })

  test('builds dependency graph from imports', () => {
    const files = {
      'index.ts': "import { helper } from './helper'",
      'helper.ts': 'export function helper() {}',
    }
    const map = buildCodeStructureMap(files)
    expect(map.dependencyGraph['index.ts']).toContain('./helper')
  })

  test('detects circular dependencies', () => {
    const files = {
      'a.ts': "import { b } from './b'",
      'b.ts': "import { a } from './a'",
    }
    const map = buildCodeStructureMap(files)
    expect(map.circularDependencies.length).toBeGreaterThan(0)
  })

  test('reports no circular dependencies for clean graph', () => {
    const files = {
      'index.ts': "import { helper } from './helper'",
      'helper.ts': 'export function add(a: number, b: number) { return a + b }',
    }
    const map = buildCodeStructureMap(files)
    expect(map.circularDependencies.length).toBe(0)
  })

  test('finds unused exports', () => {
    const files = {
      'index.ts': "import { usedFn } from './utils'",
      'utils.ts': 'export function usedFn() {} export function unusedFn() {}',
    }
    const map = buildCodeStructureMap(files)
    const unused = map.unusedExports.find(u => u.name === 'unusedFn')
    expect(unused).toBeDefined()
    expect(unused?.file).toBe('utils.ts')
  })
})
