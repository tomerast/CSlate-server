# CSlate Server — Implementation Spec

> Current implementation continuity lives in `docs/continuity.md`. This file is useful background, but any conflict with `docs/continuity.md` or live code should be treated as historical and corrected.

**Repo:** `CSlate-server` (Hono + Drizzle + PostgreSQL + pgvector)  
**Date:** 2026-04-24

---

## Overview

CSlate Server is the shared community backend for all CSlate clients. Its two primary jobs:

1. **Component search** — serve the right render component to clients in < 200ms
2. **Component review** — gate every uploaded component through a 7-stage pipeline before it enters the community library

---

## Monorepo Layout

```
apps/
  api/        @cslate/api     — Hono HTTP server (tsx watch src/index.ts)
  worker/     @cslate/worker  — pg-boss job consumer (tsx watch src/index.ts)

packages/
  db/         @cslate/db       — Drizzle schema + drizzle-kit migrations (pg driver)
  llm/        @cslate/llm      — Anthropic + OpenAI clients; review LLM + embedding
  pipeline/   @cslate/pipeline — 7-stage review pipeline (pure logic, no HTTP)
  queue/      @cslate/queue    — pg-boss 10 job type defs + producers
  storage/    @cslate/storage  — S3/R2/MinIO via @aws-sdk/client-s3
  logger/     @cslate/logger   — pino 9 + pino-pretty
```

**Turborepo build order:** `@cslate/logger` → `@cslate/db`, `@cslate/llm`, `@cslate/queue`, `@cslate/storage` → `@cslate/pipeline` → `@cslate/api`, `@cslate/worker`

**Dev commands:**
```bash
pnpm dev          # turbo dev — starts api + worker with tsx watch
pnpm build        # turbo build — tsup CJS all packages
pnpm test         # turbo test — vitest run all
pnpm db:generate  # drizzle-kit generate
pnpm db:migrate   # drizzle-kit migrate
pnpm db:seed      # tsx scripts/seed-dev.ts
pnpm db:studio    # drizzle-kit studio
```

**Docker infra (dev only):**
```bash
docker compose up   # postgres:5432 + minio:9000/9001 + mailhog:1025/8025
```

---

## Stack

| Layer | Technology |
|---|---|
| API Framework | Hono 4 + `@hono/node-server` + `@hono/zod-validator` |
| ORM | Drizzle ORM 0.40 (`drizzle-orm` + `drizzle-kit`) |
| DB driver | `pg` 8 (raw postgres for migration scripts: `postgres` 3) |
| Database | PostgreSQL 16 + pgvector (prod: Neon; dev: Docker `pgvector/pgvector:pg16`) |
| File storage | Cloudflare R2 in prod / MinIO (S3-compat) in dev |
| S3 client | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| Job queue | pg-boss 10 |
| Review LLM | Anthropic SDK 0.36 + OpenAI SDK 4.77 (server-owned keys) |
| Embedding | text-embedding-3-small (1536 dims) via `@cslate/llm` |
| Vector search | HNSW index, cosine distance |
| Logger | pino 9 + pino-pretty (`@cslate/logger`) |
| Monorepo | pnpm workspaces + Turborepo 2 |
| Build | tsup (CJS per package) |
| Dev runner | `tsx watch` |
| Tests | Vitest 2 |
| AST analysis | `@typescript-eslint/typescript-estree` (Stage 2 security scan) |
| Email (dev) | MailHog (SMTP :1025, UI :8025) |
| Auth | API key header |
| Node | >= 22 |
| Package manager | pnpm 10 |

---

## API Routes

### Auth
```
POST   /api/v1/auth/register        Create account → returns API key
POST   /api/v1/auth/regenerate      Rotate API key
DELETE /api/v1/auth/account         Delete account + all data
```

