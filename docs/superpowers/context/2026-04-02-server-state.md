# CSlate Server — State of the Codebase (2026-04-02)

**Author:** Tomer + Claude  
**Status:** Living document — update as phases complete

---

## What This Server Is

CSlate Server is the backend for an AI-powered component marketplace. It receives uploaded components (UI widgets, data pipeline nodes) from the Electron client, runs them through a multi-stage AI review pipeline, and stores approved components in a shared searchable database.

**Repo:** `tomerast/CSlate-server`  
**Architecture:** Hono API server + BullMQ worker in a pnpm monorepo  
**Language:** TypeScript everywhere  
**Database:** PostgreSQL with pgvector, via Drizzle ORM

---

## Package Structure

```
packages/
  api/         — Hono HTTP server, all routes
  worker/      — BullMQ job handlers (pipeline execution)
  pipeline/    — All pipeline stage logic (the core)
  db/          — Drizzle schema + queries + migrations
  queue/       — BullMQ job definitions and enqueueing helpers
  llm/         — Thin Anthropic wrapper (@cslate/llm)
  storage/     — Cloudflare R2 upload/download helpers
apps/          — (reserved for future app entrypoints)
```

---

## What Is Built and Working

### API (`packages/api`)

- `POST /upload` — accepts component zip, validates manifest, enqueues pipeline job
- `GET /components` — search/browse approved components (full-text + vector similarity)
- `GET /components/:id` — single component detail
- `GET /components/:id/download` — signed R2 download URL
- `GET /pipelines` — list pipeline runs
- `GET /pipelines/:id` — pipeline run detail
- `POST /admin/reviewer-config` — update reviewer agent settings

Authentication strategy is designed (see `docs/decisions/004`) but not yet implemented in routes — all endpoints are currently unauthenticated.

### Worker (`apps/worker`)

- BullMQ consumer for `component-review` and `pipeline-review` queues
- Delegates to `packages/pipeline` stages
- Progress callbacks feed back to job metadata

### Pipeline Stages (`packages/pipeline`)

**Component review pipeline** (the main one — for UI components):

| Stage | File | Status |
|-------|------|--------|
| 1. Manifest validation | `src/stages/1-manifest-validation.ts` | Working |
| 2. Security scan (legacy) | `src/stages/2-security-scan.ts` | Working (replaced by reviewer agent) |
| 3. Dependency check | `src/stages/3-dependency-check.ts` | Working |
| 4. Quality review (legacy) | `src/stages/4-quality-review.ts` | Working (replaced by reviewer agent) |
| 5. Test render | `src/stages/5-test-render.ts` | Stub — no sandbox yet |
| 6. Embedding generation | `src/stages/6-embedding.ts` | Working |
| **Reviewer Agent** | `src/reviewer-agent/` | **See below** |

**Pipeline review pipeline** (for data pipeline nodes):

| Stage | File | Status |
|-------|------|--------|
| 1. Manifest validation | `src/pipeline-stages/1-manifest-validation.ts` | Working |
| 2. Security scan | `src/pipeline-stages/2-security-scan.ts` | Working |
| 3. Dependency check | `src/pipeline-stages/3-dependency-check.ts` | Working |
| 4. Quality review | `src/pipeline-stages/4-quality-review.ts` | Working |
| 5. Cataloging | `src/pipeline-stages/5-cataloging.ts` | Working |
| 6. Embedding | `src/pipeline-stages/6-embedding.ts` | Working |

---

## The Reviewer Agent (`packages/pipeline/src/reviewer-agent/`)

This is the most significant new system. It's a multi-phase AI agent pipeline that replaces the old single-LLM security/quality stages for component review.

### Architecture

```
Component files + manifest
         │
         ▼
┌─────────────────────┐
│  Phase 1: Static    │  — No LLM. Pattern matching, AST parsing,
│  Analysis           │    TypeScript type checking.
└────────┬────────────┘
         │ If critical findings → short-circuit reject
         ▼
┌─────────────────────┐
│  Phase 2: Expert    │  — 3 parallel LLM agents (Sonnet/Haiku)
│  Agents (parallel)  │    Security, Quality, Standards experts
└────────┬────────────┘
         │ If security tier fails → skip red-team + judge
         ▼
┌─────────────────────┐
│  Phase 3: Red-Team  │  — Adversarial LLM agent. Actively tries
│  Agent              │    to find exploits, exfiltration, injection
└────────┬────────────┘
         ▼
┌─────────────────────┐
│  Phase 4: Judge     │  — Anti-hallucination verifier. Confirms
│  Agent              │    each expert finding against actual code.
└────────┬────────────┘
         ▼
┌─────────────────────┐
│  Phase 5: Verdict   │  — Weighted scorecard across 10 dimensions.
│  + Report           │    Decision + markdown report.
└─────────────────────┘
```

