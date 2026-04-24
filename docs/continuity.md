# CSlate Server — Continuity Guide

**Scope:** `CSlate-server` backend monorepo  
**Last reviewed:** 2026-04-24  
**Purpose:** give future maintainers enough concept, architecture, and decision context to continue server development without reconstructing it from scattered code.

---

## Product Role

CSlate Server is the shared community brain behind the desktop client. The client asks, "is there an approved card that can render this answer?" The server answers with searchable, reviewed component and pipeline packages.

The server owns:

1. User registration and API-key authentication.
2. Semantic search for approved components and data pipelines.
3. Source retrieval for reviewed packages.
4. Upload staging into object storage.
5. Asynchronous review through pg-boss workers.
6. Cataloging, embedding, moderation, ratings, reports, revocation, and download tracking.

The server should not own desktop session state, local user memory, Electron IPC, or renderer behavior.

---

## Monorepo Shape

```text
apps/
  api/        Hono HTTP server
  worker/     pg-boss workers for review and maintenance
packages/
  db/         Drizzle schema, migrations, raw pgvector queries, query helpers
  llm/        Anthropic/OpenAI wrappers, prompts, embeddings
  logger/     shared pino logger
  pipeline/   component + pipeline review logic
  queue/      pg-boss client, job names, enqueue helpers
  storage/    S3/R2/MinIO object storage abstraction
scripts/      local seed/dev utilities
docs/         architecture and continuity docs
```

Turborepo composes packages. Keep business logic in packages and make apps thin entrypoints.

---

## Runtime Topology

```text
CSlate client
  -> Hono API app
  -> Postgres + pgvector for metadata/search
  -> S3-compatible storage for source files
  -> pg-boss queues for async review
  -> worker process
  -> pipeline package review stages
  -> approved component/pipeline rows become searchable
```

Local dev normally runs Postgres/pgvector, MinIO, and MailHog via Docker, then API and worker through pnpm/turbo scripts.

---

## API App

`apps/api/src/app.ts` builds the Hono app. It registers:

- `/health`
- `/api/v1/auth`
- `/api/v1/components`
- `/api/v1/components/upload`
- `/api/v1/checkpoints`
- `/api/v1/users`
- `/api/v1/pipelines/upload`
- `/api/v1/pipelines`
- `/api/v1/search`

`apps/api/src/index.ts` only loads env, creates the app, and starts the listener. Keep it thin so tests can import `createApp()` without opening a port.

All API responses advertise `API-Version: 1`. Unhandled errors are normalized to `{ error: { code, message } }`.

---

## Authentication

Auth is API-key based:

1. Client sends `Authorization: ApiKey <key>`.
2. `authMiddleware` hashes the key.
3. The hash is looked up through `getUserByApiKeyHash`.
4. The authenticated `user` is stored in Hono context.

Public read/search routes are rate-limited but generally unauthenticated. Uploads, user routes, checkpoint backup, rating, reporting, and revocation require auth.

---

## Search Path

Component search:

```text
GET /api/v1/components/search?q=...&limit=...
  -> validate query
  -> getEmbedding(q)
  -> searchComponents({ queryEmbedding, filters })
  -> raw SQL pgvector cosine similarity
  -> return rows + manifest + relevance_score
```

Pipeline search is analogous at `GET /api/v1/pipelines/search`.

The code currently sorts by one primary dimension: relevance, rating, downloads, or recency. It does not yet implement a weighted blend of similarity, quality, and recency. If product needs blended ranking, implement it in `packages/db/src/queries/components.ts` and `packages/db/src/queries/pipelines.ts`, then document the scoring formula.

Hot-path constraints:

- Keep query embedding and vector search latency low.
- Do not add LLM review or object-storage reads to search.
- Return enough manifest metadata for client routing, but fetch source only after a chosen hit.

---

## Source Retrieval

Component source:

```text
GET /api/v1/components/:id/source
  -> get component row
  -> reject revoked/missing
  -> load files from storageKey via @cslate/storage
  -> increment download counters
  -> return { id, manifest, files, summary, version, updatedAt }
```

Pipeline source follows the same model under `/api/v1/pipelines/:id/source`.

The client expects `bundle.js` in component files for server-rendered cards. A searched component without `bundle.js` is unusable by the desktop render-decision path.

---

## Upload and Review Flow

Component upload:

```text
POST /api/v1/components/upload
  -> auth + rate limit
  -> validate manifest/files with package-local ComponentManifestSchema
  -> enforce total size limit
  -> create uploads row
  -> store files under packages/uploads/{uploadId}
  -> enqueue review-component job
  -> return 202 { uploadId, status: "pending" }
```

Worker review:

```text
review-component job
  -> load upload row
  -> mark in_progress
  -> load files from object storage
  -> build PipelineContext
  -> runPipeline(ctx, progressCallback)
  -> update upload status and completed stages
  -> publish progress through pg_notify upload:{uploadId}
```

SSE:

- `GET /api/v1/components/upload/:id/status` polls current state.
- `GET /api/v1/components/upload/:id/stream` subscribes to upload progress.
- Terminal uploads may return immediate JSON instead of an event stream.

Pipeline uploads mirror this flow through `/api/v1/pipelines/upload` and `review-pipeline` jobs.

---

## Current Component Review Pipeline

The live component runner is `packages/pipeline/src/runner.ts`.

Current stage sequence:

