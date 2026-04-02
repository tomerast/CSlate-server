# CSlate Reviewer Agent Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Author:** Tomer + Claude

## Overview

The CSlate Reviewer Agent is a multi-phase, multi-agent code review system that acts as the gatekeeper for the shared component/pipeline database. It replaces the current single-LLM-call security scan and quality review stages with a sophisticated orchestrated agent that mirrors industry patterns from Qodo 2.0, CodeRabbit, Ellipsis, and Semgrep.

**Design philosophy:** Every submission is presumed hostile until proven safe. Only the highest quality code enters the shared DB. The agent acts like a paranoid senior security auditor backed by a team of specialized experts.

**Industry pattern adopted:** Static Pre-processing -> Parallel Expert Agents -> Adversarial Red-Team -> Judge/Verification -> Verdict Synthesis. This is the converging architecture used by all major AI code review platforms.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Phase 1: Static Analysis](#2-phase-1-static-analysis)
3. [Phase 2: Parallel Expert Agents](#3-phase-2-parallel-expert-agents)
4. [Phase 3: Adversarial Red-Team Agent](#4-phase-3-adversarial-red-team-agent)
5. [Phase 4: Judge Agent](#5-phase-4-judge-agent)
6. [Phase 5: Verdict Synthesis & Report](#6-phase-5-verdict-synthesis--report)
7. [Continuous Learning & Standards Evolution](#7-continuous-learning--standards-evolution)
8. [Queue & Cost Control](#8-queue--cost-control)
9. [10-Dimension Scorecard](#9-10-dimension-scorecard)
10. [Integration with Existing Pipeline](#10-integration-with-existing-pipeline)
11. [Reference Architecture](#11-reference-architecture)

---

## 1. High-Level Architecture

The reviewer agent is a single "stage" from the pipeline runner's perspective. It consumes a `PipelineContext` (or `PipelineReviewContext`) and returns a `StageResult`. Internally, it orchestrates 5 phases:

```
┌─────────────────────────────────────────────────────────────────┐
│                    REVIEW PIPELINE (unchanged outer shell)       │
│                                                                 │
│  Stage 1: manifest_validation  (KEEP AS-IS - deterministic)     │
│  Stage 2: dependency_check     (KEEP AS-IS - deterministic)     │
│  Stage 3: ┌─────────────────────────────────────────────────┐   │
│           │        REVIEWER AGENT (NEW - replaces old        │   │
│           │        security_scan + quality_review + test_render) │
│           │                                                   │   │
│           │  Phase 1: STATIC ANALYSIS (deterministic, no LLM)│   │
│           │    - Security patterns, credential detection      │   │
│           │    - URL validation, Tailwind token check          │   │
│           │    - AST structural analysis (NEW)                │   │
│           │    - TypeScript compilation (moved from stage 5)  │   │
│           │    - Import validation, dead code detection        │   │
│           │    -> INSTANT REJECT on critical static findings  │   │
│           │                                                   │   │
│           │  Phase 2: PARALLEL EXPERT AGENTS (3 sub-agents)   │   │
│           │    ┌──────────┐ ┌──────────┐ ┌──────────┐        │   │
│           │    │Security  │ │Quality   │ │Standards │        │   │
│           │    │Expert    │ │Expert    │ │Expert    │        │   │
│           │    │dims 1-3  │ │dims 4-7  │ │dims 8-10 │        │   │
│           │    └────┬─────┘ └────┬─────┘ └────┬─────┘        │   │
│           │         └──────┬─────┴─────────────┘              │   │
│           │    -> INSTANT REJECT if Security Expert fails     │   │
│           │                                                   │   │
│           │  Phase 3: ADVERSARIAL RED-TEAM AGENT              │   │
│           │    - Receives code + all Phase 1-2 findings       │   │
│           │    - Thinks like an attacker                      │   │
│           │    - Probes exploit paths, sandbox escapes        │   │
│           │                                                   │   │
│           │  Phase 4: JUDGE AGENT                             │   │
│           │    - Anti-hallucination verification              │   │
│           │    - Deduplication + conflict resolution          │   │
│           │    - Final severity/confidence assignment         │   │
│           │                                                   │   │
│           │  Phase 5: VERDICT SYNTHESIS                       │   │
│           │    - 10-dimension scorecard                       │   │
│           │    - APPROVE / REJECT + evidence-backed report    │   │
│           └─────────────────────────────────────────────────┘   │
│  Stage 4: cataloging           (KEEP AS-IS)                     │
│  Stage 5: embedding            (KEEP AS-IS)                     │
└─────────────────────────────────────────────────────────────────┘
```

**Key decisions:**
- The agent is a single `StageResult`-returning function — backward compatible with the runner
- Manifest validation and dependency check stay deterministic (cheap, fast, no reason to change)
- TypeScript compilation moves inside the agent (Phase 1) so type errors inform the expert agents
- Cataloging and embedding remain separate — they're enrichment, not gatekeeping
- Short-circuit at multiple points to save LLM cost on obviously bad submissions

---

## 2. Phase 1: Static Analysis

Deterministic, no LLM calls. Catches cheap obvious failures and builds a structured evidence dossier for the expert agents.

### Output Types

```typescript
interface StaticAnalysisResult {
  // Instant-reject findings (any critical = stop pipeline)
  criticalFindings: StaticFinding[]
  
  // Evidence for expert agents to investigate deeper
  warnings: StaticFinding[]
  
  // Structural data extracted from AST
  codeStructure: CodeStructureMap
  
  // TypeScript compilation results
  typeCheckResult: TypeCheckResult
}

interface StaticFinding {
  analyzer: string        // which sub-analyzer found it
  dimension: number       // which of the 10 dimensions (1-10)
  severity: 'critical' | 'warning' | 'info'
  file: string
  line?: number
  pattern?: string        // regex/AST pattern that matched
  message: string
  evidence: string        // actual code snippet
}

interface CodeStructureMap {
  // Per-file AST analysis
  files: Record<string, {
    exports: ExportInfo[]
    imports: ImportInfo[]
    functions: FunctionInfo[]
    classes: ClassInfo[]
    bridgeCalls: BridgeCallInfo[]        // all bridge.fetch/subscribe/getConfig
    domAccess: DOMAccessInfo[]           // any window/document usage
    dynamicExpressions: DynamicExprInfo[] // eval, new Function, template literals
  }>
  
  // Cross-file analysis
  dependencyGraph: Map<string, string[]>  // file -> files it imports
  unusedExports: string[]
  circularDependencies: string[][]
}
```

### Sub-Analyzers

| Analyzer | What it does | Source |
|----------|-------------|--------|
| **Security Pattern Scanner** | Regex + config-driven blocked pattern matching | Existing `security-patterns.json` (enhanced) |
| **Credential Detector** | API keys, tokens, secrets in source code | Existing patterns + expanded regex library |
| **URL Validator** | Tier 1/2/3 URL classification for data sources | Existing `url-allowlist.json` / `url-blocklist.json` |
| **Tailwind Token Checker** | Raw color utilities vs semantic tokens | Existing pattern from quality review |
| **AST Structure Analyzer** | Parse all files into structured AST data | **NEW** - uses TypeScript compiler API |
| **TypeScript Compiler** | `tsc --noEmit` with strict mode | Existing from stage 5 (moved here) |
| **Import Validator** | Verify imports resolve, check for node builtins, circular deps | **NEW** - built on AST data |
| **Dead Code Detector** | Unused exports, unreachable branches | **NEW** - built on AST data |

### Short-Circuit Logic

- Any `critical` finding from Security Pattern Scanner, Credential Detector, or URL Validator -> **instant REJECT**, skip all LLM phases (saves cost)
- TypeScript compilation failure -> **instant REJECT** (code doesn't compile)
- All other findings flow as evidence to Phase 2

The `CodeStructureMap` gives the expert agents structured understanding of the code rather than forcing them to re-read and parse everything from scratch. This follows CodeRabbit's principle: "exactly what it needs and nothing more."

---

## 3. Phase 2: Parallel Expert Agents

Three specialized agents run in parallel via `Promise.all()`. Each is an agentic loop (not a single LLM call) with tools, iteration budget, and structured output.

### Shared Agent Architecture

```typescript
interface ExpertAgentConfig {
  name: string
  dimensions: DimensionConfig[]
  model: string
  systemPrompt: string
  tools: AgentTool[]
  maxIterations: number
  shortCircuitOnCritical: boolean
}

interface DimensionConfig {
  id: number
  name: string
  description: string
  checklist: string[]
  severityThresholds: {
    critical: string[]
    warning: string[]
  }
}

interface ExpertFinding {
  dimension: number
  severity: 'critical' | 'warning' | 'info'
  confidence: number                  // 0-100
  title: string
  description: string
  file: string
  line?: number
  evidence: string                    // actual code snippet
  reasoning: string                   // chain of thought
  verifiedByTool: boolean
  toolVerification?: string
}

interface ExpertAgentResult {
  agent: string
  dimensions: DimensionScore[]
  findings: ExpertFinding[]
  iterationsUsed: number
  tokenCost: { input: number; output: number }
}

interface DimensionScore {
  dimension: number
  name: string
  verdict: 'pass' | 'fail' | 'warning'
  confidence: number
  summary: string
  findingCount: { critical: number; warning: number; info: number }
}
```

### Tools Available to All Expert Agents

All tools are read-only and concurrency-safe.

| Tool | Description |
|------|------------|
| `readFile(file)` | Read a submitted file's contents |
| `grep(pattern, file?)` | Search for patterns across submitted files |
| `queryAST(file, query)` | Query the CodeStructureMap from Phase 1 |
| `getStaticFindings(dimension?)` | Retrieve Phase 1 static findings |
| `getTypeErrors(file?)` | Get TypeScript compilation errors from Phase 1 |
| `checkImports(file)` | Verify imports and resolution |
| `getManifest()` | Read the component/pipeline manifest |
| `compareManifestToCode(aspect)` | Cross-reference manifest vs actual code |
| `searchExistingComponents(query)` | Query shared DB for similar components |
| `runRegex(pattern, file)` | Run a custom regex, return matches with line numbers |

### Security Expert Agent (Dimensions 1-3)

**Model:** `claude-sonnet-4-6`
**Max iterations:** 15
**Short-circuit:** Yes - any critical in dim 1 stops early

**Persona:** Paranoid security auditor. Every submission is presumed hostile until proven safe. Last line of defense for the shared DB.

**Dimension 1 - Malicious Intent Detection:**
- Obfuscated code (string concat to build API names, encoded payloads, `atob()`/`btoa()`)
- Hidden network calls (indirect fetch construction, WebSocket via string building)
- Data exfiltration channels (encoding data in URL params, CSS custom properties, error messages)
- Suspicious control flow (setTimeout chains, recursive patterns that hide intent)
- Environment-conditional behavior (code that acts differently based on runtime)
- Intent mismatch: code does something other than what manifest claims

**Dimension 2 - Injection & Sandbox Escape:**
- Prompt injection in `context.md`, description, or string literals
- XSS vectors (`dangerouslySetInnerHTML`, unescaped user data)
- Prototype pollution (`__proto__`, `constructor.prototype`)
- Bridge API abuse (dynamic source IDs in `bridge.fetch`)
- `window`/`document`/`globalThis` access beyond sandbox allowance
- `eval()`, `new Function()`, `Function.prototype.constructor` - even indirect

**Dimension 3 - Credential & Data Hygiene:**
- Hardcoded API keys, tokens, passwords (even in comments/test data)
- PII in code or default configs
- Secrets that should use `bridge.getConfig()` but don't
- Sensitive data logged to console
- Data retained in module-level variables (persists across renders)

**Agent loop behavior:**
1. Read `getStaticFindings()` for dimensions 1-3
2. For each static finding, `readFile` + `queryAST` to verify and deepen
3. Proactively grep for patterns not covered by static analysis
4. Cross-reference manifest data sources against actual bridge.fetch calls
5. Check context.md for prompt injection patterns
6. Score each dimension

### Quality Expert Agent (Dimensions 4-7)

**Model:** `claude-sonnet-4-6`
**Max iterations:** 12
**Short-circuit:** No

**Persona:** Senior software architect. Only the highest quality code enters the shared database. Rigor of a principal engineer at a top tech company.

**Dimension 4 - Architecture & SOLID:**
- UI/Logic separation (business logic in `logic.ts`, not `ui.tsx`)
- Single responsibility per file
- Clean dependency direction (types <- logic <- ui)
- No god-functions (functions > 50 lines)
- Proper React patterns (hooks, composition over inheritance)

**Dimension 5 - Functionality & Correctness:**
- Does code achieve what manifest claims?
- Null/undefined handling on all data paths
- Error handling in bridge.fetch callbacks
- Race conditions in async operations
- Edge cases: empty data, missing fields, unexpected types

**Dimension 6 - Type Safety & Contracts:**
- No untyped `any` (unless justified)
- Manifest inputs/outputs/events/actions match TypeScript interfaces
- Proper generic usage (no `Record<string, any>`)
- Type assertions (`as`) justified and safe

**Dimension 7 - Performance & Resource:**
- Memory leaks (subscriptions not cleaned up, intervals not cleared)
- Unbounded loops or recursion
- Excessive re-renders (missing useMemo/useCallback where needed)
- Missing cleanup in useEffect return functions

### Standards Expert Agent (Dimensions 8-10)

**Model:** `claude-haiku-4-5-20251001` (cost-optimized, lighter reasoning needed)
**Max iterations:** 8
**Short-circuit:** No

**Persona:** Code quality and documentation reviewer. Components must be maintainable by developers who've never seen the code before.

**Dimension 8 - Readability & Style:**
- Consistent naming conventions (camelCase functions, PascalCase components)
- No dead code, commented-out blocks, TODO/FIXME
- No console.log / console.debug
- Reasonable file sizes (no single file > 500 lines)

**Dimension 9 - Accessibility & UX:**
- Semantic HTML elements (not div-for-everything)
- ARIA labels on interactive elements
- Keyboard navigation support
- Design tokens (not raw colors)

**Dimension 10 - Manifest & Documentation Integrity:**
- context.md accurately describes actual behavior
- Manifest description matches code behavior
- All data sources in manifest actually used (and vice versa)
- Tags are relevant and not gaming search
- ai.modificationHints and ai.extensionPoints are accurate

---

## 4. Phase 3: Adversarial Red-Team Agent

Fundamentally different from the expert agents. Experts are cooperative reviewers. The red-team is an attacker that tries to find ways to exploit the code given knowledge of the CSlate runtime environment.

### Output Types

```typescript
interface RedTeamResult {
  exploitAttempts: ExploitAttempt[]
  overallThreatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'
  sandboxEscapeRisk: number           // 0-100
  dataExfiltrationRisk: number        // 0-100
  supplyChainRisk: number             // 0-100
  promptInjectionRisk: number         // 0-100
}

interface ExploitAttempt {
  attackVector: string
  technique: string
  targetAsset: string
  feasibility: 'theoretical' | 'plausible' | 'demonstrated'
  evidence: string
  file: string
  line?: number
  chainedWith?: string[]              // other findings this builds on
  mitigatedBy?: string                // existing defense that blocks this
}
```

**Model:** `claude-sonnet-4-6`
**Max iterations:** 10

**Additional tools beyond expert toolset:**

| Tool | Description |
|------|------------|
| `getBridgeAPISpec()` | Full bridge API surface - what fetch/subscribe/getConfig can do at runtime, sandbox restrictions |
| `getExpertFindings()` | All findings from Phase 2 expert agents |
| `getPlatformConstraints()` | CSlate sandbox rules - what's blocked, allowed, possible side-channels |

**Persona:** Red-team security researcher. Mission: find every possible way this code could harm users, exfiltrate data, compromise the platform, or abuse the bridge API. Think adversarially:
- "If I wanted to steal user data through this component, how would I do it?"
- "If I wanted to inject instructions into an AI agent that processes context.md, what would I write?"
- "If I wanted to reach an undeclared endpoint, could I construct a bridge.fetch call?"
- "If I wanted to affect other components on the canvas, could I abuse events/actions/shared state?"
- "If I wanted to persist malicious state across re-renders, where would I hide it?"

**Attack vectors to probe (ordered by severity):**

1. **Sandbox escape** - Access window.require, process, child_process, fs, Node.js globals
2. **Bridge API abuse** - Dynamic source IDs, eavesdropping via subscribe, config leaks
3. **Data exfiltration** - CSS custom properties, error messages, image tags, timing side-channels
4. **Prompt injection** - Instructions in context.md/descriptions targeting AI agents
5. **Cross-component attacks** - Event/action injection, shared state poisoning
6. **Supply chain** - Known vulnerabilities in npm dependencies
7. **State persistence** - Module-level closures, WeakMaps for cross-render persistence
8. **Timing/DoS** - Infinite loops, memory exhaustion, CPU-bound freezing

**Feasibility levels:**
- **Demonstrated**: The code actually does this
- **Plausible**: Building blocks exist; small modification would enable it
- **Theoretical**: Architecture would allow it but code doesn't go there

Only "demonstrated" and "plausible" findings flag for rejection.

---

## 5. Phase 4: Judge Agent

Quality control over the LLM agents themselves. Exists because LLM reviewers hallucinate findings. A finding that says "line 42 has an unhandled null" is worthless if line 42 handles null perfectly.

### Output Types

```typescript
interface JudgeResult {
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
}

interface VerifiedFinding extends ExpertFinding {
  verificationMethod: 'code_confirmed' | 'ast_confirmed' | 'tool_confirmed' | 'reasoning_confirmed'
  verificationEvidence: string
  adjustedSeverity?: 'critical' | 'warning' | 'info'
  adjustedConfidence?: number
}

interface RejectedFinding {
  original: ExpertFinding
  rejectionReason: 'hallucinated' | 'duplicate' | 'not_applicable' | 'mitigated' | 'insufficient_evidence'
  explanation: string
}

interface ResolvedConflict {
  findingA: ExpertFinding
  findingB: ExpertFinding
  resolution: string
  winner: 'a' | 'b' | 'neither' | 'merged'
  mergedFinding?: VerifiedFinding
}

interface FinalDimensionScore {
  dimension: number
  name: string
  verdict: 'pass' | 'fail' | 'warning'
  confidence: number
  summary: string
  verifiedFindings: number
  criticalCount: number
  warningCount: number
}
```

**Model:** `claude-sonnet-4-6`
**Max iterations:** 12

**Persona:** Senior judge reviewing the work of multiple code review agents. NOT a code reviewer. Role is to verify that reviewers' findings are accurate, non-duplicated, and properly calibrated. Skeptical of every finding.

**Judge responsibilities:**
1. **Anti-hallucination**: For every critical and warning finding, verify evidence exists in actual code. Read the file, check the line, confirm the pattern.
2. **Deduplication**: Merge duplicate findings across agents, keeping best evidence.
3. **Conflict resolution**: When agents disagree, investigate and decide who's right.
4. **Severity calibration**: Adjust severity based on actual impact given CSlate sandbox constraints.
5. **Confidence adjustment**: Lower confidence for weak evidence, raise for clear evidence.

**Judge pipeline (sequential within agent loop):**

1. **INGEST** - Load all findings, group by dimension, sort by severity
2. **DEDUPLICATION** - Compare across agents by file + line + pattern, merge duplicates
3. **CONFLICT RESOLUTION** - Identify contradictions, read actual code, resolve
4. **VERIFICATION** - For each critical/warning: read file, verify snippet, confirm issue (info-level passes through unverified for cost savings)
5. **SCORE DIMENSIONS** - Compute final score per dimension

---

## 6. Phase 5: Verdict Synthesis & Report

The final output. Machine-readable for the pipeline runner, human-readable for the admin dashboard and developer feedback.

### Output Types

```typescript
interface ReviewVerdict {
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

interface DimensionScore {
  dimension: number
  name: string
  tier: 'security' | 'quality' | 'standards'
  verdict: 'pass' | 'fail' | 'warning'
  confidence: number
  weight: number
  weightedScore: number
  summary: string
  findings: { critical: number; warning: number; info: number }
}

interface ReviewStats {
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

interface ReviewCost {
  totalTokens: { input: number; output: number }
  perPhase: {
    phase: string
    model: string
    tokens: { input: number; output: number }
    estimatedCost: number
  }[]
  totalEstimatedCost: number
}

interface LearningSignal {
  type: 'new_pattern' | 'standard_confirmed' | 'standard_violated' | 'novel_attack_vector'
  dimension: number
  description: string
  evidence: string
  confidence: number
}
```

### Verdict Decision Logic

```typescript
function computeVerdict(
  scorecard: DimensionScore[],
  threatAssessment: RedTeamResult,
  config: ReviewerConfig
): { decision: 'approved' | 'rejected'; reason: string } {

  // INSTANT REJECT CONDITIONS

  // 1. Any security tier dimension (1-3) failed
  const securityFail = scorecard
    .filter(d => d.tier === 'security')
    .find(d => d.verdict === 'fail')
  if (securityFail) {
    return {
      decision: 'rejected',
      reason: `Security failure: ${securityFail.name} - ${securityFail.summary}`
    }
  }

  // 2. Red-team found demonstrated or plausible exploits
  if (threatAssessment.overallThreatLevel === 'critical' ||
      threatAssessment.overallThreatLevel === 'high') {
    return {
      decision: 'rejected',
      reason: `Threat assessment: ${threatAssessment.overallThreatLevel} - ` +
        threatAssessment.exploitAttempts
          .filter(e => e.feasibility !== 'theoretical')
          .map(e => e.attackVector).join(', ')
    }
  }

  // 3. Any dimension has critical findings after judge verification
  const anyCritical = scorecard.find(d => d.findings.critical > 0)
  if (anyCritical) {
    return {
      decision: 'rejected',
      reason: `Critical issue in ${anyCritical.name}: ${anyCritical.summary}`
    }
  }

  // WEIGHTED QUALITY GATE

  // 4. Quality score must exceed threshold
  // weightedAverage: sum(d.weight * d.confidence * (d.verdict === 'pass' ? 1 : d.verdict === 'warning' ? 0.5 : 0)) / sum(d.weight)
  const qualityDimensions = scorecard.filter(d => d.tier === 'quality')
  const qualityScore = weightedAverage(qualityDimensions)
  if (qualityScore < config.qualityThreshold) {  // default: 70
    return {
      decision: 'rejected',
      reason: `Quality score ${qualityScore.toFixed(0)}/100 below threshold (${config.qualityThreshold})`
    }
  }

  // WARNING ACCUMULATION

  // 5. Too many warnings = reject
  const totalWarnings = scorecard.reduce((sum, d) => sum + d.findings.warning, 0)
  if (totalWarnings > config.maxWarnings) {  // default: 5
    return {
      decision: 'rejected',
      reason: `${totalWarnings} warnings exceeds threshold (${config.maxWarnings})`
    }
  }

  // APPROVED
  return {
    decision: 'approved',
    reason: `All dimensions passed. Quality: ${qualityScore.toFixed(0)}/100. ${totalWarnings} minor warnings.`
  }
}
```

### StageResult Integration

The entire reviewer agent returns a single StageResult to the pipeline runner:

```typescript
const stageResult: StageResult = {
  stage: 'agent_review',
  status: verdict.decision === 'approved' ? 'passed' : 'failed',
  duration: verdict.stats.totalDuration,
  issues: verdict.findings.map(f => ({
    severity: f.adjustedSeverity ?? f.severity,
    file: f.file,
    line: f.line,
    pattern: f.title,
    message: f.description,
    fix: undefined
  })),
  data: {
    verdict: verdict,
    report: renderMarkdown(verdict)
  }
}
```

### Developer-Facing Report Format

```markdown
# Review Report: {componentName} v{version}

## Verdict: REJECTED
**Reason:** Security failure: Malicious Intent Detection - Obfuscated fetch
construction via string concatenation in logic.ts:42
**Confidence:** 96%
**Review Duration:** 2m 34s
**Cost:** $0.18

## Scorecard

| # | Dimension | Verdict | Confidence | Critical | Warnings |
|---|-----------|---------|------------|----------|----------|
| 1 | Malicious Intent Detection | FAIL | 96% | 1 | 0 |
| 2 | Injection & Sandbox Escape | PASS | 88% | 0 | 0 |
| ... | ... | ... | ... | ... | ... |

## Critical Findings

### [CRITICAL] Obfuscated network call construction
**Dimension:** 1 - Malicious Intent Detection
**File:** logic.ts:42
**Confidence:** 96%
**Evidence:** (code snippet)
**Reasoning:** (chain of thought)
**Verified by:** Judge agent confirmed via AST analysis

## Warnings
(each warning with same structure)

## Threat Assessment
**Overall Threat Level:** HIGH
**Demonstrated Exploits:** (list)

## Review Phases
| Phase | Duration | Iterations | Cost |
|-------|----------|------------|------|
| Static Analysis | 1.2s | - | $0.00 |
| Expert Agents | 45s | 12/8/6 | $0.09 |
| Red-Team | 28s | 7 | $0.05 |
| Judge | 18s | 5 | $0.03 |
| Verdict | 0.1s | - | $0.01 |
```

---

## 7. Continuous Learning & Standards Evolution

The reviewer agent maintains a living knowledge base that evolves with every review.

### Knowledge Base Schema

```typescript
interface ReviewerKnowledgeBase {
  version: number
  updatedAt: Date
  codeStandards: LearnedStandard[]
  patternLibrary: PatternEntry[]
  reviewHistory: ReviewOutcome[]
  corrections: ReviewCorrection[]
  dimensionWeights: DimensionWeight[]
}

interface LearnedStandard {
  id: string
  dimension: number
  rule: string
  rationale: string
  examples: {
    good: CodeExample[]
    bad: CodeExample[]
  }
  source: 'manual' | 'learned'
  confidence: number            // 0-100
  createdAt: Date
  lastConfirmedAt: Date
}

interface PatternEntry {
  id: string
  type: 'approved' | 'rejected' | 'suspicious'
  pattern: string
  regex?: string
  dimension: number
  occurrences: number
  lastSeen: Date
  examples: CodeExample[]
}

interface ReviewOutcome {
  reviewId: string
  componentName: string
  verdict: 'approved' | 'rejected'
  dimensionScores: FinalDimensionScore[]
  findings: VerifiedFinding[]
  postReviewSignals?: {
    adminOverride?: 'approved' | 'rejected'
    userFlagged?: boolean
    componentRevoked?: boolean
    usageCount?: number
  }
}

interface ReviewCorrection {
  reviewId: string
  findingId: string
  correctionType: 'false_positive' | 'false_negative' | 'severity_wrong'
  original: { severity: string; dimension: number }
  corrected: { severity: string; dimension: number }
  reason: string
  correctedBy: 'admin' | 'outcome'
  createdAt: Date
}

interface DimensionWeight {
  dimension: number
  weight: number                // 1.0 = default
  strictnessLevel: 'lenient' | 'standard' | 'strict' | 'paranoid'
  adjustedAt: Date
  reason: string
}
```

### Three Learning Channels

**Channel 1: Review Outcome Feedback**
- After each review: APPROVED -> extract good patterns, REJECTED -> extract bad patterns
- Delayed signals: admin overrides, component revocations, user flags, usage counts

**Channel 2: Standards Distillation (weekly batch job)**
- Analyze last N approved/rejected components
- Extract recurring patterns -> new standards
- Compare false positive/negative rates per dimension
- Adjust dimension weights based on signal
- Conservative: only propose new standard with 3+ confirming reviews

**Channel 3: Admin Manual Rules**
- Add/edit/remove standards manually
- Adjust dimension weights
- Add approved/rejected pattern examples
- Override agent verdicts (feeds Channel 1)
- Set strictness level per dimension

### How Knowledge Feeds Into Agent Phases

- **Phase 1 (Static)**: patternLibrary adds learned regex patterns to scanner
- **Phase 2 (Experts)**: codeStandards injected into system prompts as few-shot examples; dimensionWeights control strictness
- **Phase 3 (Red-Team)**: past exploits from rejected components as known attack vectors
- **Phase 4 (Judge)**: corrections calibrate judge (false positive awareness); reviewHistory establishes quality bar
- **Phase 5 (Verdict)**: dimensionWeights drive weighted scoring formula

### Safety Rails on Learning

1. **Minimum sample size**: Won't learn from fewer than 3 confirming reviews
2. **Admin veto**: Admins can retire any learned standard
3. **Confidence decay**: Standards not confirmed in 90 days lose confidence
4. **Version history**: Every mutation versioned and rollbackable
5. **Dimension weight bounds**: 0.5 - 2.0 without admin approval
6. **Audit log**: Every learning event logged
7. **Security dimensions (1-3) can only be tightened by learning, never loosened** - only admins can loosen security

### Database Schema Additions

```sql
CREATE TABLE reviewer_knowledge_versions (
  id                    SERIAL PRIMARY KEY,
  version               INTEGER NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  distillation_run_id   TEXT,
  changes_summary       TEXT
);

CREATE TABLE reviewer_standards (
  id                TEXT PRIMARY KEY,
  dimension         INTEGER NOT NULL,
  rule              TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  examples_good     JSONB DEFAULT '[]',
  examples_bad      JSONB DEFAULT '[]',
  source            TEXT NOT NULL,
  confidence        REAL DEFAULT 50,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ,
  retired_at        TIMESTAMPTZ
);

CREATE TABLE reviewer_patterns (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  pattern_desc  TEXT NOT NULL,
  regex         TEXT,
  dimension     INTEGER NOT NULL,
  occurrences   INTEGER DEFAULT 1,
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  examples      JSONB DEFAULT '[]'
);

CREATE TABLE review_outcomes (
  id                TEXT PRIMARY KEY,
  upload_id         TEXT REFERENCES uploads(id),
  verdict           TEXT NOT NULL,
  dimension_scores  JSONB NOT NULL,
  findings          JSONB NOT NULL,
  admin_override    TEXT,
  user_flagged      BOOLEAN DEFAULT FALSE,
  component_revoked BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE review_corrections (
  id              SERIAL PRIMARY KEY,
  review_id       TEXT REFERENCES review_outcomes(id),
  finding_id      TEXT,
  correction_type TEXT NOT NULL,
  original        JSONB NOT NULL,
  corrected       JSONB NOT NULL,
  reason          TEXT,
  corrected_by    TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reviewer_dimension_weights (
  dimension   INTEGER PRIMARY KEY,
  weight      REAL DEFAULT 1.0,
  strictness  TEXT DEFAULT 'standard',
  adjusted_at TIMESTAMPTZ DEFAULT NOW(),
  reason      TEXT
);
```

---

## 8. Queue & Cost Control

### Decision: Keep pg-boss

**Rationale:** pg-boss provides all needed primitives (throttling, concurrency, priority, retry) without adding Redis infrastructure. Scale (50-100 reviews/day peak) is well within pg-boss limits (~1000 jobs/sec). Already integrated and working.

### Admin Cost Control Layer

```typescript
interface ReviewerConfig {
  // Concurrency & rate limiting
  maxConcurrentReviews: number        // maps to teamConcurrency
  maxReviewsPerHour: number           // enforced at enqueue time
  reviewThrottleSeconds: number       // maps to sendThrottled interval
  pauseReviews: boolean               // emergency kill switch
  
  // Cost caps
  maxLLMCostPerDay: number            // dollar cap
  
  // Per-phase budget caps
  maxExpertAgentIterations: number    // default 12-15
  maxRedTeamIterations: number        // default 10
  maxJudgeIterations: number          // default 12
  
  // Quality thresholds
  qualityThreshold: number            // default 70
  maxWarnings: number                 // default 5
  
  // Model overrides (admin can downgrade to save cost)
  modelOverrides: {
    securityExpert: string
    qualityExpert: string
    standardsExpert: string
    redTeam: string
    judge: string
  }
}
```

### Enforcement at Enqueue Time

```typescript
async function enqueueReview(data: ReviewJobData): Promise<string | null> {
  const config = await getReviewerConfig()
  
  if (config.pauseReviews) throw new Error('Reviews paused by admin')
  
  const recentCount = await countReviewsInLastHour()
  if (recentCount >= config.maxReviewsPerHour) {
    return boss.send('review-component', data, {
      startAfter: calculateNextSlot(config)
    })
  }
  
  const todayCost = await getTodayLLMCost()
  if (todayCost >= config.maxLLMCostPerDay) {
    return boss.send('review-component', data, {
      startAfter: getNextMidnight()
    })
  }
  
  return boss.sendThrottled('review-component', data, {}, config.reviewThrottleSeconds)
}
```

### Runtime Concurrency Updates (No Restart)

Worker listens for config changes via `pg_notify` and re-registers with new `teamConcurrency`.

### Expected Cost per Review

| Phase | Model | Est. Tokens | Est. Cost |
|-------|-------|-------------|-----------|
| Static Analysis | None | 0 | $0.00 |
| Security Expert | Sonnet | ~15K in + 3K out | $0.06 |
| Quality Expert | Sonnet | ~12K in + 2K out | $0.05 |
| Standards Expert | Haiku | ~8K in + 1.5K out | $0.01 |
| Red-Team | Sonnet | ~10K in + 2K out | $0.04 |
| Judge | Sonnet | ~10K in + 2K out | $0.04 |
| **Total** | | | **~$0.20** |

Short-circuit savings: ~30-40% of submissions rejected at Phase 1 (free) or early Phase 2 (partial cost).

---

## 9. 10-Dimension Scorecard

| # | Dimension | Tier | What it scrutinizes |
|---|-----------|------|-------------------|
| 1 | Malicious Intent Detection | Security | Obfuscation, hidden network calls, data exfiltration, intent mismatch |
| 2 | Injection & Sandbox Escape | Security | Prompt injection, XSS, prototype pollution, bridge abuse, sandbox escape |
| 3 | Credential & Data Hygiene | Security | Hardcoded secrets, PII, improper getConfig/getSecret usage |
| 4 | Architecture & SOLID | Quality | UI/logic separation, SRP, dependency direction, modularization |
| 5 | Functionality & Correctness | Quality | Logic bugs, null handling, race conditions, edge cases |
| 6 | Type Safety & Contracts | Quality | TypeScript strictness, manifest/code interface match |
| 7 | Performance & Resource | Quality | Memory leaks, unbounded loops, re-renders, missing cleanup |
| 8 | Readability & Style | Standards | Naming conventions, dead code, console.logs, file size |
| 9 | Accessibility & UX | Standards | Semantic HTML, ARIA, keyboard nav, design tokens |
| 10 | Manifest & Documentation | Standards | context.md accuracy, tag relevance, data source declarations |

**Verdict rules:**
- Any FAIL in Security tier (1-3) = instant REJECT
- Any critical finding in any dimension = REJECT
- Weighted quality score below threshold = REJECT
- Warning count above threshold = REJECT
- Everything else = APPROVED

**Pipeline (data pipeline) review dimension mapping:**
Dimensions 1-3 (Security) and 4-7 (Quality) apply fully to both components and pipelines. Dimensions 8-10 (Standards) adapt:
- Dim 8 (Readability & Style): applies to both
- Dim 9 (Accessibility & UX): **skipped for pipelines** (no UI). Weight redistributed to dims 4-7.
- Dim 10 (Manifest & Documentation): applies to both (pipeline manifest instead of component manifest)

---

## 10. Integration with Existing Pipeline

### What Changes

| Current | New |
|---------|-----|
| Stage 2: security_scan (single LLM call) | **Removed** - absorbed into reviewer agent |
| Stage 4: quality_review (single LLM call) | **Removed** - absorbed into reviewer agent |
| Stage 5: test_render (tsc only) | **Removed** - moved into agent Phase 1 |
| - | **NEW** Stage 3: agent_review (the full reviewer agent) |

### New Pipeline Stage Order

1. `manifest_validation` (unchanged)
2. `dependency_check` (unchanged)
3. `agent_review` (NEW - replaces security_scan + quality_review + test_render)
4. `cataloging` (unchanged)
5. `embedding` (unchanged)

### Runner Changes

Minimal - the runner still calls `StageFunction` types. The agent_review stage just takes longer and returns richer data in `StageResult.data`.

### Progress Streaming

The agent_review stage emits sub-progress via the existing `pg_notify` mechanism:

```typescript
type AgentProgress = {
  phase: 'static_analysis' | 'expert_agents' | 'red_team' | 'judge' | 'verdict'
  status: 'in_progress' | 'complete' | 'failed'
  detail?: string  // e.g., "Security Expert: 8/15 iterations"
}
```

---

## 11. Reference Architecture

### Prompt Engineering

All agent system prompts follow patterns from the Slate/ref codebase (`/Users/tomerast/Downloads/Slate/ref`):
- Clear persona definition
- Explicit behavioral constraints
- Structured output format expectations
- Tool usage guidelines
- Few-shot examples from the knowledge base

### Agent Loop Pattern

Each agent follows the async generator pattern from Slate/ref's `query()`:
- Tool-gated iterations with budget cap
- Structured output per iteration
- Cancellation-aware (AbortController)
- Token tracking per iteration

### Sub-Agent Spawning

Follows Slate/ref's `AgentTool/runAgent.ts` pattern:
- Fresh agent context per spawn
- Isolated tool instances
- Result collection via Promise.all for parallel agents
- Transcript recording for debugging

### Implementation Worktree Plan

| Worktree Branch | Sub-feature |
|----------------|-------------|
| `feat/reviewer-static-analysis` | Phase 1: AST parser, pattern scanner, tsc integration |
| `feat/reviewer-expert-agents` | Phase 2: Security/Quality/Standards expert agent loops |
| `feat/reviewer-red-team` | Phase 3: Adversarial red-team agent |
| `feat/reviewer-judge-verdict` | Phase 4-5: Judge agent + verdict synthesis + scorecard |
| `feat/reviewer-orchestrator` | The orchestrator wiring all phases + runner integration |
| `feat/reviewer-learning` | Continuous learning system + DB schema + distillation job |
| `feat/reviewer-cost-control` | Admin config, rate limiting, cost tracking |