### Sub-module Status

| Module | Path | Status |
|--------|------|--------|
| Static analysis orchestrator | `static/index.ts` | **Done** |
| Pattern matcher | `static/pattern-matcher.ts` | **Done** |
| AST parser | `static/ast-parser.ts` | **Done** |
| Type checker | `static/type-checker.ts` | **Done** |
| Dependency analyzer | `static/dependency-analyzer.ts` | **Done** |
| Expert agents orchestrator | `experts/index.ts` | **Done** |
| Security expert agent | `experts/security-expert.ts` | **Done** |
| Quality expert agent | `experts/quality-expert.ts` | **Done** |
| Standards expert agent | `experts/standards-expert.ts` | **Done** |
| Expert tools | `experts/tools.ts` | **Done** |
| Expert prompts | `experts/prompts.ts` | **Done** |
| Red-team agent | `red-team/index.ts` | **Done** |
| Red-team tools | `red-team/tools.ts` | **Done** |
| Red-team prompts | `red-team/prompts.ts` | **Done** |
| Attack vectors reference | `red-team/attack-vectors.ts` | **Done** |
| Platform spec | `red-team/platform-spec.ts` | **Done** |
| Judge agent | `judge/index.ts` | **Done** |
| Judge tools | `judge/tools.ts` | **Done** |
| Judge prompts | `judge/prompts.ts` | **Done** |
| Verdict scoring | `verdict/scoring.ts` | **Done** |
| Report renderer | `verdict/report-renderer.ts` | **Done** |
| Reviewer config (DB) | `config/index.ts` | **Done** |
| Cost tracker (DB) | `config/cost-tracker.ts` | **Done** |
| Rate limiter | `config/rate-limiter.ts` | **Done** (delegates to `@cslate/queue`) |
| Registry helper | `config/registry.ts` | **Done** |
| Knowledge base loader | `learning/index.ts` | **Partial** — loads empty stub; DB query not wired |
| Outcome recorder | `learning/outcome-recorder.ts` | **Done** |
| Knowledge injector | `learning/knowledge-injector.ts` | **Done** |
| Distillation | `learning/distillation.ts` | **Done** (logic complete, not scheduled) |
| Orchestrator | `orchestrator.ts` | **Done** |

### The 10-Dimension Scorecard

| # | Dimension | Tier | Expert |
|---|-----------|------|--------|
| 1 | Malicious Intent | Security | Security |
| 2 | Code Injection / Sandbox Escape | Security | Security |
| 3 | Credential Handling | Security | Security |
| 4 | Architecture & Design | Quality | Quality |
| 5 | Functionality & Correctness | Quality | Quality |
| 6 | Types & Interfaces | Quality | Quality |
| 7 | Performance | Quality | Quality |
| 8 | Readability & Maintainability | Standards | Standards |
| 9 | Accessibility | Standards | Standards |
| 10 | Manifest Accuracy | Standards | Standards |

Scoring: Security tier weight 3x, Quality 2x, Standards 1x.

---

## Database Schema (`packages/db`)

### Core tables (existing)
- `users` — user accounts
- `components` — approved components with metadata + pgvector embedding
- `uploads` — upload events (pending → reviewed → approved/rejected)
- `checkpoints` — pipeline stage results per upload
- `ratings` — user ratings on components
- `reports` — abuse reports
- `rate_limits` — per-user API rate limiting
- `download_events` — download analytics
- `pipelines` — data pipeline definitions
- `pipeline_uploads` — pipeline upload events

### Reviewer agent tables (new)
- `reviewer_config` — singleton admin config (max cost/day, model overrides, thresholds)
- `review_costs` — per-phase LLM cost tracking
- `review_outcomes` — final verdict per upload (for learning)
- `review_corrections` — human override of verdicts (for learning signal)
- `reviewer_standards` — distilled code standards (grows over time)
- `reviewer_patterns` — learned bad patterns (grows over time)
- `reviewer_dimension_weights` — per-dimension weight overrides
- `reviewer_knowledge_versions` — knowledge base versioning

---

## What Is NOT Done Yet

### High Priority

1. **Authentication** — JWT middleware and per-user identity on all routes is designed (`docs/decisions/004`) but not wired into route handlers. All endpoints are currently unprotected.

2. **Knowledge base loading** — `learning/index.ts::loadKnowledgeBase()` returns an empty stub. The DB query to load `reviewer_standards`, `reviewer_patterns`, and `reviewer_dimension_weights` into the knowledge base is not implemented. This means expert agents don't yet get the benefit of accumulated learning.

