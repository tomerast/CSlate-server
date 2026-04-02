import { describe, test, expect } from 'vitest'
import { runStaticAnalysis } from '../index'

describe('runStaticAnalysis', () => {
  test('detects eval() as critical finding', async () => {
    const files = {
      'index.ts': 'eval("malicious")',
    }
    const result = await runStaticAnalysis(files, {})
    expect(result.criticalFindings.length).toBeGreaterThan(0)
    expect(result.criticalFindings.some(f => f.message.includes('eval()'))).toBe(true)
  })

  test('returns complete StaticAnalysisResult shape', async () => {
    const files = {
      'index.ts': 'export function add(a: number, b: number) { return a + b }',
    }
    const result = await runStaticAnalysis(files, {})
    expect(result).toHaveProperty('criticalFindings')
    expect(result).toHaveProperty('warnings')
    expect(result).toHaveProperty('codeStructure')
    expect(result).toHaveProperty('typeCheckResult')
    expect(result).toHaveProperty('duration')
    expect(typeof result.duration).toBe('number')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  test('promotes TS2345 type errors to critical findings', async () => {
    const files = {
      'index.ts': `
function greet(name: string) { return "hello " + name }
greet(42)
`,
    }
    const result = await runStaticAnalysis(files, {})
    const ts2345 = result.criticalFindings.find(f => f.pattern === 'TS2345')
    expect(ts2345).toBeDefined()
    expect(ts2345?.severity).toBe('critical')
    expect(ts2345?.dimension).toBe(6)
    expect(ts2345?.analyzer).toBe('typescript')
  })

  test('promotes TS2322 type errors to critical findings', async () => {
    const files = {
      'index.ts': 'const x: string = 42',
    }
    const result = await runStaticAnalysis(files, {})
    const ts2322 = result.criticalFindings.find(f => f.pattern === 'TS2322')
    expect(ts2322).toBeDefined()
  })

  test('completes 5 typical files in under 5 seconds', async () => {
    const componentCode = `
import React, { useState, useEffect } from 'react'

interface DataItem {
  id: number
  name: string
  value: number
}

export function DataTable({ title }: { title: string }) {
  const [data, setData] = useState<DataItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = bridge.subscribe('data-source', (incoming: unknown) => {
      setData(incoming as DataItem[])
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  if (loading) return <div>Loading...</div>
  return (
    <table>
      <caption>{title}</caption>
      <tbody>
        {data.map(item => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
`
    const files: Record<string, string> = {}
    for (let i = 0; i < 5; i++) {
      files[`component${i}.tsx`] = componentCode
    }

    const start = Date.now()
    const result = await runStaticAnalysis(files, {})
    const duration = Date.now() - start

    expect(duration).toBeLessThan(5000)
    expect(result.duration).toBeLessThan(5000)
  }, 10000)

  test('returns codeStructure with file entries', async () => {
    const files = {
      'index.ts': 'export function main() {}',
    }
    const result = await runStaticAnalysis(files, {})
    expect(result.codeStructure.files['index.ts']).toBeDefined()
  })

  test('returns no critical findings for clean component', async () => {
    const files = {
      'index.ts': `
export function add(a: number, b: number): number {
  return a + b
}
`,
    }
    const result = await runStaticAnalysis(files, {})
    expect(result.criticalFindings.length).toBe(0)
  })
})
