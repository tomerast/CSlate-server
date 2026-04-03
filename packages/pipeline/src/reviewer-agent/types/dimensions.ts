// ─── Dimensions ──────────────────────────────────────────────────────────────

export type DimensionTier = 'security' | 'quality' | 'standards'

export interface DimensionConfig {
  id: number
  name: string
  tier: DimensionTier
  description: string
  checklist: string[]
  severityThresholds: {
    critical: string[]
    warning: string[]
  }
}

export const DIMENSIONS: DimensionConfig[] = [
  {
    id: 1,
    name: 'Malicious Intent Detection',
    tier: 'security',
    description: 'Obfuscation, hidden network calls, data exfiltration, intent mismatch',
    checklist: [
      'Obfuscated code (string concat to build API names, encoded payloads, atob/btoa)',
      'Hidden network calls (indirect fetch construction, WebSocket via string building)',
      'Data exfiltration channels (encoding data in URL params, CSS custom props, error messages)',
      'Suspicious control flow (setTimeout chains, recursive patterns hiding intent)',
      'Environment-conditional behavior (runtime sniffing)',
      'Intent mismatch: code does something other than what manifest claims',
    ],
    severityThresholds: {
      critical: ['Any obfuscated code pattern', 'Any hidden network call', 'Any data exfiltration channel'],
      warning: ['Unusual control flow patterns', 'Complex string operations near API calls'],
    },
  },
  {
    id: 2,
    name: 'Injection & Sandbox Escape',
    tier: 'security',
    description: 'Prompt injection, XSS, prototype pollution, bridge abuse, sandbox escape',
    checklist: [
      'Prompt injection in context.md, description, or string literals',
      'XSS vectors (dangerouslySetInnerHTML, unescaped user data)',
      'Prototype pollution (__proto__, constructor.prototype)',
      'Bridge API abuse (dynamic source IDs in bridge.fetch)',
      'window/document/globalThis access beyond sandbox allowance',
      'eval(), new Function(), Function.prototype.constructor — even indirect',
    ],
    severityThresholds: {
      critical: ['Any eval/Function usage', 'Any prototype pollution', 'Any sandbox escape attempt'],
      warning: ['Prompt-like patterns in metadata', 'Dynamic property access on globals'],
    },
  },
  {
    id: 3,
    name: 'Credential & Data Hygiene',
    tier: 'security',
    description: 'Hardcoded secrets, PII, improper getConfig/getSecret usage',
    checklist: [
      'Hardcoded API keys, tokens, passwords (even in comments/test data)',
      'PII in code or default configs',
      'Secrets that should use bridge.getConfig() but dont',
      'Sensitive data logged to console',
      'Data retained in module-level variables (persists across renders)',
    ],
    severityThresholds: {
      critical: ['Any hardcoded credential', 'Any PII exposure'],
      warning: ['Console logging of potentially sensitive data', 'Module-level data persistence'],
    },
  },
  {
    id: 4,
    name: 'Architecture & SOLID',
    tier: 'quality',
    description: 'UI/logic separation, SRP, dependency direction, modularization',
    checklist: [
      'UI/Logic separation (business logic in logic.ts, not ui.tsx)',
      'Single responsibility per file',
      'Clean dependency direction (types <- logic <- ui)',
      'No god-functions (functions > 50 lines)',
      'Proper React patterns (hooks, composition over inheritance)',
    ],
    severityThresholds: {
      critical: ['Business logic in ui.tsx with no logic.ts'],
      warning: ['Functions over 50 lines', 'Circular dependencies between files'],
    },
  },
  {
    id: 5,
    name: 'Functionality & Correctness',
    tier: 'quality',
    description: 'Logic bugs, null handling, race conditions, edge cases',
    checklist: [
      'Does code achieve what manifest claims?',
      'Null/undefined handling on all data paths',
      'Error handling in bridge.fetch callbacks',
      'Race conditions in async operations',
      'Edge cases: empty data, missing fields, unexpected types',
    ],
    severityThresholds: {
      critical: ['Unhandled promise rejections', 'Data corruption paths'],
      warning: ['Missing null checks on optional data', 'No error handling on bridge calls'],
    },
  },
  {
    id: 6,
    name: 'Type Safety & Contracts',
    tier: 'quality',
    description: 'TypeScript strictness, manifest/code interface match',
    checklist: [
      'No untyped any (unless justified)',
      'Manifest inputs/outputs/events/actions match TypeScript interfaces',
      'Proper generic usage (no Record<string, any>)',
      'Type assertions (as) justified and safe',
    ],
    severityThresholds: {
      critical: ['Manifest declares outputs that code never produces'],
      warning: ['Untyped any usage', 'Unnecessary type assertions'],
    },
  },
  {
    id: 7,
    name: 'Performance & Resource',
    tier: 'quality',
    description: 'Memory leaks, unbounded loops, re-renders, missing cleanup',
    checklist: [
      'Memory leaks (subscriptions not cleaned up, intervals not cleared)',
      'Unbounded loops or recursion',
      'Excessive re-renders (missing useMemo/useCallback where needed)',
      'Missing cleanup in useEffect return functions',
    ],
    severityThresholds: {
      critical: ['Unbounded loops', 'Memory leaks from uncleaned subscriptions'],
      warning: ['Missing useEffect cleanup', 'Large object copies in hot paths'],
    },
  },
  {
    id: 8,
    name: 'Readability & Style',
    tier: 'standards',
    description: 'Naming conventions, dead code, console.logs, file size',
    checklist: [
      'Consistent naming conventions (camelCase functions, PascalCase components)',
      'No dead code, commented-out blocks, TODO/FIXME',
      'No console.log / console.debug',
      'Reasonable file sizes (no single file > 500 lines)',
    ],
    severityThresholds: {
      critical: [],
      warning: ['Console.log statements', 'Dead code blocks', 'Files over 500 lines'],
    },
  },
  {
    id: 9,
    name: 'Accessibility & UX',
    tier: 'standards',
    description: 'Semantic HTML, ARIA, keyboard nav, design tokens',
    checklist: [
      'Semantic HTML elements (not div-for-everything)',
      'ARIA labels on interactive elements',
      'Keyboard navigation support',
      'Design tokens used (not raw colors)',
    ],
    severityThresholds: {
      critical: [],
      warning: ['No ARIA labels on buttons/inputs', 'Only div elements used', 'Raw color values'],
    },
  },
  {
    id: 10,
    name: 'Manifest & Documentation',
    tier: 'standards',
    description: 'context.md accuracy, tag relevance, data source declarations',
    checklist: [
      'context.md accurately describes actual behavior',
      'Manifest description matches code behavior',
      'All data sources in manifest actually used (and vice versa)',
      'Tags are relevant and not gaming search',
      'ai.modificationHints and ai.extensionPoints are accurate',
    ],
    severityThresholds: {
      critical: ['Manifest declares data sources not used in code'],
      warning: ['context.md is vague or generic', 'Tags dont match functionality'],
    },
  },
]
