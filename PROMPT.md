# Reviewer Agent Overhaul — Ralph Loop Prompt

You are iteratively improving the CSlate reviewer agent pipeline. Each iteration you will assess the current state, pick the highest-impact improvement, execute it, verify it compiles, and commit. You see your own previous work in the files and git history — use `git log --oneline -20` and `git diff HEAD~1` to understand what you already did. Do NOT repeat work from prior iterations.

## Goal

Transform the reviewer agent from a working prototype into a **production-grade, best-in-class AI code review system**. The agent reviews user-submitted UI components for security, quality, and standards compliance using a 5-phase pipeline with parallel LLM agents.

## Project Layout

```
packages/pipeline/src/reviewer-agent/
├── orchestrator.ts          # Main 5-phase pipeline entry point
├── types.ts                 # All type definitions (675 lines)
├── index.ts                 # Re-exports
├── static/                  # Phase 1: Pattern matching, AST, type checking
│   ├── pattern-matcher.ts
│   ├── ast-parser.ts
│   ├── type-checker.ts
│   ├── dependency-analyzer.ts
│   └── index.ts
├── experts/                 # Phase 2: Parallel LLM expert agents
│   ├── security-expert.ts
│   ├── quality-expert.ts
│   ├── standards-expert.ts
│   ├── prompts.ts           # System prompts for all 3 experts
│   ├── tools.ts             # Shared agent tools
│   └── index.ts
├── red-team/                # Phase 3: Adversarial attack simulation
│   ├── attack-vectors.ts
│   ├── platform-spec.ts
│   ├── prompts.ts
│   ├── tools.ts
│   └── index.ts
├── judge/                   # Phase 4: Anti-hallucination verification
│   ├── prompts.ts
│   ├── tools.ts
│   └── index.ts
├── verdict/                 # Phase 5: Scoring and report rendering
│   ├── scoring.ts
│   └── report-renderer.ts
├── config/                  # Configuration, cost tracking, rate limiting
│   ├── index.ts
│   ├── cost-tracker.ts
│   ├── registry.ts
│   └── rate-limiter.ts
└── learning/                # Learning system (partially stubbed)
    ├── index.ts
    ├── outcome-recorder.ts
    ├── knowledge-injector.ts
    └── distillation.ts
```

## Reference Architecture

Study `/Users/tomerast/Downloads/Slate/ref/src` for patterns to adopt:

### What to learn from the reference:
1. **Tool definitions** — Reference uses Zod schemas, `isConcurrencySafe`, `isReadOnly`, `isDestructive` classification, `searchHint` for discoverability. Our tools in `experts/tools.ts`, `red-team/tools.ts`, `judge/tools.ts` should adopt similar rigor.
2. **Prompt architecture** — Reference layers prompts: static cached base + dynamic input-aware descriptions + tool-specific instructions. Our prompts in `experts/prompts.ts`, `red-team/prompts.ts`, `judge/prompts.ts` should be structured, not monolithic blobs.
3. **Agent definitions** — Reference defines `whenToUse`, `tools` allowlist, `disallowedTools`, `maxTurns`, `criticalSystemReminder`. Our expert/red-team/judge agent configs should be equally explicit.
4. **Error handling** — Reference validates at boundaries with Zod, wraps tool execution in try-catch with structured errors. Our tools lack input validation.
5. **Orchestration** — Reference partitions tool calls into read-only (concurrent) vs write (serial) batches. Our orchestrator should be similarly thoughtful about concurrency.

### What NOT to copy:
- UI rendering (we have no terminal UI)
- Permission system (not applicable)
- MCP integration (not applicable)
- React/ink components (not applicable)

## Iteration Priorities

Work through these in order of impact. Each iteration should tackle ONE focused improvement. Do not try to do everything at once.

### Priority 1: Dead Code & Stub Cleanup
- [x] `learning/index.ts` — `loadKnowledgeBase()` returns empty KB with TODO comment. Either implement it properly (wire up DB queries for `reviewerStandards`, `reviewerPatterns`, `reviewerDimensionWeights` tables) or remove the pretense and make it explicitly a no-op with a clear comment about why
- [x] `config/rate-limiter.ts` — Single-line re-export file. Inline the import where it's used or justify the indirection *(kept: tests import from this path; removing would break test structure for no behavioral gain)*
- [x] Check all `index.ts` barrel files — remove any re-exports of things that don't exist or aren't used *(all barrel files verified clean)*
- [x] Find and remove any unused imports, unused variables, dead branches *(no unused imports found)*
- [x] Remove catch blocks that swallow errors silently (e.g., the `/* learning module not yet available */` catches in expert agents) — if the learning system isn't ready, don't pretend it might be

### Priority 2: Code Quality & Consistency
- [x] Tool definitions across `experts/tools.ts`, `red-team/tools.ts`, `judge/tools.ts` share ~70% code. Extract shared tool implementations into a common module, then compose phase-specific tool sets from it
- [ ] Type definitions in `types.ts` (675 lines) — split into logical groups: `dimensions.ts`, `phases.ts`, `config.ts`, `results.ts`
- [ ] Ensure consistent error handling: every tool should validate inputs and return structured errors, not throw raw exceptions
- [x] Standardize how agents are created — currently each expert/red-team/judge has slightly different setup. Create a shared `createReviewAgent(config)` factory
- [x] Remove magic numbers — extract constants for iteration limits, result caps (50 match limit in searchCode), confidence thresholds *(MAX_SEARCH_RESULTS in shared-tools.ts, MAX_OUTPUT_TOKENS in create-review-agent.ts; remaining magic numbers are config defaults already named in DEFAULT_REVIEWER_CONFIG)*

