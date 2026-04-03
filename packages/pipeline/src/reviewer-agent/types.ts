/**
 * Reviewer Agent — Shared Type Contracts
 *
 * ALL worktrees build against these interfaces. Do NOT modify without
 * coordinating across all branches.
 *
 * Design spec: docs/superpowers/specs/2026-04-02-reviewer-agent-design.md
 */

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

// ─── Phase 1: Static Analysis ────────────────────────────────────────────────

export interface StaticFinding {
  analyzer: string
  dimension: number
  severity: 'critical' | 'warning' | 'info'
  file: string
  line?: number
  pattern?: string
  message: string
  evidence: string
}

export interface ExportInfo {
  name: string
  type: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'default'
  line: number
}

export interface ImportInfo {
  source: string
  specifiers: string[]
  isDefault: boolean
  line: number
}

export interface FunctionInfo {
  name: string
  params: string[]
  returnType?: string
  line: number
  lineCount: number
  isAsync: boolean
  isExported: boolean
}

export interface ClassInfo {
  name: string
  methods: string[]
  line: number
  isExported: boolean
}

export interface BridgeCallInfo {
  type: 'fetch' | 'subscribe' | 'getConfig'
  sourceId?: string           // static source ID if determinable
  isDynamic: boolean          // true if source ID is computed at runtime
  file: string
  line: number
  expression: string          // the full call expression
}

export interface DOMAccessInfo {
  type: 'window' | 'document' | 'globalThis' | 'navigator' | 'location'
  property?: string
  file: string
  line: number
  expression: string
}

export interface DynamicExprInfo {
  type: 'eval' | 'Function' | 'template-in-sensitive-pos' | 'computed-property'
  file: string
  line: number
  expression: string
  risk: 'high' | 'medium' | 'low'
}

export interface FileStructure {
  exports: ExportInfo[]
  imports: ImportInfo[]
  functions: FunctionInfo[]
  classes: ClassInfo[]
  bridgeCalls: BridgeCallInfo[]
  domAccess: DOMAccessInfo[]
  dynamicExpressions: DynamicExprInfo[]
}

export interface CodeStructureMap {
  files: Record<string, FileStructure>
  dependencyGraph: Record<string, string[]>
  unusedExports: { file: string; name: string }[]
  circularDependencies: string[][]
}

export interface TypeCheckResult {
  success: boolean
  errors: TypeCheckError[]
}

export interface TypeCheckError {
  file: string
  line: number
  column: number
  code: string      // e.g., "TS2345"
  message: string
}

export interface StaticAnalysisResult {
  criticalFindings: StaticFinding[]
  warnings: StaticFinding[]
  codeStructure: CodeStructureMap
  typeCheckResult: TypeCheckResult
  duration: number
}

// ─── Phase 2: Expert Agents ──────────────────────────────────────────────────

export interface ExpertAgentConfig {
  name: string
  dimensions: DimensionConfig[]
  model: string
  systemPrompt: string
  maxIterations: number
  shortCircuitOnCritical: boolean
}

export interface ExpertFinding {
  dimension: number
  severity: 'critical' | 'warning' | 'info'
  confidence: number            // 0-100
  title: string
  description: string
  file: string
  line?: number
  evidence: string
  reasoning: string
  verifiedByTool: boolean
  toolVerification?: string
}

export interface DimensionScore {
  dimension: number
  name: string
  tier: DimensionTier
  verdict: 'pass' | 'fail' | 'warning'
  confidence: number
  weight: number
  weightedScore: number
  summary: string
  findings: {
    critical: number
    warning: number
    info: number
  }
}

export interface ExpertAgentResult {
  agent: string
  dimensions: DimensionScore[]
  findings: ExpertFinding[]
  iterationsUsed: number
  tokenCost: { input: number; output: number }
}

// ─── Agent Tool Definitions ──────────────────────────────────────────────────

export interface AgentToolDefinition {
  name: string
  description: string
  parameters: Record<string, {
    type: string
    description: string
    required?: boolean
    enum?: string[]
  }>
  isReadOnly: boolean
}

export interface AgentToolCall {
  tool: string
  params: Record<string, unknown>
}

