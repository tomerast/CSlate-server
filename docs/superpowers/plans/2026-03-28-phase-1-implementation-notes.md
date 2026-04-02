# Phase 1: Monorepo Scaffolding — Implementation Notes

**Date:** 2026-03-28
**PR:** tomerast/CSlate-server#1 (merged)
**Branch:** phase-1-scaffolding → main

---

## What Was Built

Full greenfield implementation of the CSlate-server monorepo from the design spec at `docs/superpowers/specs/2026-03-28-cslate-server-design.md`.

### Packages and Apps Created

| Package | Path | Purpose |
|---|---|---|
| `@cslate/db` | `packages/db/` | Drizzle schema, migrations, typed queries, pg pools |
| `@cslate/pipeline` | `packages/pipeline/` | 7-stage review pipeline runner + stages |
| `@cslate/storage` | `packages/storage/` | R2/MinIO S3 client for component files and checkpoints |
| `@cslate/queue` | `packages/queue/` | pg-boss job definitions and publisher |
| `@cslate/llm` | `packages/llm/` | Anthropic + OpenAI client abstraction, prompts |
| `@cslate/api` | `apps/api/` | Hono v4 API server — all routes, auth middleware, SSE |
| `@cslate/worker` | `apps/worker/` | pg-boss consumer — runs pipeline jobs, creates partitions |

### Infrastructure Files

These existed as untracked files in `main` and were copied to the worktree:

- `docker-compose.yml` — postgres+pgvector, MinIO, MailHog
- `scripts/dev.sh` — orchestrates docker, migrations, seed, tsx watch
- `scripts/seed-dev.ts` — creates dev user + pre-seeded API key (idempotent)
- `.env.local.example` — all env vars with descriptions

---

## Non-Obvious Implementation Decisions

These are things that are not in the spec or decision docs, discovered during implementation. Future phases should be aware of them.

### 1. `moduleResolution` Must Be `"Node"`, Not `"Bundler"`

`tsconfig.base.json` uses `"module": "CommonJS"`. TypeScript's `"moduleResolution": "Bundler"` requires ES module output — it is incompatible with `CommonJS`. Changed to `"moduleResolution": "Node"`.

If you ever switch to ESM output, you can revisit `"moduleResolution": "Bundler"` or `"NodeNext"`.

### 2. Route Registration Order Matters in Hono

In `apps/api/src/index.ts`, `uploadRoutes` must be registered **before** `componentRoutes` on the same `/components` prefix:

```typescript
api.route('/components', uploadRoutes)   // handles /components/upload/*
api.route('/components', componentRoutes) // handles /components/:id — would shadow upload/* if first
```

Hono matches routes in registration order. If `componentRoutes` is first, `/:id` captures `upload` as a component ID before the upload route can fire.

### 3. Re-export Does Not Create a Local Binding

```typescript
// WRONG — log is not accessible in this file
export { log } from './lib/logger'
log.error('...')  // ReferenceError: log is not defined

// CORRECT
import { log } from './lib/logger'
export { log } from './lib/logger'
log.error('...')  // works
```

This pattern appears in `apps/api/src/index.ts` where `log` is both re-exported (for consumers) and used locally in `app.onError` and `serve()`.

### 4. SSE: `UNLISTEN *` Before Releasing pg Connection

The listen pool (`getListenPool()`) is a dedicated long-lived pool. A connection checked out for SSE is manually subscribed to a channel with `LISTEN "upload:<id>"`. Before releasing it back to the pool, you must `UNLISTEN *` — otherwise the next caller to receive that connection gets stale notifications from a previous SSE session.

```typescript
finally {
  await pgClient.query('UNLISTEN *')  // required — unsubscribe before pool reuse
  pgClient.release()
}
```

### 5. Zod `.max()` Intercepts Before Custom Error Codes

In `packages/pipeline/src/stages/1-manifest-validation.ts`, the `dataSources` field must not have `.max(5)` on the Zod schema if you want to return the custom `TOO_MANY_DATA_SOURCES` error code. Zod's `.max(5)` fires first and returns a generic validation error, bypassing the manual check.

The limit is enforced exclusively by the manual check:
```typescript
if (manifest.dataSources.length > 5) {
  errors.push({ code: 'TOO_MANY_DATA_SOURCES', ... })
}
```

### 6. Worker Partition DDL Must Be Injection-Safe

`apps/worker/src/index.ts` creates monthly range partitions for `download_events`. Partition names and table names appear in DDL strings (not data positions), so `$1` parameters cannot be used for them. The safe approach:

- Validate the date with a regex (`/^\d{4}-\d{2}$/`) before using it
- Use quoted identifiers (`"download_events_2026_03"`) for the partition name
- Use bound `$1`/`$2` parameters for the date range values

### 7. `postgres` Package in Root for Seed Script

`scripts/seed-dev.ts` runs with `tsx` from the workspace root and needs a Postgres client. It uses the `postgres` (postgres.js) package, which must be declared in the **root** `package.json` devDependencies — not in `@cslate/db` — because `tsx` runs in the root context.

### 8. `download_events` Schema Must Be Declared in `@cslate/db`

The design spec describes `download_events` as a partitioned table managed entirely by the worker's DDL. However, the typed query helpers in `packages/db/src/queries/components.ts` reference it for trending queries. The Drizzle schema must be declared in `packages/db/src/schema/download-events.ts` and exported, even though the partition creation is handled manually by the worker.

### 9. Counting Rows Efficiently