### Priority 3: Prompt Engineering (HIGHEST IMPACT)
This is where the real capability improvement lives. Study the reference prompts then rewrite ours.

- [x] **Security expert prompt** (`experts/prompts.ts`) — Rewritten with structured methodology (5-step), severity classification table, bridge API abuse patterns, shared output rules and schema
- [x] **Quality expert prompt** — Rewritten with architecture/correctness/type-safety/performance methodology, component-specific anti-patterns, severity classification table
- [x] **Standards expert prompt** — Rewritten with readability audit (naming, dead code, file size), accessibility audit (semantic HTML, ARIA, keyboard nav, color contrast), manifest verification steps
- [x] **Red-team prompt** (`red-team/prompts.ts`) — Rewritten with 4-phase exploitation methodology (recon → surface mapping → exploit → chain analysis), attack vector table with search patterns, feasibility classification with examples, threat level guide
- [x] **Judge prompt** (`judge/prompts.ts`) — Rewritten with explicit verification methodology, 4 calibration examples (hallucinated, wrong location, over-severity, real critical), scoring guide for dimension scores
- [x] **All prompts** — Applied reference patterns: structured hierarchical sections, critical rules sections, few-shot examples in judge, severity classification tables, shared output schema and rules extracted into helpers

### Priority 4: Agent Capability Improvements
- [x] Add a `analyzeComponent` tool that gives agents a high-level summary of what the component does (renders, state, effects, event handlers) so they don't waste iterations understanding basics
- [x] Add a `compareToManifest` tool that automatically diffs manifest claims against actual code behavior *(merged into analyzeComponent — it includes manifest vs code mismatch section)*
- [ ] Improve `searchCode` tool — add support for AST-aware searches (find all function calls to X, find all state mutations, find all effect dependencies)
- [ ] Add `getComponentContext` tool that extracts React-specific info: hooks used, props interface, render tree structure, event handlers
- [ ] Consider adding a `runInSandbox` tool concept for the red-team to actually test exploit attempts (even if simulated)

### Priority 5: Orchestration Improvements  
- [ ] Add timeout handling per phase — if an expert takes too long, gracefully degrade
- [ ] Improve short-circuit logic — current logic is binary (critical = skip). Add nuance: security criticals skip to verdict, but quality criticals still benefit from judge verification
- [ ] Add retry logic for transient LLM failures (rate limits, timeouts)
- [ ] Improve progress callbacks — report which specific agent is running, what phase, estimated completion
- [ ] Consider streaming partial results — don't wait for all experts to finish before showing early findings

### Priority 6: Scoring & Verdict
- [ ] Current weighted scoring (security=3x, quality=2x, standards=1x) is arbitrary. Add configuration and justification
- [ ] Verdict thresholds should be configurable per-deployment, not hardcoded
- [ ] Report renderer should include actionable fix suggestions, not just findings
- [ ] Add confidence intervals to scores, not just point estimates
- [ ] Consider a "suggestions" tier below "warnings" for style/preference items

## Rules

1. **One focused change per iteration.** Don't try to do multiple priorities in one pass.
2. **Verify compilation** after every change: `cd /Users/tomerast/Projects/CSlate-server && npx tsc --noEmit -p packages/pipeline/tsconfig.json`
3. **Run tests** if they exist for the files you changed: `npx vitest run --reporter=verbose packages/pipeline/src/reviewer-agent/`
4. **Commit each iteration** with a descriptive message: `git add -A && git commit -m "refactor(reviewer): <what you did>"`
5. **Read before writing.** Always read a file before modifying it. Understand existing code fully.
6. **Preserve behavior.** Dead code removal and cleanup should not change the pipeline's observable behavior. Prompt improvements should only improve quality, not break the output schema.
7. **Reference the Slate source.** When improving prompts or tool patterns, read relevant files from `/Users/tomerast/Downloads/Slate/ref/src` first to understand the pattern, then adapt (don't copy) for our context.
8. **Update this file.** After completing an item, check off the checkbox `[x]` so the next iteration knows what's done.
9. **Track progress.** At the top of each iteration, add a brief log entry to the Progress Log section below.

## Progress Log

<!-- Each iteration adds a line here: "Iteration N: <what was done>" -->
Iteration 1: Priority 1 — Wired up `loadKnowledgeBase()` to query real DB tables (reviewerStandards, reviewerPatterns, reviewerDimensionWeights), removed error-swallowing try/catch in all 3 expert agents replacing with direct imports of `injectKnowledge`, verified all barrel files and imports are clean. All 247 tests pass.
Iteration 2: Priority 2a — Extracted shared tools (readFile, listFiles, searchCode, getManifest) into `shared-tools.ts`, refactored all 3 tool files to compose from shared + phase-specific tools. All 247 tests pass.
Iteration 3: Priority 3 — Complete prompt engineering overhaul. Rewrote all 5 agent prompts (security, quality, standards, red-team, judge) with structured methodology, severity tables, few-shot examples, shared output schema, and critical rules sections. All 247 tests pass.
Iteration 4: Priority 2b — Created `create-review-agent.ts` factory, refactored all 5 agents (3 experts + red-team + judge) to use it. Extracted MAX_OUTPUT_TOKENS constant. All 247 tests pass.
Iteration 5: Priority 4a — Added `analyzeComponent` tool to shared-tools.ts leveraging Phase 1 AST data. Shows file overview, functions, bridge calls, DOM access, dynamic expressions, dependency issues, and manifest vs code mismatches. Added to expert and red-team tool sets. All 247 tests pass.

## When You're Done

When all priority items are checked off or you've made significant progress across all priorities, output:

<promise>REVIEWER AGENT OVERHAULED</promise>