export interface AgentToolResult {
  tool: string
  result: string
  truncated: boolean
}

// ─── Agent Loop Types ────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool_result'
  content: string
  toolCalls?: AgentToolCall[]
  toolResults?: AgentToolResult[]
}

export interface AgentLoopConfig {
  model: string
  systemPrompt: string
  tools: AgentToolDefinition[]
  maxIterations: number
  maxTokensPerIteration?: number
  onIteration?: (iteration: number, message: AgentMessage) => void
}

export interface AgentLoopResult {
  messages: AgentMessage[]
  iterationsUsed: number
  tokenCost: { input: number; output: number }
  finalOutput: string
}

// ─── Phase 3: Red-Team ───────────────────────────────────────────────────────

export type ExploitFeasibility = 'theoretical' | 'plausible' | 'demonstrated'

export interface ExploitAttempt {
  attackVector: string
  technique: string
  targetAsset: string
  feasibility: ExploitFeasibility
  evidence: string
  file: string
  line?: number
  chainedWith?: string[]
  mitigatedBy?: string
}

export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

export interface RedTeamResult {
  exploitAttempts: ExploitAttempt[]
  overallThreatLevel: ThreatLevel
  sandboxEscapeRisk: number
  dataExfiltrationRisk: number
  supplyChainRisk: number
  promptInjectionRisk: number
  iterationsUsed: number
  tokenCost: { input: number; output: number }
}

// ─── Phase 4: Judge ──────────────────────────────────────────────────────────

export type VerificationMethod = 'code_confirmed' | 'ast_confirmed' | 'tool_confirmed' | 'reasoning_confirmed'
export type RejectionReason = 'hallucinated' | 'duplicate' | 'not_applicable' | 'mitigated' | 'insufficient_evidence'

export interface VerifiedFinding extends ExpertFinding {
  verificationMethod: VerificationMethod
  verificationEvidence: string
  adjustedSeverity?: 'critical' | 'warning' | 'info'
  adjustedConfidence?: number
}

export interface RejectedFinding {
  original: ExpertFinding
  rejectionReason: RejectionReason
  explanation: string
}

export interface ResolvedConflict {
  findingA: ExpertFinding
  findingB: ExpertFinding
  resolution: string
  winner: 'a' | 'b' | 'neither' | 'merged'
  mergedFinding?: VerifiedFinding
}

export interface FinalDimensionScore {
  dimension: number
  name: string
  verdict: 'pass' | 'fail' | 'warning'
  confidence: number
  summary: string
  verifiedFindings: number
  criticalCount: number
  warningCount: number
}

export interface JudgeResult {
  verifiedFindings: VerifiedFinding[]
  rejectedFindings: RejectedFinding[]
  resolvedConflicts: ResolvedConflict[]
  dimensionScores: FinalDimensionScore[]
  stats: {
    totalFindingsReceived: number
    hallucinated: number
    duplicates: number
    conflictsResolved: number
    verified: number
  }
  iterationsUsed: number
  tokenCost: { input: number; output: number }
}

// ─── Phase 5: Verdict ────────────────────────────────────────────────────────

export interface ReviewStats {
  totalDuration: number
  phaseDurations: {
    staticAnalysis: number
    expertAgents: number
    redTeam: number
    judge: number
    verdict: number
  }
  totalFindings: number
  verifiedFindings: number
  rejectedFindings: number
  hallucinationRate: number
  iterationsUsed: {
    securityExpert: number
    qualityExpert: number
    standardsExpert: number
    redTeam: number
    judge: number
  }
}

export interface ReviewCost {
  totalTokens: { input: number; output: number }
  perPhase: {
    phase: string
    model: string
    tokens: { input: number; output: number }
    estimatedCost: number
  }[]
  totalEstimatedCost: number
}

export interface LearningSignal {
  type: 'new_pattern' | 'standard_confirmed' | 'standard_violated' | 'novel_attack_vector'
  dimension: number
  description: string
  evidence: string
  confidence: number
}

export interface ReviewVerdict {
  decision: 'approved' | 'rejected'
  decisionConfidence: number
  decisionReason: string
  scorecard: DimensionScore[]
  findings: VerifiedFinding[]
  threatAssessment: RedTeamResult
  stats: ReviewStats
  cost: ReviewCost
  learningSignals: LearningSignal[]
}

