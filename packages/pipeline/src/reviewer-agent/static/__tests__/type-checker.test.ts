import { describe, test, expect } from 'vitest'
import { runTypeCheck } from '../type-checker'

describe('runTypeCheck', () => {
  test('returns success for valid TypeScript', () => {
    const files = {
      'index.ts': 'const x: number = 42\nexport { x }',
    }
    const result = runTypeCheck(files)
    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('detects type assignment error TS2322', () => {
    const files = {
      'index.ts': 'const x: string = 42',
    }
    const result = runTypeCheck(files)
    expect(result.success).toBe(false)
    const ts2322 = result.errors.find(e => e.code === 'TS2322')
    expect(ts2322).toBeDefined()
    expect(ts2322?.line).toBe(1)
  })

  test('detects argument type mismatch TS2345', () => {
    const files = {
      'index.ts': `
function greet(name: string) { return "hello " + name }
greet(42)
`,
    }
    const result = runTypeCheck(files)
    expect(result.success).toBe(false)
    expect(result.errors.some(e => e.code === 'TS2345')).toBe(true)
  })

  test('only checks .ts and .tsx files', () => {
    const files = {
      'index.ts': 'const x: string = 42',
      'readme.md': 'This is not TypeScript',
      'styles.css': '.foo { color: red }',
    }
    const result = runTypeCheck(files)
    // Should find the error in index.ts, not crash on non-TS files
    expect(result.errors.some(e => e.file.includes('index.ts'))).toBe(true)
  })

  test('returns errors with file, line, column, code, message', () => {
    const files = {
      'index.ts': 'const x: string = 42',
    }
    const result = runTypeCheck(files)
    expect(result.errors[0]).toMatchObject({
      file: expect.stringContaining('index.ts'),
      line: expect.any(Number),
      column: expect.any(Number),
      code: expect.stringMatching(/^TS\d+$/),
      message: expect.any(String),
    })
  })

  test('does not error when bridge is referenced', () => {
    const files = {
      'index.ts': `
const data = bridge.fetch("my-source")
`,
    }
    const result = runTypeCheck(files)
    // bridge is declared via d.ts stub, so no "cannot find name" error for bridge
    const bridgeErrors = result.errors.filter(e => e.message.includes("Cannot find name 'bridge'"))
    expect(bridgeErrors.length).toBe(0)
  })

  test('handles empty files object', () => {
    const result = runTypeCheck({})
    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('handles tsx files with JSX', () => {
    const files = {
      'ui.tsx': `
import React from 'react'
export function MyComp(): React.ReactElement {
  return <div>Hello</div>
}
`,
    }
    // May have errors due to missing React types but should not crash
    const result = runTypeCheck(files)
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('errors')
  })
})
