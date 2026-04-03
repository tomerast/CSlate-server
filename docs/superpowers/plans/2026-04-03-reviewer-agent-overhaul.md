# Reviewer Agent Overhaul — Implementation Notes

**Date:** 2026-04-03  
**Branch:** `ralph-reviewer-overhaul` (merged to main as PR #2)  
**Status:** Merged  

---

## Overview

This document summarizes the changes made in the reviewer agent overhaul. The overhaul is a second-pass engineering pass on top of the original implementation (`docs/superpowers/plans/2026-04-02-reviewer-agent-implementation.md`), focused on:

1. Eliminating duplication across the 5 agents (tools, agent factory)
2. Prompt engineering for production quality output
3. Type system organization
4. New tools for deeper component analysis
5. Confidence intervals on all scores
6. Correctness fixes surfaced by code review

The core architecture (5 phases: static → experts → red-team → judge → verdict) is unchanged. These are implementation quality improvements, not architectural changes.

---

## Changes by Area

### 1. Shared Tools (`shared-tools.ts`)

**Before:** Each of the 3 agent groups (experts, red-team, judge) had their own `tools.ts` that duplicated `readFile`, `searchCode`, etc. with slightly different implementations.

**After:** `packages/pipeline/src/reviewer-agent/shared-tools.ts` provides tool builders shared by all three groups. Each group's `tools.ts` now imports from shared and only defines phase-specific tools on top.

Shared tools:
| Tool | Description |
|---|---|
| `buildReadFileTool` | Read a file from the component package |
| `buildListFilesTool` | List all files in the package |
| `buildSearchCodeTool` | Regex search across all files, max 50 results with truncation notice |
| `buildGetManifestTool` | Return the component manifest as JSON |
| `buildGetComponentContextTool` | Read `context.md` and `manifest.description` together |
| `buildAnalyzeComponentTool` | High-level summary: renders, state, effects, bridge calls, exports |
| `buildSearchASTTool` | AST-aware queries: imports, exports, functions, bridge calls, state setters, effect deps |

**`searchCode` truncation:** When results exceed 50, the tool appends `[Truncated to 50 results — use a more specific pattern]` so the agent knows it may have missed matches.

**`searchAST` query types:**
```
functionCalls      — all function calls matching a name pattern
imports            — all import statements (with source filter)
exports            — all named/default exports
functions          — all function declarations and arrow functions
bridgeCalls        — all bridge.fetch / bridge.subscribe / bridge.getConfig calls
domAccess          — document.*, window.*, innerHTML patterns
dynamicExpressions — eval, Function(), dynamic property access
stateSetters       — React useState setters
effectDeps         — useEffect hooks with dependency arrays and cleanup detection
```

### 2. Agent Factory (`create-review-agent.ts`)

**Before:** Each agent (security-expert, quality-expert, standards-expert, red-team, judge) had its own bespoke LLM invocation logic.

**After:** `packages/pipeline/src/reviewer-agent/create-review-agent.ts` provides a single factory used by all 5 agents. It handles:
- Tool registration
- Agentic loop (streaming, tool-call dispatch)
- Iteration limit enforcement (from `config.maxExpertAgentIterations` etc.)
- Token cost accumulation
- JSON output parsing + validation

This ensures all agents behave consistently around error handling, iteration limits, and cost tracking.

### 3. Types Sub-Directory (`types/`)

**Before:** `types.ts` was a 681-line monolithic file covering all types.

**After:** Split into 5 focused files under `packages/pipeline/src/reviewer-agent/types/`:

| File | Contents |
|---|---|
| `config.ts` | `ReviewerConfig`, `DimensionConfig`, `ModelOverrides`, `DEFAULT_REVIEWER_CONFIG` |
| `dimensions.ts` | `DIMENSIONS` array (10-dimension definitions with checklists + thresholds) |
| `learning.ts` | `ReviewerKnowledgeBase`, `LearnedStandard`, `PatternEntry`, `DimensionWeight` |
| `phases.ts` | Per-phase I/O types: `ExpertAgentResult`, `RedTeamResult`, `JudgeResult`, `DimensionScore`, `ConfidenceInterval`, `FinalDimensionScore`, `VerifiedFinding`, etc. |
| `results.ts` | `ReviewVerdict`, `ReviewStats`, `ReviewCost` |

`types.ts` is kept as a barrel that re-exports everything from `types/index.ts` to maintain backward compatibility with existing imports.

### 4. Prompt Engineering Overhaul

All 5 agent system prompts were rewritten in `experts/prompts.ts`, `red-team/prompts.ts`, and `judge/prompts.ts`.

Key changes:
- **Structured output schema** — All agents produce a documented JSON schema. The schema is injected verbatim into the system prompt with field-level descriptions and constraints.
- **Confidence calibration** — Explicit rubric: 90-100 requires tool-confirmed evidence; below 50 = don't report. Forces agents to actually call tools before reporting findings.
- **Chain-of-thought in findings** — Each finding requires a `reasoning` field with "what I checked, what I found, why it's a finding."
- **Tool verification requirement** — `verifiedByTool: true` is required on every finding, with a `toolVerification` field citing what the tool returned.
- **Security expert** — Paranoid framing: every submission presumed hostile. Explicit checklist for bridge API misuse, obfuscation, data exfiltration, dynamic eval patterns.
- **Quality expert** — Covers code structure (UI/logic separation), type safety, manifest accuracy, accessibility, clean code.
- **Standards expert** — CSlate-specific conventions: Tailwind semantic tokens, `context.md` quality, naming conventions, pattern library compliance.
- **Red-team** — Attack simulation framing: bypass bridge restrictions, localStorage exfiltration, prototype pollution, SSRF via bridge.
- **Judge** — Two-pass: hallucination detection, then severity calibration. Explicit instructions on what constitutes a hallucination vs. a legitimate finding.

### 5. Confidence Intervals

**Added:** `ConfidenceInterval { lower, upper, width }` on `DimensionScore` and propagated through to the final `ReviewVerdict`.

The `OUTPUT_SCHEMA` injected into every expert's system prompt now includes `confidenceInterval` in the dimension object, so LLM output includes it.

Intervals are computed in `verdict/scoring.ts` using:
- Finding count → sample size factor (wider interval for fewer findings)
- Severity mix (critical/warning ratio) → shifts interval
- Hallucination rate from judge → widens interval
- Weighted combination per dimension to produce `decisionConfidenceInterval` on the verdict

### 6. Orchestrator Improvements

**Timeout + retry:** Each phase is wrapped in `withTimeout(withRetry(...))`. Retry is on transient errors only (rate limit, 429, ECONNRESET, socket hang up). Max 2 retries with exponential backoff.

**Phase timeouts:**
```
static_analysis: 30s
expert_agents:  180s (3 parallel LLM calls)
red_team:       120s
judge:          120s
```

**Progress events:** Every phase emits `in_progress` and `complete` with a detail string. When security fails and red-team is skipped, a `skipped` event is fired for `red_team` with reason.

**Short-circuit logic fix:** Previously, when security expert failed, both red-team AND judge were skipped. This was wrong — the judge is needed to verify the security findings are not hallucinated. Fixed: only red-team is skipped on security fail. Judge always runs.

**Configurable tier weights:** `config.tierWeights` (security/quality/standards weighting) is applied in `verdict/scoring.ts`. Admin can bias the score toward security strictness or quality strictness independently.

**Actionable fix suggestions:** The verdict report renderer now includes per-finding `fix` field if provided by the expert.

---

## Bug Fixes (from Code Review on PR #2)

Five bugs were found by automated code review and fixed before merge:

### 1. Dead code: `buildMinimalJudgeResult`
The function was left over from the old short-circuit logic (where judge was skipped on security fail). Now that judge always runs, the function was dead. Removed entirely along with its unused imports (`VerifiedFinding`, `FinalDimensionScore`).

### 2. `phaseDurations.verdict` always 0
`buildStats` was called before `phaseDurations.verdict` was set. Since `buildStats` returns `phaseDurations` by reference, the value would update — but `computeVerdict` was called between the two, so the copy stored inside the verdict had `verdict: 0`. Fixed by explicitly setting `stats.phaseDurations.verdict` after timing.

### 3. Expert `OUTPUT_SCHEMA` missing `confidenceInterval`
The JSON schema injected into expert system prompts did not include the `confidenceInterval` field. Since the LLM only produces fields it's told to produce, every expert dimension would have `confidenceInterval: undefined` at runtime, violating the `DimensionScore` type. Fixed by adding the field to `OUTPUT_SCHEMA`.

### 4. `searchCode` silent 50-result cap
After extracting `buildSearchCodeTool` to `shared-tools.ts`, the judge's `searchCode` silently inherited a 50-result cap. Previously the judge had unlimited results. The fix: keep the cap (for context window reasons) but append a truncation notice when results are cut, so the agent knows to narrow its search.

### 5. `latestUpdate` using non-existent `createdAt` on pattern rows
`loadKnowledgeBase` spread both `standardRows` and `patternRows` and checked `'createdAt' in r`. The `reviewerPatterns` schema has no `createdAt` column — only `lastSeen`. So every pattern row silently fell back to `new Date(0)` (epoch), making `knowledgeBase.updatedAt` wrong when patterns exist but standards don't. Fixed to use `r.lastSeen` for pattern rows.

---

## File Map

```
packages/pipeline/src/reviewer-agent/
├── create-review-agent.ts          NEW — shared agent factory for all 5 agents
├── shared-tools.ts                 NEW — tool builders shared across expert/red-team/judge
├── orchestrator.ts                 MODIFIED — timeout/retry, always-run judge, phaseDurations fix
├── types.ts                        MODIFIED — now a barrel re-exporting types/
├── types/
│   ├── index.ts                    NEW — barrel
│   ├── config.ts                   NEW — ReviewerConfig, DimensionConfig
│   ├── dimensions.ts               NEW — DIMENSIONS array (10 dimensions)
│   ├── learning.ts                 NEW — knowledge base types
│   ├── phases.ts                   NEW — per-phase I/O types + ConfidenceInterval
│   └── results.ts                  NEW — ReviewVerdict, ReviewStats, ReviewCost
├── experts/
│   ├── prompts.ts                  MODIFIED — full prompt rewrite + OUTPUT_SCHEMA fix
│   ├── tools.ts                    MODIFIED — delegates to shared-tools, adds 3 new tools
│   ├── quality-expert.ts           MODIFIED — uses agent factory
│   ├── security-expert.ts          MODIFIED — uses agent factory
│   └── standards-expert.ts        MODIFIED — uses agent factory
├── red-team/
│   ├── prompts.ts                  MODIFIED — full prompt rewrite
│   ├── tools.ts                    MODIFIED — delegates to shared-tools
│   └── index.ts                    MODIFIED — uses agent factory
├── judge/
│   ├── prompts.ts                  MODIFIED — full prompt rewrite
│   ├── tools.ts                    MODIFIED — delegates to shared-tools
│   └── index.ts                    MODIFIED — uses agent factory
├── learning/
│   └── index.ts                    MODIFIED — latestUpdate fix (lastSeen for patterns)
└── verdict/
    ├── scoring.ts                  MODIFIED — confidence intervals, tier weights
    └── report-renderer.ts         MODIFIED — fix suggestions in report
```

---

## Test Coverage

252 unit tests passing. Tests updated to reflect:
- Judge always runs on security fail (only red-team is skipped)
- Expert tools count: 9 (added `analyzeComponent`, `getComponentContext`, `searchAST`)
- `searchCode` empty result message: `'No matches found'` (consistent with shared-tools)
- `readFile` not-found message: `'File not found: ...'` (consistent with shared-tools)