### Component Search & Retrieval (Hot Path)
```
GET  /api/v1/components/search      Semantic search (pgvector)
GET  /api/v1/components/:id         Component metadata + manifest
GET  /api/v1/components/:id/source  Full package (manifest + files)
GET  /api/v1/components/trending    Top by downloads, period=week/month
GET  /api/v1/components/popular     Top by rating
GET  /api/v1/components/tags        All available tags
GET  /api/v1/components/categories  All available categories
POST /api/v1/components/:id/rate    { rating: 1-5, comment? }
```

### Component Upload
```
POST /api/v1/components/upload              Upload ComponentPackage → 202 { uploadId }
GET  /api/v1/components/upload/:id/status   Poll review status
GET  /api/v1/components/upload/:id/stream   SSE review stage stream
```

### Checkpoint Backup (Private)
```
POST   /api/v1/checkpoints
GET    /api/v1/checkpoints/:componentLocalId
GET    /api/v1/checkpoints/:componentLocalId/:version
DELETE /api/v1/checkpoints/:componentLocalId/:version
```

### User
```
GET   /api/v1/users/me
GET   /api/v1/users/me/components
GET   /api/v1/users/me/checkpoints
PATCH /api/v1/users/me
```

### Updates + Revocations
```
POST /api/v1/components/check-updates    { componentIds: uuid[] }
```

Returns pending updates + revocations for client's local components.

---

## Search Implementation (Critical Path)

Target: **< 200ms p95**. This is on the critical path of every LLM response.

```
1. Receive query string
2. Call text-embedding-3-small → 1536-dim vector
3. HNSW cosine distance search over components table
4. Join with ratings + download counts
5. Re-rank: score = (cosine_similarity × 0.7) + (quality_score × 0.2) + (recency × 0.1)
6. Return top N with manifest + bundle_url + relevance_score
```

**Search request shape (validated via @cslate/shared SearchRequestSchema):**
```typescript
{
  q: string
  tags?: string[]
  category?: string
  complexity?: 'simple' | 'moderate' | 'complex'
  limit?: number      // default 10, max 50
  offset?: number
  minRating?: number
  sortBy?: 'relevance' | 'rating' | 'downloads' | 'recent'
}
```

---

## 7-Stage Review Pipeline

Triggered by a `ComponentUpload` job in pg-boss. Runs in the worker process.

```
Stage 1: manifest_validation
  - Parse with ComponentManifestSchema (from @cslate/shared)
  - Reject: MANIFEST_INVALID with Zod error details

Stage 2: security_scan
  - AST analysis via @typescript-eslint/typescript-estree
  - Checks: fetch/XHR/WebSocket misuse, eval, dangerous globals, data exfiltration
  - Reject: SECURITY_VIOLATION

Stage 3: dependency_check
  - Verify all declared npm deps are safe + pinned versions
  - Check for known malicious packages
  - Reject: UNSAFE_DEPENDENCY

Stage 4: quality_review  (LLM-assisted)
  - Code quality check
  - Tailwind semantic token enforcement:
      raw color utilities (bg-blue-500) → STYLING_TOKEN_VIOLATION (hard reject)
  - Component correctness
  - Reject: QUALITY_FAILED | STYLING_TOKEN_VIOLATION

Stage 5: test_render
  - TypeScript compilation check
  - JSX validity (no headless browser needed — esbuild compilation only)
  - Reject: COMPILATION_FAILED

Stage 6: cataloging  (LLM-assisted)
  - Generate: summary, category, complexity classification
  - Enrich manifest.ai: modificationHints, extensionPoints, similarTo
  - Generate context.md if not provided

Stage 7: embedding
  - Generate 1536-dim embedding from: name + description + tags + summary + context.md
  - Store in pgvector column
  - Component is now searchable
```

SSE stream events emitted after each stage:
```typescript
{ stage: ReviewStage | 'complete', status: 'in_progress' | 'complete' | 'failed', progress?: 0-1, result?, reason?, componentId? }
```

---

## Database Schema (Key Tables)