3. **Distillation scheduling** — `learning/distillation.ts::runDistillation()` exists and is correct, but is never called. Needs a BullMQ cron job to run it periodically (e.g., daily) to accumulate learned patterns from past reviews.

4. **Test render stage** — `stages/5-test-render.ts` is a stub. Requires Electron sandbox integration from the client side — out of scope until client-server communication is wired.

5. **Review corrections UI** — The `review_corrections` table exists, and human overrides of verdicts would feed into learning, but there's no admin API endpoint to submit corrections.

### Medium Priority

6. **Reviewer agent integration into the component pipeline** — `packages/pipeline/src/reviewer-agent/orchestrator.ts` exists and is complete, but the main component review pipeline (`src/pipeline-runner.ts`) currently still calls the old stages 2 (security scan) and 4 (quality review). The reviewer agent is not yet plugged in as the canonical stage. Decision: whether to fully replace or run in parallel for comparison first.

7. **`@cslate/shared/agent` — `AgentRegistry` with user-configurable LLM provider** — The current `config/registry.ts` always creates an Anthropic registry from `ANTHROPIC_API_KEY`. The design intent is that users can configure their own LLM provider (Anthropic, OpenAI, Google, local Ollama) via the client settings. This provider config needs to flow through `ReviewerConfig` or `PipelineContext`.

8. **Vector search tuning** — Embeddings are generated and stored, but the similarity search threshold and reranking strategy haven't been tuned with real data.

9. **R2 storage — component file serving** — Uploads are stored but the signed download URL expiry and CDN caching strategy are not configured.

### Lower Priority

10. **Admin dashboard routes** — `POST /admin/reviewer-config` is defined but there's no GET endpoint, no audit log, and no rate-limit admin controls.

11. **`review_corrections` learning loop** — Once human corrections are submitted, `distillation.ts` doesn't yet incorporate them into the standards/patterns tables. This is a natural next step after distillation scheduling.

12. **Multi-model routing** — The reviewer config has `modelOverrides` per expert, but the system always defaults to Anthropic Sonnet. The intent to support OpenAI/Google for individual agents isn't wired to any UI or config surface yet.

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `packages/pipeline/src/reviewer-agent/types.ts` | Central type contract for the entire reviewer agent — all types, defaults, dimension list |
| `packages/pipeline/src/reviewer-agent/orchestrator.ts` | The top-level reviewer agent runner — calls all 5 phases in order |
| `packages/pipeline/src/reviewer-agent/static/pattern-matcher.ts` | 12 critical + 10 warning security patterns applied without LLM |
| `packages/pipeline/src/reviewer-agent/experts/prompts.ts` | System prompts for all 3 expert agents |
| `packages/pipeline/src/reviewer-agent/red-team/platform-spec.ts` | Bridge API spec and sandbox constraints — given to red-team agent as context |
| `packages/db/src/schema/reviewer-config.ts` | Reviewer config + review costs DB schema |
| `packages/queue/src/reviewer-enqueue.ts` | Rate-limited component review enqueue logic |
| `docs/superpowers/specs/2026-04-02-reviewer-agent-design.md` | Full design spec for the reviewer agent |
| `docs/decisions/003-review-agent-pipeline.md` | ADR: why we chose this multi-agent architecture |

---

## Test Coverage

As of 2026-04-02: **252 tests passing** across 25 test files in `packages/pipeline`.

Key test suites:
- `static/__tests__/` — pattern matching, AST parsing, type checking, full integration
- `experts/__tests__/` — security expert agent, tool definitions, parallel execution
- `red-team/__tests__/` — attack vectors, tools, adversarial agent integration
- `judge/__tests__/` — verification tools, judge agent integration
- `verdict/__tests__/` — scoring algorithm, report rendering
- `config/__tests__/` — cost tracking, config DB queries, rate limiter
- `learning/__tests__/` — outcome recording, knowledge injection, distillation

---

## Infrastructure Notes

- **Module resolution:** `packages/pipeline` uses `moduleResolution: Node` (CommonJS) with a `paths` alias for `@cslate/shared/agent` to resolve the subpath export. Both `tsconfig.json` and `vitest.config.ts` need this alias — both are set correctly.
- **`@cslate/db` build:** The DB package must be built before `@cslate/pipeline` type-checks against it. Run `pnpm --filter @cslate/db build` after schema changes.
- **`@cslate/queue` build:** Same pattern — needs `pnpm --filter @cslate/queue build` if `reviewer-enqueue.ts` changes.
- **`noUncheckedIndexedAccess: true`** is on globally — some test files have unchecked array access warnings (pre-existing, not runtime errors).
