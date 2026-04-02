# Reviewer Agent Implementation Plan

> **For agentic workers:** Each sub-feature runs as an independent Ralph Loop in its own git worktree. Each PROMPT.md is self-contained. Shared types are committed to main before worktrees branch.

**Goal:** Replace the single-LLM-call security scan + quality review with a 5-phase orchestrated reviewer agent (static analysis, parallel experts, red-team, judge, verdict) with 10-dimension scoring, continuous learning, and admin cost control.

**Architecture:** Orchestrator pattern with parallel sub-agent dispatch. Each phase is its own module in `packages/pipeline/src/reviewer-agent/`. Shared interfaces in `reviewer-agent/types.ts`. The orchestrator is a single `StageFunction` that wires all phases.

**Tech Stack:** TypeScript, Anthropic SDK (`@cslate/llm`), TypeScript compiler API (for AST), pg-boss (queue), Drizzle ORM (DB), Zod (validation)

**Reference:** `/Users/tomerast/Downloads/Slate/ref` for prompt engineering patterns, agent loop structure, and tool definitions.

**Design Spec:** `docs/superpowers/specs/2026-04-02-reviewer-agent-design.md`

---

## Dependency Graph

```
                    ┌─────────────────┐
                    │  Shared Types   │  ← committed to main FIRST
                    │  (on main)      │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
     ┌──────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
     │ Wave 1a     │  │ Wave 1b    │  │ Wave 1c     │
     │ Static      │  │ Learning   │  │ Cost        │
     │ Analysis    │  │ System     │  │ Control     │
     │ (Phase 1)   │  │ (DB+types) │  │ (config)    │
     └──────┬──────┘  └─────┬──────┘  └──────┬──────┘
            │                │                │
            ▼                │                │
     ┌─────────────────────────────────────────┐
     │              Wave 2 (parallel)           │
     │  ┌──────────┐ ┌──────────┐ ┌──────────┐│
     │  │Expert    │ │Red-Team  │ │Judge +   ││
     │  │Agents    │ │Agent     │ │Verdict   ││
     │  │(Phase 2) │ │(Phase 3) │ │(Phase 4-5)│
     │  └──────────┘ └──────────┘ └──────────┘│
     └──────────────────┬──────────────────────┘
                        │
                 ┌──────▼──────┐
                 │ Wave 3      │
                 │ Orchestrator│
                 │ (wires all) │
                 └─────────────┘
```

**However**, all Ralph loops can start simultaneously because:
- Shared types are on main before any worktree branches
- Each loop builds against the shared interfaces
- Integration happens in the Orchestrator (Wave 3)

---

## Worktree Assignments

| # | Branch | Ralph Loop | Directory | Est. Complexity |
|---|--------|-----------|-----------|-----------------|
| 1 | `feat/reviewer-static-analysis` | Static Analysis Engine | `packages/pipeline/src/reviewer-agent/static/` | Medium |
| 2 | `feat/reviewer-expert-agents` | Expert Agent Framework + 3 Agents | `packages/pipeline/src/reviewer-agent/experts/` | High |
| 3 | `feat/reviewer-red-team` | Adversarial Red-Team Agent | `packages/pipeline/src/reviewer-agent/red-team/` | Medium |
| 4 | `feat/reviewer-judge-verdict` | Judge Agent + Verdict Synthesis | `packages/pipeline/src/reviewer-agent/judge/` + `verdict/` | Medium-High |
| 5 | `feat/reviewer-learning` | Learning System + DB Schema | `packages/pipeline/src/reviewer-agent/learning/` + DB migrations | Medium |
| 6 | `feat/reviewer-cost-control` | Admin Config + Queue Rate Limiting | `packages/pipeline/src/reviewer-agent/config/` + queue changes | Low-Medium |
| 7 | `feat/reviewer-orchestrator` | Orchestrator + Runner Integration | `packages/pipeline/src/reviewer-agent/orchestrator.ts` | Medium |

---

## File Structure (Final Merged State)