```sql
-- Core component record
components (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  description   text NOT NULL,
  summary       text,                    -- AI-generated at Stage 6
  category      text,
  complexity    text,
  tags          text[],
  author_id     uuid REFERENCES users(id),
  bundle_url    text,                    -- R2 URL for the CJS bundle
  manifest      jsonb NOT NULL,
  embedding     vector(1536),            -- pgvector for search
  rating        numeric(3,2) DEFAULT 0,
  download_count integer DEFAULT 0,
  version       text DEFAULT '1.0.0',
  status        text DEFAULT 'pending',  -- pending | approved | revoked
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
)

-- HNSW index for fast cosine search
CREATE INDEX ON components USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE status = 'approved';

-- Per-user private backups
checkpoints (
  id                 uuid PRIMARY KEY,
  user_id            uuid REFERENCES users(id),
  project_id         uuid NOT NULL,
  component_local_id text NOT NULL,
  component_name     text NOT NULL,
  version            text NOT NULL,
  manifest           jsonb NOT NULL,
  files_url          text,              -- R2 URL for files archive
  description        text,
  trigger            text,
  created_at         timestamptz DEFAULT now()
)
```

---

## Component Revocation

Server admins or automated abuse detection can revoke a component:

```
POST /api/v1/components/:id/revoke
Body: { reason: 'security' | 'abuse' | 'legal' | 'author-request', message?: string }
```

Revocations surface in `POST /api/v1/components/check-updates` response:
```typescript
{
  updates: [...],
  revocations: [{ id: uuid, reason, message? }]
}
```

**Policy:** revoked components are removed from search immediately. Clients are notified but the component is NOT auto-deleted from user machines — that's the user's choice.

---

## Authentication

```
Authorization: ApiKey <api_key>
```

- Keys are generated at register and stored hashed in the DB
- Client stores key encrypted via Electron `safeStorage`
- No OAuth, no sessions — API key only for v1

---

## Rate Limits

| Endpoint | Limit |
|---|---|
| Search | 100 req/min |
| Component retrieval | 120 req/min |
| Upload | 10 req/hour |
| Checkpoint upload | 60 req/hour |
| check-updates | 60 req/hour |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Upload Size Limits

| Limit | Value |
|---|---|
| Per file | 500 KB |
| Total package | 2 MB |
| Manifest alone | 50 KB |

---

## Error Envelope

All errors use:
```typescript
{ error: { code: string, message: string, details?: any }, statusCode: number }
```

Known codes: `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `MANIFEST_INVALID`, `UPLOAD_TOO_LARGE`, `REVIEW_REJECTED`, `RATE_LIMITED`, `SERVER_ERROR`, `TOO_MANY_DATA_SOURCES`, `STYLING_TOKEN_VIOLATION`

---

## Environment Variables

```bash
# Database
DATABASE_URL                  PostgreSQL connection string
DATABASE_URL_DIRECT           Direct connection (bypasses pooler)

# Storage (R2 in prod / MinIO in dev)
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_ENDPOINT                   MinIO: http://localhost:9000 | R2: omit

# LLM — Mode A: Gateway (recommended)
AI_GATEWAY_URL                https://gateway.ai.vercel.app/v1/<team>/<name>
AI_GATEWAY_KEY                vgw-...

# LLM — Mode B: Direct keys (use instead of gateway)
ANTHROPIC_API_KEY
OPENAI_API_KEY
EMBEDDING_BASE_URL            Custom embedding provider base URL
EMBEDDING_API_KEY             Custom embedding provider key

# LLM Models
LLM_QUALITY_MODEL             Strong model — review judge, security expert
LLM_CATALOG_MODEL             Medium model — cataloging, standards
EMBEDDING_MODEL               e.g. text-embedding-3-small

# Email
SMTP_HOST
SMTP_PORT
SMTP_FROM

# Server
PORT                          Default 3000
NODE_ENV
LOG_LEVEL

# Dev-only
DEV_SKIP_EMAIL_VERIFY         true → register skips email verification
DEV_SEED_API_KEY              Pre-seeded key from db:seed for local client use
```