1. `manifest_validation` — server-side upload manifest and required-file checks.
2. `dependency_check` — npm allowlist and CSlate dependency availability.
3. `agent_review` — static analysis, expert agents, red team, judge, verdict.
4. `cataloging` — summaries, categories, context, manifest enrichment.
5. `embedding` — embedding generation and approved component row creation.

Older individual stages still exist in `packages/pipeline/src/stages/2-security-scan.ts`, `4-quality-review.ts`, and `5-test-render.ts`, but the live runner has consolidated security/quality/render judgment into `agent_review`. Do not document or assume the old seven-stage pipeline as live behavior unless the runner is changed.

---

## Reviewer Agent

`packages/pipeline/src/reviewer-agent/orchestrator.ts` owns the deep review phase.

Phases:

1. Static analysis: local pattern, AST, dependency/type-oriented checks.
2. Expert agents: security, quality, and standards agents run in parallel.
3. Red team: adversarial probing unless security already clearly failed.
4. Judge: verifies findings and filters hallucinations.
5. Verdict: computes decision, scores, report, cost, and learning outcome.

Review design principles:

- Static critical findings short-circuit early.
- LLM findings are not accepted blindly; the judge verifies them.
- Cost and token usage are tracked per phase.
- Outcomes feed reviewer learning tables.
- Timeouts and retry logic keep transient provider failures contained.

---

## Database Model

Key tables live in `packages/db/src/schema/`.

Important component fields:

- `id`, `name`, `title`, `description`, `tags`, `version`
- `category`, `subcategory`, `complexity`, `summary`, `contextSummary`
- `manifest` JSONB
- `storageKey`
- `embedding` vector column managed by raw SQL migrations
- `downloadCount`, `ratingSum`, `ratingCount`
- `flagged`, `revoked`, `revokeReason`, `revokedAt`

Important pipeline fields mirror components with pipeline-specific additions:

- `pipelineId`
- `strategyType`
- `secretNames`
- `outputSchema`

pgvector columns are intentionally handled through raw SQL because Drizzle core does not model vector columns directly.

---

## Storage Model

`packages/storage` stores and retrieves text files from S3-compatible object storage.

Key layout:

- Upload staging: `packages/uploads/{uploadId}/{filename}`
- Approved components: `packages/components/{componentId}/{version}/{filename}`
- Pipeline upload/source helpers follow the same principle in pipeline-specific files.

Do not store large package file contents in Postgres. Database rows hold metadata and storage keys; storage holds source and bundles.

---

## Shared-Package Boundary

The server depends on `@cslate/shared/agent` for reviewer-agent tool and sub-agent infrastructure.

Current schema boundary is mixed:

- `@cslate/shared` contains client-oriented component and pipeline package schemas.
- `@cslate/pipeline` defines server upload/review schemas that differ from shared schemas.

This is a contract risk. Before enabling client auto-upload end-to-end, reconcile or explicitly normalize between the client manifest shape and the server upload manifest shape. Do not silently assume the two `ComponentManifestSchema` definitions are identical.

---

## Architecture Decisions

### ADR-S1: API and worker are separate apps

HTTP request latency and review latency have different operational profiles. Upload endpoints enqueue work and return `202`; workers handle expensive review asynchronously.

### ADR-S2: Postgres is both system of record and queue substrate

Postgres stores metadata, vectors, users, reports, upload state, and pg-boss jobs. This simplifies local/dev operations and transactional reasoning.

### ADR-S3: Source files live in object storage

Component packages can be large and versioned. Object storage is better suited than Postgres rows for source and bundle payloads.

### ADR-S4: Search reads metadata only

Search must stay fast. It uses embeddings and row metadata; source retrieval is a second request after a client selects a candidate.

### ADR-S5: Review is fail-closed

Unknown security failures, parse failures, blocked dependencies, and critical findings reject uploads. The library is a trusted runtime source for desktop clients, so review must bias toward safety.

### ADR-S6: Agent review replaced several brittle stage checks

The code keeps older stage files, but the live runner routes security/quality/render judgment through the reviewer agent. Future changes should either remove stale stages or reintroduce them deliberately in `runner.ts`.

### ADR-S7: Revocation is part of the platform contract

Approved components/pipelines can later be revoked. Search/source endpoints must exclude revoked content, and clients should use update/revocation checks before trusting cached packages.

---

## Development Rules

- Keep `apps/api` route handlers thin; put persistence in `packages/db`, storage in `packages/storage`, review in `packages/pipeline`, and queue behavior in `packages/queue`.
- Add tests near the package being changed.
- Do not add object-storage reads or LLM calls to search endpoints.
- Keep upload status updates idempotent so pg-boss retries are safe.
- Treat manifest/schema changes as cross-repo changes involving `CSlate`, `CSlate-server`, and `CSlate-shared`.
- Keep all new public API errors in the unified error-envelope style.
- If docs and code disagree, update the doc in the same change.

---

## Known Gaps

- Search docs historically describe blended scoring; code currently uses a selected `ORDER BY` strategy.
- The server review schema and shared package schema are not identical.
- Older pipeline stage files remain even though the runner uses `agent_review` instead of the full old stage sequence.
- The desktop client currently has no complete auto-publish workflow wired to upload, SSE, and post-review card replacement.

---

## Validation Commands

```bash
pnpm test
pnpm build
pnpm lint
pnpm --filter=@cslate/pipeline test
pnpm db:generate
pnpm db:migrate
```

Use focused package tests first, then broader Turbo tasks when preparing a cross-package change.