```
packages/pipeline/src/
├── reviewer-agent/
│   ├── types.ts                    # SHARED - all interfaces (committed to main first)
│   ├── orchestrator.ts             # Phase orchestrator (worktree 7)
│   ├── static/                     # Phase 1 (worktree 1)
│   │   ├── index.ts                # runStaticAnalysis() entry point
│   │   ├── security-scanner.ts     # Enhanced pattern matching
│   │   ├── credential-detector.ts  # Secret/key detection
│   │   ├── url-validator.ts        # Tier 1/2/3 URL classification
│   │   ├── tailwind-checker.ts     # Design token enforcement
│   │   ├── ast-analyzer.ts         # TypeScript AST structural analysis
│   │   ├── type-checker.ts         # tsc --noEmit integration
│   │   ├── import-validator.ts     # Import resolution + circular dep detection
│   │   └── dead-code-detector.ts   # Unused exports, unreachable branches
│   ├── experts/                    # Phase 2 (worktree 2)
│   │   ├── index.ts                # runExpertAgents() - parallel dispatch
│   │   ├── agent-loop.ts           # Shared agent loop engine
│   │   ├── tools.ts                # Tool definitions for expert agents
│   │   ├── security-expert.ts      # Dimensions 1-3
│   │   ├── quality-expert.ts       # Dimensions 4-7
│   │   └── standards-expert.ts     # Dimensions 8-10
│   ├── red-team/                   # Phase 3 (worktree 3)
│   │   ├── index.ts                # runRedTeam() entry point
│   │   ├── attack-vectors.ts       # Attack vector definitions
│   │   ├── platform-spec.ts        # Bridge API + sandbox constraints
│   │   └── prompts.ts              # Adversarial system prompts
│   ├── judge/                      # Phase 4 (worktree 4)
│   │   ├── index.ts                # runJudge() entry point
│   │   ├── verifier.ts             # Anti-hallucination verification
│   │   ├── deduplicator.ts         # Cross-agent dedup
│   │   └── conflict-resolver.ts    # Conflicting findings resolution
│   ├── verdict/                    # Phase 5 (worktree 4)
│   │   ├── index.ts                # computeVerdict() + renderReport()
│   │   ├── scoring.ts              # Weighted scoring formula
│   │   └── report-renderer.ts      # Markdown report generator
│   ├── learning/                   # Learning system (worktree 5)
│   │   ├── index.ts                # Knowledge base loader
│   │   ├── outcome-recorder.ts     # Record review outcomes
│   │   ├── distillation.ts         # Weekly standards distillation job
│   │   └── knowledge-injector.ts   # Inject knowledge into agent prompts
│   └── config/                     # Cost control (worktree 6)
│       ├── index.ts                # getReviewerConfig()
│       ├── rate-limiter.ts         # Enqueue-time rate limiting
│       └── cost-tracker.ts         # LLM cost tracking per review
│
├── stages/                         # Existing (modified)
│   ├── 1-manifest-validation.ts    # UNCHANGED
│   ├── 2-security-scan.ts          # DEPRECATED (replaced by reviewer-agent)
│   ├── 3-dependency-check.ts       # UNCHANGED → renumbered to stage 2
│   ├── 4-quality-review.ts         # DEPRECATED (replaced by reviewer-agent)
│   ├── 5-test-render.ts            # DEPRECATED (moved into reviewer-agent Phase 1)
│   ├── 6-cataloging.ts             # UNCHANGED → renumbered to stage 4
│   └── 7-embedding.ts              # UNCHANGED → renumbered to stage 5
│
├── runner.ts                       # MODIFIED - new stage order (worktree 7)
└── types.ts                        # UNCHANGED (reviewer-agent has its own types)

packages/db/
├── schema/
│   ├── reviewer-standards.ts       # NEW (worktree 5)
│   ├── reviewer-patterns.ts        # NEW (worktree 5)
│   ├── review-outcomes.ts          # NEW (worktree 5)
│   ├── review-corrections.ts       # NEW (worktree 5)
│   ├── reviewer-dimension-weights.ts # NEW (worktree 5)
│   └── reviewer-config.ts          # NEW (worktree 6)
└── migrations/
    └── XXXX-reviewer-tables.sql    # NEW (worktree 5+6)

packages/queue/src/
├── jobs.ts                         # MODIFIED - new enqueue logic (worktree 6)
└── reviewer-enqueue.ts             # NEW - rate-limited enqueue (worktree 6)

apps/worker/src/
└── handlers/
    └── review.ts                   # MODIFIED - use new reviewer agent (worktree 7)
```

---

## Shared Types Contract

Committed to main BEFORE any worktree branches. This is the interface agreement that all Ralph loops build against. See `packages/pipeline/src/reviewer-agent/types.ts` (created separately).

---

## Ralph Loop Launch Order

All loops can start simultaneously since they build against shared types. But if resources are limited, prioritize:

**Priority 1 (start immediately):**
- Loop 1: Static Analysis — foundation for everything
- Loop 2: Expert Agents — most complex, needs most time
- Loop 5: Learning System — independent, DB schema needed early

**Priority 2 (start after 1-2 iterations of Loop 1):**
- Loop 3: Red-Team — benefits from seeing static analysis patterns
- Loop 4: Judge + Verdict — benefits from seeing expert agent patterns
- Loop 6: Cost Control — independent but simpler

**Priority 3 (start after all others have initial commits):**
- Loop 7: Orchestrator — wires everything, needs to see real implementations

---

## Per-Worktree PROMPT.md Files

Each worktree gets a self-contained `PROMPT.md` at its root. These are created alongside the worktrees. Each prompt contains:
- What to build (scope)
- Interface contracts (from shared types)
- File structure
- TDD approach with test commands
- Success criteria
- Reference to spec and Slate/ref for patterns
- Completion promise tag

---

## Merge Strategy

See `docs/superpowers/plans/2026-04-02-reviewer-agent-merge-orchestration.md` for the full merge guide including:
- Merge order (respects dependency graph)
- Conflict resolution strategy
- Integration test plan
- Deep review checklist per worktree
