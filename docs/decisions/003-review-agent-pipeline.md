# Decision 003: Review Agent Pipeline — Full Deep Review

**Date:** 2026-03-28
**Status:** Accepted (updated: canonical stage names, TypeScript stub env, LLM cost analysis, incremental retry)

## Context

When a component is uploaded from the client to CSlate-Server, a review agent must validate it before it enters the shared community database. The shared DB is a **curated, high-quality library** — every component that enters must be perfect.

## Decision: Full Deep Review (Level C)

**Every component undergoes a comprehensive, multi-stage review before it is discoverable by other users.** No shortcuts. No "good enough." The shared DB is the crown jewel of CSlate.

## Canonical Stage Names

These names are the contract between client and server (defined in `@cslate/shared`):

```typescript
type ReviewStage =
  | 'manifest_validation'    // Fast — Zod + file structure + TypeScript shape
  | 'security_scan'          // Fast + LLM — static analysis + obfuscation detection
  | 'dependency_check'       // Fast — npm allowlist + CSlate dep existence
  | 'quality_review'         // LLM — code quality + context + dataSources + bridge usage
  | 'test_render'            // Fast — TypeScript compilation (no headless browser)
  | 'cataloging'             // LLM — summary, category, ai hints, tag enrichment
  | 'embedding'              // Fast — vector generation + storage
```

## Review Pipeline Stages

### Stage 1: `manifest_validation` (no LLM)
Automated checks:
- `manifest.json` is valid JSON, parses against `@cslate/shared` `ComponentManifest` Zod schema
- All files declared in `manifest.files[]` exist in the uploaded package
- File naming conventions: `ui.tsx`, `logic.ts`, `types.ts`, `context.md`, `index.ts`
- `manifest.name`, `manifest.description`, `manifest.tags[]` are non-empty
- `manifest.defaultSize` and `manifest.minSize` are positive integers (Decision 013)
- `manifest.dataSources[].baseUrl` is present if dataSources are declared

**Outcome:** Reject immediately with field-level Zod errors. Client AI can auto-fix and re-upload.

### Stage 2: `security_scan` (static analysis + LLM)
**Static patterns (regex scan on all .ts/.tsx files):**

Blocked patterns:
```
fetch(               → use bridge.fetch() only
XMLHttpRequest       → blocked
new WebSocket(       → use bridge.subscribe() only
navigator.sendBeacon → blocked
new EventSource(     → blocked
eval(                → blocked
new Function(        → blocked
Function(            → blocked
document.cookie      → blocked
localStorage         → blocked
sessionStorage       → blocked
window.fetch         → blocked
globalThis.fetch     → blocked
require("child_process") → blocked
require("fs")        → blocked
import("electron"    → blocked
innerHTML            → blocked (dynamic content risk)
```

Allowed network patterns:
```
bridge.fetch(        → ✓ declared data source only
bridge.subscribe(    → ✓ declared data source only
bridge.getConfig(    → ✓ user config access
```

**URL validation (`dataSources[].baseUrl`):**
- Tier 1 (known-safe domains): auto-approve, faster review
- Tier 2 (unknown): LLM judges legitimacy, approve-with-flag if likely legitimate
- Tier 3 (blocked): `localhost`, IP addresses, `file://`, internal network ranges (10.x, 192.168.x, 172.16-31.x) → auto-reject

**LLM review (obfuscation detection):**
- Variable aliasing to build `fetch`: `const f = window['fet' + 'ch']`
- Dynamic property access: `window[atob('ZmV0Y2g=')]`
- Eval-based bypass: `eval('fe' + 'tch("...")')`
- Hidden behavior not matching component's stated purpose
- Hardcoded sensitive values (API keys, tokens)

**Outcome:** Reject with structured issue list `{ severity, file, line, pattern, message, fix }`.

### Stage 3: `dependency_check` (no LLM)
- Validate `dependencies.npmPackages` against allowlist (`packages/pipeline/config/npm-allowlist.json`)
- Flag unknown npm packages (warning, not rejection — requires manual review)
- Check for known vulnerable package versions (via `packages/pipeline/config/npm-blocklist.json`)
- Validate `dependencies.cslateComponents[]` IDs exist in DB and have `approved` status
- Missing CSlate dependencies → listed in `missingDependencies[]`, not a hard rejection

**Outcome:** Reject on known-malicious packages only. Warn on unknown packages.

### Stage 4: `quality_review` (LLM)
Deep code review covering:
- **UI/Logic separation**: business logic in `logic.ts`, not `ui.tsx`
- **Type safety**: types in `types.ts`, no untyped `any`, no type assertions without comments
- **Tailwind usage**: semantic tokens (`bg-primary`, `text-muted`) NOT hardcoded (`bg-blue-500`) — per Decision 008
- **Manifest accuracy**: declared `inputs`, `outputs`, `events`, `actions` match actual code
- **Context alignment**: does `context.md` describe what the code actually does?
- **dataSources integrity**: every `bridge.fetch(sourceId, ...)` matches a declared `dataSources` entry; no undeclared sources accessed
- **userConfig**: sensitive fields accessed only via `bridge.getConfig()`, never hardcoded in source
- **Accessibility**: semantic HTML, ARIA labels where appropriate
- **Clean code**: no dead code, commented-out blocks, console.logs, TODO/FIXME

**Outcome:** Fail on major issues. Warn on minor suggestions. LLM provides specific, actionable feedback per issue.

### Stage 5: `test_render` (no headless browser — TypeScript compilation only)
> **Note on naming:** "test_render" was the agreed client-contract name. In v1, this means TypeScript compilation — no headless browser rendering. Browser rendering test is deferred to v2.

