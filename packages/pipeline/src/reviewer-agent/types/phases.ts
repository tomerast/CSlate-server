// ─── Phase 1: Static Analysis ────────────────────────────────────────────────

import type { DimensionTier } from './dimensions'

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
  dimensions: import('./dimensions').DimensionConfig[]
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

export interface ConfidenceInterval {
  lower: number       // lower bound (0-100)
  upper: number       // upper bound (0-100)
  width: number       // upper - lower
}

export interface DimensionScore {
  dimension: number
  name: string
  tier: DimensionTier
  verdict: 'pass' | 'fail' | 'warning'
  confidence: number
  confidenceInterval: ConfidenceInterval
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