// ─── Learning System ─────────────────────────────────────────────────────────

export interface LearnedStandard {
  id: string
  dimension: number
  rule: string
  rationale: string
  examples: {
    good: CodeExample[]
    bad: CodeExample[]
  }
  source: 'manual' | 'learned'
  confidence: number
  createdAt: Date
  lastConfirmedAt: Date
}

export interface CodeExample {
  componentName: string
  file: string
  snippet: string
  reviewId: string
}

export interface PatternEntry {
  id: string
  type: 'approved' | 'rejected' | 'suspicious'
  patternDesc: string
  regex?: string
  dimension: number
  occurrences: number
  lastSeen: Date
  examples: CodeExample[]
}

export interface ReviewOutcome {
  id: string
  uploadId: string
  verdict: 'approved' | 'rejected'
  dimensionScores: FinalDimensionScore[]
  findings: VerifiedFinding[]
  postReviewSignals?: {
    adminOverride?: 'approved' | 'rejected'
    userFlagged?: boolean
    componentRevoked?: boolean
    usageCount?: number
  }
  createdAt: Date
}

export interface ReviewCorrection {
  reviewId: string
  findingId: string
  correctionType: 'false_positive' | 'false_negative' | 'severity_wrong'
  original: { severity: string; dimension: number }
  corrected: { severity: string; dimension: number }
  reason: string
  correctedBy: 'admin' | 'outcome'
  createdAt: Date
}

export interface DimensionWeight {
  dimension: number
  weight: number
  strictnessLevel: 'lenient' | 'standard' | 'strict' | 'paranoid'
  adjustedAt: Date
  reason: string
}

export interface ReviewerKnowledgeBase {
  version: number
  updatedAt: Date
  codeStandards: LearnedStandard[]
  patternLibrary: PatternEntry[]
  dimensionWeights: DimensionWeight[]
}

// ─── Cost Control Config ─────────────────────────────────────────────────────

export interface ReviewerConfig {
  maxConcurrentReviews: number
  maxReviewsPerHour: number
  reviewThrottleSeconds: number
  pauseReviews: boolean
  maxLLMCostPerDay: number
  maxExpertAgentIterations: number
  maxRedTeamIterations: number
  maxJudgeIterations: number
  qualityThreshold: number         // default: 70
  maxWarnings: number              // default: 5
  tierWeights: {
    security: number               // default: 3 — security findings weighted 3x
    quality: number                // default: 2 — quality findings weighted 2x
    standards: number              // default: 1 — standards findings weighted 1x
  }
  modelOverrides: {
    securityExpert?: string
    qualityExpert?: string
    standardsExpert?: string
    redTeam?: string
    judge?: string
  }
}

export const DEFAULT_REVIEWER_CONFIG: ReviewerConfig = {
  maxConcurrentReviews: 5,
  maxReviewsPerHour: 30,
  reviewThrottleSeconds: 10,
  pauseReviews: false,
  maxLLMCostPerDay: 50,
  maxExpertAgentIterations: 12,
  maxRedTeamIterations: 10,
  maxJudgeIterations: 12,
  qualityThreshold: 70,
  maxWarnings: 5,
  tierWeights: { security: 3, quality: 2, standards: 1 },
  modelOverrides: {},
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface AgentReviewProgress {
  phase: 'static_analysis' | 'expert_agents' | 'red_team' | 'judge' | 'verdict'
  status: 'in_progress' | 'complete' | 'failed' | 'skipped'
  detail?: string
}

export type AgentReviewProgressCallback = (progress: AgentReviewProgress) => Promise<void>

/**
 * The main entry point type for the reviewer agent.
 * Called by the pipeline runner as a StageFunction.
 */
export interface ReviewerAgentInput {
  uploadId: string
  manifest: Record<string, unknown>  // ComponentManifest or PipelineManifest
  files: Record<string, string>
  previousResults: Array<{ stage: string; status: string; data?: Record<string, unknown> }>
  onProgress?: AgentReviewProgressCallback
  config?: Partial<ReviewerConfig>
  knowledgeBase?: ReviewerKnowledgeBase
}