**TypeScript compilation environment:**
To typecheck CSlate components, we provide a minimal type stub environment:

```typescript
// packages/pipeline/src/type-stubs/bridge.d.ts
declare const bridge: {
  fetch: (sourceId: string, endpointId: string, params?: Record<string, any>) => Promise<any>
  subscribe: (sourceId: string, endpointId: string, params: Record<string, any>, callback: (data: any) => void) => () => void
  getConfig: (key: string) => any
}
```

```typescript
// packages/pipeline/src/type-stubs/react-shim.d.ts
// Re-exports React types so components don't need to import React explicitly
```

Compilation steps:
1. Write uploaded files to a temp directory
2. Add bridge type stubs + tsconfig.json with `"jsx": "react-jsx"`, `"strict": true`
3. Run `tsc --noEmit`
4. Capture and return all TypeScript errors with file + line

**Outcome:** Reject on TypeScript errors. The client AI agent auto-fixes and re-uploads.

### Stage 6: `cataloging` (LLM)
LLM-generated metadata for discovery and AI agent use:
- Generate 1-2 sentence `summary` for display in search results
- Assign `category` and `subcategory` from the taxonomy
- Estimate `complexity` (simple/moderate/complex) based on code analysis
- Generate `contextSummary` from `context.md` — "why this was built"
- Generate `ai.modificationHints` — specific, file-referencing guidance for future AI agents
- Generate `ai.extensionPoints` — named customization surfaces
- Verify/improve `description` for search clarity
- Verify/expand `tags` for comprehensive keyword coverage

**Always passes** — this is enrichment, not validation. If LLM fails (timeout, error), skip with warning and use submitted values.

### Stage 7: `embedding` (no LLM)
- Compose embedding input from:
  ```
  Component: {name}
  Description: {description}
  Tags: {tags.join(', ')}
  Summary: {summary}
  Context: {contextSummary}
  Data Sources: {dataSources[].description joined}
  Inputs: {inputs[].description joined}
  Outputs: {outputs[].description joined}
  ```
- Call OpenAI `text-embedding-3-small` (1536 dims)
- Compute `ai.similarTo` — top 5 nearest neighbors via pgvector
- Version detection: if same `name` + same `author_id` exists → set `parent_id` to existing component
- Insert into `components` table, update `uploads.component_id`

**Always passes** (storage errors surface as job failures, retried by pg-boss).

---

## Pipeline Flow

```
Upload → manifest_validation → security_scan → dependency_check
                                                      ↓
                                             quality_review
                                                      ↓
                                              test_render
                                                      ↓
                                              cataloging
                                                      ↓
                                              embedding → LIVE in shared DB
```

Early stages are fast/cheap (no LLM). Later stages are thorough/expensive (LLM).
If any stage fails, the pipeline stops and returns feedback to the client.

---

## Incremental Retry (Smart Resume)

When a job fails mid-pipeline (LLM timeout, transient error), pg-boss retries with exponential backoff. The worker checks `uploads.completed_stages` and **skips already-passed stages**.

Rules:
- Deterministic stages (manifest_validation, dependency_check, test_render): always re-run (cheap, fast)
- LLM stages (security_scan, quality_review, cataloging): skip if in `completed_stages` with `status: 'passed'`
- Embedding: always re-run (idempotent)

This avoids paying LLM costs twice for a transient network error.

---

## Rejection Handling

When a component is rejected:
1. Server stores stage results in `uploads.rejection_reasons` (JSONB array of `{stage, issues[]}`)
2. Client polls or receives via SSE stream
3. Client shows issues to user and/or has local AI auto-fix
4. Re-submission goes through full pipeline (incomplete stages not cached across submissions)

---

## LLM Cost Analysis

At scale, the pipeline makes 2-3 LLM calls per upload:
- Stage 2 (`security_scan`): ~500-2000 tokens input + ~300 output = ~$0.003 per upload (GPT-4o)
- Stage 4 (`quality_review`): ~3000-8000 tokens input + ~1000 output = ~$0.012 per upload
- Stage 6 (`cataloging`): ~2000-5000 tokens input + ~500 output = ~$0.007 per upload
- **Total: ~$0.022 per upload** (GPT-4o pricing)

| Daily uploads | Monthly LLM cost |
|---|---|
| 100 | ~$66 |
| 500 | ~$330 |
| 1,000 | ~$660 |
| 5,000 | ~$3,300 |

**Cost controls:**
- `teamConcurrency: 5` caps concurrent pipelines (prevents rate limit spikes)
- Rejected at Stage 1/2 (no LLM cost): structural/security failures are free to detect
- Use `claude-haiku-4-5` for cataloging (less critical), `claude-sonnet-4-6` for security/quality
- Monitor cost per upload; alert if above $0.05 (indicates unusually large components)

**Embedding cost** (text-embedding-3-small): ~$0.0002 per upload — negligible.

---

## Quality Bar

The shared DB is a **curated library**, not a marketplace. The quality bar is:
- Would a senior developer approve this in a code review?
- Would an AI agent be able to understand and modify this without confusion?
- Is the manifest rich enough to find this component via natural language search?

If the answer to any of these is "no," the component does not enter the shared DB.

---

## Performance Expectations

| Stage | Mode | Expected duration |
|---|---|---|
| manifest_validation | No LLM | < 2s |
| security_scan | Static + LLM | 5-30s |
| dependency_check | No LLM | < 2s |
| quality_review | LLM | 20-60s |
| test_render | TypeScript compiler | 5-15s |
| cataloging | LLM | 10-30s |
| embedding | API call | 3-5s |
| **Total** | | **~1-2.5 minutes** |

Acceptable: upload is async. Users already have their component locally.