`packages/db/src/queries/checkpoints.ts` originally fetched all checkpoint rows to count them. Use `sql<number>\`count(*)::int\`` with `.then(r => r[0]?.count ?? 0)` instead:

```typescript
const result = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(checkpoints)
  .where(eq(checkpoints.userId, userId))
return result[0]?.count ?? 0
```

### 10. SQL Injection in Dynamic Interval Queries

In `getTrendingComponents`, a time period like `'7 days'` must not be interpolated directly into SQL. Drizzle's `sql` template doesn't automatically parameterize interval strings when they include a unit. The safe pattern:

```typescript
const PERIOD_SECONDS: Record<string, number> = { '24h': 86400, '7d': 604800, '30d': 2592000 }
const seconds = PERIOD_SECONDS[period] ?? 604800
// then: sql`NOW() - (${seconds} * INTERVAL '1 second')`
```

---

## Bugs Found and Fixed During Code Review

These were caught by the automated code review on PR #1.

| Issue | File | Fix Applied |
|---|---|---|
| `log` ReferenceError — re-export without local import | `apps/api/src/index.ts:11` | Added `import { log }` alongside re-export |
| `UNLISTEN *` missing before `pgClient.release()` | `apps/api/src/lib/sse.ts:31` | Added `await pgClient.query('UNLISTEN *')` in finally |
| Blocking `execSync('npx tsc')` in stage 5 | `packages/pipeline/src/stages/5-test-render.ts` | Replaced with async `spawn` using local tsc binary |
| Unhandled throw in stage 7 embedding | `packages/pipeline/src/stages/7-embedding.ts` | Wrapped in try/catch, returns `status: 'failed'` |
| Worker partition DDL SQL injection | `apps/worker/src/index.ts` | Regex validation + quoted identifiers + bound params |
| Circular import chain (email→index→auth→email) | `apps/api/src/lib/logger.ts` | Extracted pino logger to break the cycle |
| SSE stream closed immediately on open | `apps/api/src/lib/sse.ts` | Changed to Promise-based keep-alive with resolve on completion |
| Expired token cleanup never ran | `apps/api/src/routes/auth.ts` | Added `setInterval` cleanup with `.unref()` |
| Dead-code ternary in checkpoints quota | `apps/api/src/routes/users.ts` | Removed unreachable branch |
| `updateComponent` too permissive | `packages/db/src/queries/components.ts` | Narrowed to `ComponentUpdateFields` type alias |
| Unused `TAILWIND_COLOR_REGEX` constant | `packages/pipeline/src/stages/1-manifest-validation.ts` | Removed |
| Missing `exports` field in package.json files | All `packages/*/package.json` | Added require/types exports map |

---

## Known TODOs Left in Code

These are intentional stubs marked for future phases, not bugs:

- `apps/api/src/routes/users.ts` — `uploads: { used: 0 }` in `/me` endpoint: monthly upload count not yet implemented (requires `uploads` table query with date range)
- `apps/api/src/routes/auth.ts` — `if (existing) { /* update existing? */ }` block in `POST /verify-email`: idempotency handling for already-verified users is a stub
- `packages/pipeline/src/stages/3-dependency-check.ts` — npm allowlist JSON exists but package version pinning is not enforced

---

## What Phase 2 Should Tackle

Based on the design spec and what phase 1 left incomplete:

### High Priority
1. **Real database migrations** — run `pnpm db:generate` + `pnpm db:migrate` against a real Postgres instance, verify all tables and the `download_events` partitioned structure
2. **Integration tests** — `apps/api/src/__tests__/` tests exist but need Docker running; wire into CI
3. **Rate limiting** — `apps/api/src/middleware/rate-limit.ts` is implemented in-memory; move to Redis or pg-backed sliding window for multi-process correctness
4. **Email delivery** — `packages/llm/src/email.ts` sends via SMTP (MailHog locally); wire up a real provider (Resend/Postmark) for production
5. **Monthly upload quota** — complete the `uploads.used` count in `GET /users/me`

### Medium Priority
6. **Abuse reporting pipeline** — `POST /components/:id/report` stores reports; the auto-revoke trigger at ≥3 reports needs a background check or DB trigger
7. **pgvector HNSW index** — the schema declares the index but it needs to be created after the first embedding batch; confirm `packages/db/src/schema/components.ts` index syntax works with `drizzle-kit generate`
8. **Worker graceful shutdown** — `apps/worker/src/index.ts` handles `SIGTERM` but doesn't wait for in-flight jobs to complete before exiting
9. **LLM prompt versioning** — prompts are in `packages/llm/src/prompts/`; as they evolve, add a version comment so you can correlate stored `ai_hints` JSONB with the prompt that generated them

### Low Priority / Future
10. **Download tracking** — `POST /components/:id/download` writes to `download_events`; the trending query in `getTrendingComponents` uses this data but it's not tested end-to-end
11. **Component search pagination** — cursor-based pagination is designed in the spec; the current implementation returns a page but doesn't enforce cursor consistency under concurrent writes
12. **Revocation webhooks** — when a component is revoked, there's no notification to users who have it in their app; future: pg NOTIFY → worker → email

---

## Dev Environment Quick Start

```bash
# First time
cp .env.local.example .env.local
# Add ANTHROPIC_API_KEY and OPENAI_API_KEY

# Every time
pnpm dev
```

Dev API key (pre-seeded): `cslate_dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

See `docs/contracts/client-local-dev-requirements.md` for the full client-server contract.
