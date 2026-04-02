import { describe, test, expect } from 'vitest'
import { runPatternMatching } from '../pattern-matcher'

describe('runPatternMatching', () => {
  describe('critical patterns', () => {
    test('detects eval() usage', () => {
      const files = { 'index.ts': 'eval("malicious code")' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.length).toBeGreaterThan(0)
      expect(criticalFindings[0].message).toContain('eval()')
      expect(criticalFindings[0].file).toBe('index.ts')
      expect(criticalFindings[0].line).toBe(1)
      expect(criticalFindings[0].severity).toBe('critical')
    })

    test('does not flag eval in non-matching text', () => {
      const files = { 'index.ts': 'const evaluate = true' }
      const { criticalFindings } = runPatternMatching(files)
      const evalFindings = criticalFindings.filter(f => f.message.includes('eval()'))
      expect(evalFindings.length).toBe(0)
    })

    test('detects new Function() constructor', () => {
      const files = { 'index.ts': 'const fn = new Function("return 1")' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('Function constructor'))).toBe(true)
    })

    test('detects __proto__ prototype pollution', () => {
      const files = { 'index.ts': 'obj.__proto__.admin = true' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('Prototype pollution'))).toBe(true)
    })

    test('detects dangerouslySetInnerHTML', () => {
      const files = { 'ui.tsx': '<div dangerouslySetInnerHTML={{ __html: userInput }} />' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('XSS'))).toBe(true)
    })

    test('detects window.require()', () => {
      const files = { 'index.ts': 'const fs = window.require("fs")' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('window.require'))).toBe(true)
    })

    test('detects process.env access', () => {
      const files = { 'index.ts': 'const key = process.env.API_KEY' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('process.env'))).toBe(true)
    })

    test('detects hardcoded API key pattern', () => {
      const files = { 'index.ts': 'const apiKey = "supersecret12345"' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('Hardcoded credential'))).toBe(true)
    })

    test('detects AWS access key', () => {
      const files = { 'config.ts': 'const key = "AKIAIOSFODNN7EXAMPLE"' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('AWS Access Key'))).toBe(true)
    })

    test('detects sk- prefixed API key', () => {
      const files = { 'config.ts': 'const openaiKey = "sk-abcdefghijklmnopqrstuvwxyz123456"' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('API Key'))).toBe(true)
    })

    test('detects GitHub PAT', () => {
      const files = { 'config.ts': 'const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890"' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('GitHub'))).toBe(true)
    })

    test('detects private key in source', () => {
      const files = { 'config.ts': '-----BEGIN RSA PRIVATE KEY-----' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('Private key'))).toBe(true)
    })

    test('detects atob/btoa usage', () => {
      const files = { 'index.ts': 'const decoded = atob(payload)' }
      const { criticalFindings } = runPatternMatching(files)
      expect(criticalFindings.some(f => f.message.includes('Base64'))).toBe(true)
    })

    test('skips eval pattern in comment lines for non-credential patterns', () => {
      const files = { 'index.ts': '// eval() is not used here' }
      const { criticalFindings } = runPatternMatching(files)
      const evalFindings = criticalFindings.filter(f => f.message.includes('eval()'))
      expect(evalFindings.length).toBe(0)
    })

    test('still checks credentials in comment lines', () => {
      const files = { 'index.ts': '// token = "supersecret12345"' }
      const { criticalFindings } = runPatternMatching(files)
      const credFindings = criticalFindings.filter(f => f.message.includes('Hardcoded credential'))
      expect(credFindings.length).toBeGreaterThan(0)
    })

    test('includes evidence in findings', () => {
      const files = { 'index.ts': '  eval("bad code")  ' }
      const { criticalFindings } = runPatternMatching(files)
      const evalFinding = criticalFindings.find(f => f.message.includes('eval()'))
      expect(evalFinding?.evidence).toBe('eval("bad code")')
    })
  })

  describe('warning patterns', () => {
    test('detects console.log', () => {
      const files = { 'index.ts': 'console.log("debug info")' }
      const { warnings } = runPatternMatching(files)
      expect(warnings.some(w => w.message.includes('Console output'))).toBe(true)
    })

    test('detects TODO comments', () => {
      const files = { 'index.ts': '// TODO: fix this later' }
      const { warnings } = runPatternMatching(files)
      expect(warnings.some(w => w.message.includes('TODO'))).toBe(true)
    })

    test('detects localStorage usage', () => {
      const files = { 'index.ts': 'localStorage.setItem("key", "val")' }
      const { warnings } = runPatternMatching(files)
      expect(warnings.some(w => w.message.includes('Storage API'))).toBe(true)
    })

    test('detects direct fetch()', () => {
      const files = { 'index.ts': 'const res = fetch("https://api.example.com")' }
      const { warnings } = runPatternMatching(files)
      expect(warnings.some(w => w.message.includes('Direct fetch()'))).toBe(true)
    })

    test('does NOT flag bridge.fetch() as a warning', () => {
      const files = { 'index.ts': 'const data = await bridge.fetch("sourceId")' }
      const { warnings } = runPatternMatching(files)
      // bridge.fetch should not match the raw fetch() pattern
      // Note: the pattern /\bfetch\s*\(/ will match bridge.fetch too, but according to PROMPT.md spec
      // we need to verify the spec carefully - bridge.fetch does contain 'fetch(' so it would be flagged
      // The spec says to NOT flag bridge.fetch, but the regex pattern matches it.
      // This test documents the expected behavior per spec.
      const directFetchWarnings = warnings.filter(w => w.message.includes('Direct fetch()'))
      // bridge.fetch contains 'fetch(' so it will be caught - let's test what the spec says
      // The spec says "Test bridge.fetch() is NOT flagged as direct fetch"
      expect(directFetchWarnings.length).toBe(0)
    })

    test('detects new WebSocket()', () => {
      const files = { 'index.ts': 'const ws = new WebSocket("wss://example.com")' }
      const { warnings } = runPatternMatching(files)
      expect(warnings.some(w => w.message.includes('WebSocket'))).toBe(true)
    })

    test('detects document.cookie access', () => {
      const files = { 'index.ts': 'const cookies = document.cookie' }
      const { warnings } = runPatternMatching(files)
      expect(warnings.some(w => w.message.includes('Cookie access'))).toBe(true)
    })
  })

  describe('multi-file scanning', () => {
    test('scans multiple files and attributes findings correctly', () => {
      const files = {
        'ui.tsx': 'const el = <div dangerouslySetInnerHTML={{ __html: x }} />',
        'logic.ts': 'eval("bad")',
      }
      const { criticalFindings } = runPatternMatching(files)
      const uiFindings = criticalFindings.filter(f => f.file === 'ui.tsx')
      const logicFindings = criticalFindings.filter(f => f.file === 'logic.ts')
      expect(uiFindings.length).toBeGreaterThan(0)
      expect(logicFindings.length).toBeGreaterThan(0)
    })

    test('returns empty findings for clean code', () => {
      const files = {
        'index.ts': 'export function add(a: number, b: number) { return a + b }',
      }
      const { criticalFindings, warnings } = runPatternMatching(files)
      expect(criticalFindings.length).toBe(0)
      expect(warnings.length).toBe(0)
    })
  })
})
