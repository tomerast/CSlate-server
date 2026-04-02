import type { StaticFinding } from '../types'

interface PatternDef {
  pattern: RegExp
  message: string
  dimension: number
  severity: 'critical' | 'warning' | 'info'
  analyzer: string
}

const CRITICAL_PATTERNS: PatternDef[] = [
  { pattern: /\beval\s*\(/, message: 'eval() — dynamic code execution', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /new\s+Function\s*\(/, message: 'Function constructor — dynamic code execution', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /\.__proto__/, message: 'Prototype pollution via __proto__', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /constructor\.prototype/, message: 'Prototype pollution via constructor.prototype', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /dangerouslySetInnerHTML/, message: 'XSS risk: dangerouslySetInnerHTML', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /window\.require\s*\(/, message: 'window.require — Node.js access attempt', dimension: 2, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /\bprocess\.env\b/, message: 'process.env access — blocked in sandbox', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /(?:password|secret|api[_-]?key|token|auth)\s*[=:]\s*["'][^"']{8,}["']/i, message: 'Hardcoded credential', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /AKIA[0-9A-Z]{16}/, message: 'AWS Access Key', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /sk-[a-zA-Z0-9]{32,}/, message: 'API Key (sk- prefix)', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, message: 'GitHub Personal Access Token', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /-----BEGIN.*PRIVATE KEY-----/, message: 'Private key in source', dimension: 3, severity: 'critical', analyzer: 'pattern-matcher' },
  { pattern: /\batob\s*\(|btoa\s*\(/, message: 'Base64 encoding — potential obfuscation', dimension: 1, severity: 'critical', analyzer: 'pattern-matcher' },
]

const WARNING_PATTERNS: PatternDef[] = [
  { pattern: /console\.(log|debug|info)\s*\(/, message: 'Console output in component', dimension: 8, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /\/\/\s*(TODO|FIXME|HACK|XXX)/, message: 'Unresolved TODO/FIXME comment', dimension: 8, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /localStorage\.|sessionStorage\./, message: 'Storage API — blocked in sandbox', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /document\.cookie/, message: 'Cookie access — blocked in sandbox', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /(?<!bridge\.)\bfetch\s*\(/, message: 'Direct fetch() — use bridge.fetch() instead', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
  { pattern: /new\s+WebSocket\s*\(/, message: 'WebSocket — use bridge.subscribe() instead', dimension: 2, severity: 'warning', analyzer: 'pattern-matcher' },
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
