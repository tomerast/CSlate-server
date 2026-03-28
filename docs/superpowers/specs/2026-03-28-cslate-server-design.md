# CSlate-Server: Full Design Specification

**Date:** 2026-03-28
**Version:** 1.1
**Status:** Updated (client contract v3 changes incorporated)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Monorepo Structure](#4-monorepo-structure)
5. [Database Schema](#5-database-schema)
6. [API Layer](#6-api-layer)
7. [Review Pipeline](#7-review-pipeline)
8. [Search & Embedding](#8-search--embedding)
9. [File Storage](#9-file-storage)
10. [Authentication](#10-authentication)
11. [Job Queue](#11-job-queue)
12. [Real-Time Updates (SSE)](#12-real-time-updates-sse)
13. [Rate Limiting](#13-rate-limiting)
14. [Error Handling](#14-error-handling)
15. [Deployment](#15-deployment)
16. [Testing Strategy](#16-testing-strategy)

---

## 1. System Overview

CSlate-Server is the backend for CSlate, an AI-powered desktop app building platform. It serves the Electron desktop client via HTTPS API.

### Core Responsibilities

1. **Component Review Pipeline** — 7-stage AI review of uploaded components (security, quality, cataloging)
2. **Semantic Search** — pgvector-powered similarity search across community components
3. **Component Storage** — Multi-file component packages in R2, metadata in Postgres
4. **Checkpoint Backup** — Private versioned backups of user components
5. **User Management** — API key auth, ownership tracking, contribution stats
6. **Abuse Reporting** — Community flagging with auto-removal at threshold

### What the Server Does NOT Do

- Run user LLMs (client-side, user-configured)
- Render components (client sandbox)
- Manage app layout/tabs (client-local)
- Store full app projects (only individual component packages + checkpoints)
- Store sensitive user credentials (API keys, tokens — those stay in Electron safeStorage)

### Community Sharing: Opt-In (v3 change)

Community sharing is **opt-in** as of client Decision 017 (GDPR compliance). The server does not change behavior — the review pipeline is unchanged. The client simply only uploads when the user explicitly confirms. This reduces abuse surface: every upload represents a deliberate community contribution.

---

## 2. Architecture

### Process Model: API + Worker Separation

```
┌──────────────────────────────────┐
│         Hono API Server          │
│  (routes, auth, search, upload)  │
│          Fly.io Machine          │
└──────────────┬───────────────────┘
               │ pg-boss enqueue
               ▼
┌──────────────────────────────────┐
│        PostgreSQL (Neon)         │
│  pgvector │ pg-boss jobs │ data  │
└──────────────┬───────────────────┘
               │ pg-boss dequeue (SKIP LOCKED)
               ▼
┌──────────────────────────────────┐
│       Review Worker Process      │
│  (pipeline stages, LLM calls)   │
│  Fly.io Machine(s) — auto-scaled│
└──────────────┬───────────────────┘
               │ store files
               ▼
┌──────────────────────────────────┐
│      Cloudflare R2 Storage       │
│   (component packages, files)    │
└──────────────────────────────────┘
```

**Same codebase, two deployment targets.** API enqueues review jobs, workers consume them. pg-boss coordinates via Postgres SKIP LOCKED — multiple workers safely dequeue without conflicts.

**Why not microservices:** LLM stages are I/O-bound (waiting on API responses), not compute-bound. A single Node.js worker handles dozens of concurrent LLM calls. Network overhead between 7 microservices adds cost for zero benefit. Stages are functions with clean interfaces — extractable to services later if needed.

---

## 3. Tech Stack

| Layer | Technology | Version | Why |
|---|---|---|---|
| Framework | Hono | 4.x | RPC type safety with Electron client, Zod integration |
| Runtime | Node.js | 22 LTS | Ecosystem maturity, all npm packages work |
| ORM | Drizzle | 0.40+ | First-class pgvector, best TS inference |
| Database | PostgreSQL + pgvector | 16 + 0.8 | Semantic search, HNSW indexes |
| DB Hosting | Neon | Serverless | Auto-scaling, free tier, branching |
| File Storage | Cloudflare R2 | — | S3-compatible, no egress fees |
| Job Queue | pg-boss | 10.x | Postgres-backed, no Redis needed |
| Validation | Zod | 3.x | Single source for runtime + types + RPC |
| Logging | Pino | 9.x | Structured JSON, fastest Node.js logger |
| Monorepo | Turborepo + pnpm | — | Workspace management, parallel builds |
| LLM Gateway | Vercel AI Gateway (`ai-gateway.vercel.sh`) | — | Hosted proxy — caching, observability, BYOK, provider fallback. See Decision 007 |
| LLM SDK | `@ai-sdk/gateway` + `ai` | v6 | Unified model factory via `createGateway()`. Model strings: `anthropic/claude-sonnet-4.6` |
| Embedding | `openai/text-embedding-3-small` via gateway | 1536 dims | Only OpenAI usage — passed as `byok` key |
| Review LLM (quality/security) | `anthropic/claude-sonnet-4.6` via gateway | — | Best code comprehension and security reasoning |
| Review LLM (cataloging) | `anthropic/claude-haiku-4.5-20251001` via gateway | — | 10× cheaper, sufficient for summary/tagging |
| Deployment | Fly.io | — | Sub-second cold starts, FAS autoscaler |

---

## 4. Monorepo Structure

```
cslate-server/
├── apps/
│   ├── api/                          # Hono API server (deployable)
│   │   ├── src/
│   │   │   ├── index.ts              # Server entry point
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # POST /api/auth/*
│   │   │   │   ├── components.ts     # GET/POST /api/components/*
│   │   │   │   ├── checkpoints.ts    # CRUD /api/checkpoints/*
│   │   │   │   ├── users.ts          # GET/PATCH /api/users/*
│   │   │   │   └── uploads.ts        # POST upload, GET status, SSE stream
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # API key validation
│   │   │   │   ├── rate-limit.ts     # Per-user rate limiting
│   │   │   │   └── logger.ts         # Pino request logging
│   │   │   └── lib/
│   │   │       └── sse.ts            # SSE helper for review progress
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── worker/                       # pg-boss worker process (deployable)
│       ├── src/
│       │   ├── index.ts              # Worker entry point (pg-boss consumer)
│       │   └── handlers/
│       │       └── review.ts         # Orchestrates pipeline stages for a job
│       ├── Dockerfile
│       └── package.json
│
│   # NOTE: @cslate/shared is an EXTERNAL npm dependency (not a local package).
│   # It contains the canonical ComponentManifest Zod schema and shared types.
│   # Install it: pnpm add @cslate/shared
│   # Import: import { ComponentManifest, ReviewStage } from '@cslate/shared'
│
├── packages/
│   ├── db/                           # Drizzle schema + queries
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── users.ts
│   │   │   │   ├── components.ts
│   │   │   │   ├── checkpoints.ts
│   │   │   │   ├── uploads.ts
│   │   │   │   ├── reports.ts
│   │   │   │   ├── download-events.ts # Partitioned table DDL
│   │   │   │   └── index.ts
│   │   │   ├── queries/
│   │   │   │   ├── components.ts     # Search, retrieve, catalog queries
│   │   │   │   ├── checkpoints.ts
│   │   │   │   └── users.ts
│   │   │   ├── client.ts             # Drizzle client (query pool) + pgPool (LISTEN pool)
│   │   │   └── index.ts
│   │   ├── drizzle/                  # Generated migrations
│   │   └── drizzle.config.ts
│   │
│   ├── pipeline/                     # Review pipeline stages
│   │   ├── src/
│   │   │   ├── stages/
│   │   │   │   ├── 1-manifest-validation.ts  # Zod schema + file structure
│   │   │   │   ├── 2-security-scan.ts        # Static analysis + LLM (claude-haiku)
│   │   │   │   ├── 3-dependency-check.ts     # npm allowlist + CSlate dep check
│   │   │   │   ├── 4-quality-review.ts       # LLM code quality (claude-sonnet)
│   │   │   │   ├── 5-test-render.ts          # TypeScript compilation
│   │   │   │   ├── 6-cataloging.ts           # LLM summary + ai hints (claude-haiku)
│   │   │   │   └── 7-embedding.ts            # Vector generation + DB store
│   │   │   ├── types.ts              # StageInput, StageOutput interfaces
│   │   │   ├── runner.ts             # Pipeline orchestrator (runs stages sequentially)
│   │   │   └── index.ts
│   │   ├── config/
│   │   │   ├── npm-allowlist.json    # Allowed npm packages
│   │   │   ├── url-allowlist.json    # Tier 1 known-safe API domains
│   │   │   ├── url-blocklist.json    # Tier 3 blocked patterns
│   │   │   └── security-patterns.json # Blocked code patterns (fetch, eval, etc.)
│   │   └── type-stubs/
│   │       ├── bridge.d.ts           # Type stubs for bridge.fetch/subscribe/getConfig
│   │       └── tsconfig.test.json    # tsconfig for TypeScript compilation in test_render stage
│   │
│   ├── storage/                      # R2 client + file operations
│   │   └── src/
│   │       ├── client.ts             # S3-compatible R2 client
│   │       ├── components.ts         # Upload/retrieve component packages
│   │       ├── checkpoints.ts        # Upload/retrieve checkpoints
│   │       └── index.ts
│   │
│   ├── queue/                        # pg-boss job definitions
│   │   └── src/
│   │       ├── client.ts             # pg-boss client setup
│   │       ├── jobs.ts               # Typed job creators + handlers
│   │       └── index.ts
│   │
│   └── llm/                          # LLM client abstraction
│       └── src/
│           ├── gateway.ts            # createServerGatewayModel() — Vercel AI Gateway factory
│           ├── client.ts             # Re-exports gateway factory + model ID constants
│           ├── prompts/
│           │   ├── security-review.ts
│           │   ├── quality-review.ts
│           │   ├── enrichment.ts
│           │   └── cataloging.ts
│           └── index.ts
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
└── docs/
```

**Key principle:** Each package has a clean interface. `packages/pipeline/` exports stage functions, `packages/db/` exports typed queries, `packages/storage/` exports file operations. Apps compose them.

---

## 5. Database Schema

### Tables

#### `users`
```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
email           TEXT NOT NULL UNIQUE
api_key_hash    TEXT NOT NULL                -- SHA-256 hash of API key
display_name    TEXT
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()
```

#### `components`
The community component library. Only approved components appear here.
```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
name            TEXT NOT NULL
title           TEXT NOT NULL
description     TEXT NOT NULL
tags            TEXT[] NOT NULL
version         TEXT NOT NULL DEFAULT '1.0.0'
category        TEXT                         -- Server-assigned during cataloging
subcategory     TEXT
complexity      TEXT CHECK (complexity IN ('simple', 'moderate', 'complex'))
summary         TEXT                         -- AI-generated 1-2 sentence summary
context_summary TEXT                         -- AI-generated from context.md
author_id       UUID REFERENCES users(id) ON DELETE SET NULL
manifest        JSONB NOT NULL               -- Full ComponentManifest
embedding       VECTOR(1536)                 -- Composite embedding for search
storage_key     TEXT NOT NULL                -- R2 key for component package
download_count  INTEGER DEFAULT 0
rating_sum      INTEGER DEFAULT 0            -- Sum of all ratings
rating_count    INTEGER DEFAULT 0            -- Number of ratings
parent_id       UUID REFERENCES components(id)  -- Previous version (if versioned)
flagged         BOOLEAN DEFAULT false            -- Auto-flagged on 3+ reports
revoked         BOOLEAN DEFAULT false            -- Author/admin-revoked (removed from all results)
revoke_reason   TEXT CHECK (revoke_reason IN ('security', 'abuse', 'legal', 'author-request'))
revoked_at      TIMESTAMPTZ
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()

INDEX idx_components_embedding USING hnsw (embedding vector_cosine_ops)
INDEX idx_components_tags USING gin (tags)
INDEX idx_components_category ON components(category)
INDEX idx_components_author ON components(author_id)
INDEX idx_components_name_author ON components(name, author_id)  -- Version detection
INDEX idx_components_download ON components(download_count DESC)
INDEX idx_components_rating ON components((rating_sum::float / NULLIF(rating_count, 0)) DESC)
```

#### `uploads`
Tracks upload lifecycle from submission through review.
```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
author_id       UUID REFERENCES users(id) ON DELETE CASCADE
manifest        JSONB NOT NULL               -- Manifest as submitted
storage_key     TEXT NOT NULL                -- R2 key for uploaded package
status          TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected'))
current_stage   TEXT                         -- Current pipeline stage name
completed_stages JSONB DEFAULT '[]'          -- Array of completed stage results
rejection_reasons JSONB                      -- Array of {stage, issues} if rejected
component_id    UUID REFERENCES components(id)  -- Set on approval
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()

INDEX idx_uploads_author ON uploads(author_id)
INDEX idx_uploads_status ON uploads(status)
```

#### `checkpoints`
Private per-user component backups.
```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id         UUID REFERENCES users(id) ON DELETE CASCADE
project_id      TEXT NOT NULL
component_local_id TEXT NOT NULL
component_name  TEXT NOT NULL
version         INTEGER NOT NULL
manifest        JSONB NOT NULL
storage_key     TEXT NOT NULL                -- R2 key for checkpoint package
description     TEXT NOT NULL
trigger         TEXT NOT NULL
                CHECK (trigger IN ('user-accepted', 'manual', 'before-major-change', 'auto-interval'))
created_at      TIMESTAMPTZ DEFAULT now()

UNIQUE (user_id, project_id, component_local_id, version)
INDEX idx_checkpoints_user_project ON checkpoints(user_id, project_id)
INDEX idx_checkpoints_component ON checkpoints(user_id, component_local_id)
```

#### `ratings`
```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
component_id    UUID REFERENCES components(id) ON DELETE CASCADE
user_id         UUID REFERENCES users(id) ON DELETE CASCADE
rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5)
comment         TEXT
created_at      TIMESTAMPTZ DEFAULT now()
updated_at      TIMESTAMPTZ DEFAULT now()

UNIQUE (component_id, user_id)  -- One rating per user per component
```

#### `reports`
```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
component_id    UUID REFERENCES components(id) ON DELETE CASCADE
reporter_id     UUID REFERENCES users(id) ON DELETE CASCADE
reason          TEXT NOT NULL
                CHECK (reason IN ('malicious', 'broken', 'inappropriate', 'copyright', 'other'))
description     TEXT
status          TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed'))
created_at      TIMESTAMPTZ DEFAULT now()

UNIQUE (component_id, reporter_id)  -- One report per user per component
INDEX idx_reports_component ON reports(component_id)
```

#### `download_events`
Tracks downloads for trending calculation. **Partitioned by month** to prevent unbounded growth.

```sql
-- Partitioned table (range partitioning by month)
CREATE TABLE download_events (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  component_id    UUID NOT NULL,   -- No FK on partitioned table (performance)
  user_id         UUID,            -- Nullable (anonymous downloads in future)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Create partitions for current + next month on startup, via maintenance job
CREATE TABLE download_events_2026_03 PARTITION OF download_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE download_events_2026_04 PARTITION OF download_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
-- etc. — a maintenance job creates future partitions and drops partitions > 12 months old

CREATE INDEX idx_download_events_component_time
  ON download_events(component_id, created_at DESC);
```

**Why partitioning from day 1:** At even 1,000 downloads/day, download_events grows to 365K rows/year. Trending queries (`WHERE created_at > now() - interval '7 days'`) scan only the current partition, not the full table. Dropping old partitions is instant (no DELETE overhead). Migrations on a hot table are risky — start partitioned.

**Maintenance job:** A daily pg-boss scheduled job creates next month's partition 5 days early and drops partitions older than 12 months. Trending data beyond 12 months has no product value.

### Quotas

| Resource | Limit | Notes |
|---|---|---|
| Checkpoints per user | 500 total | Across all projects |
| Checkpoint storage | 100 MB | Total R2 storage per user |
| Uploads per hour | 10 | Rate limit (not quota) |

Quotas checked in middleware before accepting checkpoint uploads. Server returns `413 QUOTA_EXCEEDED` with current usage.

### Component Flagging

Components with 3+ unique reports are flagged:
- A `flagged` boolean column on `components` (default false)
- Flagged components are excluded from search results: `WHERE flagged = false`
- A periodic job or trigger sets `flagged = true` when report count >= 3
- Admin can unflag after review (v2: admin dashboard)

### Computed Views / Queries

**Component rating** (computed, not stored as a column):
```sql
rating_sum::float / NULLIF(rating_count, 0) AS rating
```

**Auto-flag on reports:**
```sql
-- Trigger or application logic: when count of reports for a component >= 3,
-- remove component from search results (set a 'flagged' status or separate table)
```

---

## 6. API Layer

All routes are defined in `apps/api/src/routes/` using Hono with Zod validators. The Hono RPC mode exports route types for the Electron client to consume via `hc<AppType>()`.

**All routes are versioned under `/api/v1/`.** Every response includes `API-Version: 1` header. When v2 is introduced, both versions run in parallel during a deprecation window.

### Route Groups

#### Auth Routes (`/api/v1/auth`)
```
POST /api/v1/auth/register
  Input: { email: string }
  Output: 201 { message: 'verification email sent' }

POST /api/v1/auth/verify
  Input: { token: string }
  Output: 200 { apiKey: string, user: User }

POST /api/v1/auth/recover
  Input: { email: string }
  Output: 200 { message: 'recovery email sent' }

POST /api/v1/auth/recover/confirm
  Input: { token: string }
  Output: 200 { apiKey: string }

POST /api/v1/auth/regenerate
  Auth: Required
  Output: 200 { apiKey: string }

DELETE /api/v1/auth/account
  Auth: Required
  Output: 204
```

#### Component Routes (`/api/v1/components`)
```
GET /api/v1/components/search
  Query: { q, tags?, category?, complexity?, limit?, offset?, minRating?, sortBy? }
  Output: 200 { results: SearchResult[], total, offset, limit }

GET /api/v1/components/:id
  Output: 200 { CommunityComponent (without files, with manifest) }

GET /api/v1/components/:id/source
  Query: { includeDeps?: boolean }
  Output: 200 { id, manifest, files: Record<string, string>, summary, authorDisplayName,
                 version, updatedAt, dependencies?: ComponentSource[], missingDependencies?: string[] }

GET /api/v1/components/:id/versions
  Output: 200 { versions: { id, version, summary, createdAt }[] }

GET /api/v1/components/trending
  Query: { period?: 'day'|'week'|'month', limit?: number }
  Output: 200 { results: SearchResult[] }

GET /api/v1/components/popular
  Query: { limit?: number }
  Output: 200 { results: SearchResult[] }

GET /api/v1/components/tags
  Output: 200 { tags: { name: string, count: number }[] }

GET /api/v1/components/categories
  Output: 200 { categories: { name: string, subcategories: string[], count: number }[] }

POST /api/v1/components/:id/rate
  Auth: Required
  Input: { rating: 1-5, comment?: string }
  Output: 200 { rating: number, ratingCount: number }

POST /api/v1/components/:id/report
  Auth: Required
  Input: { reason: 'malicious'|'broken'|'inappropriate'|'copyright'|'other', description?: string }
  Output: 201 { reportId: string }

POST /api/v1/components/:id/revoke
  Auth: Required (uploader only, or admin)
  Input: { reason: 'security'|'abuse'|'legal'|'author-request', message?: string }
  Output: 200 { id, revokedAt }
  Flow: Mark component as revoked → remove from search → notify via check-updates endpoint

POST /api/v1/components/check-updates
  Auth: Required
  Input: { componentIds: string[] }
  Output: 200 {
    updates: { id, currentVersion, latestVersion, changelog?, updatedAt }[],
    revocations: { id, reason: 'security'|'abuse'|'legal'|'author-request', message? }[]
  }
  Note: revocations[] lists component IDs the client has but have been revoked on the server.
        Client shows notification but does NOT auto-delete — user decides.
```

#### Upload Routes (`/api/v1/components/upload`)
```
POST /api/v1/components/upload
  Auth: Required
  Input: { manifest: ComponentManifest, files: Record<string, string> }
  Output: 202 { uploadId: string, status: 'pending' }
  Flow: Validate manifest schema → store package in R2 → create upload record → enqueue review job

GET /api/v1/components/upload/:id/status
  Auth: Required (must be uploader)
  Output: 200 { uploadId, status, currentStage?, completedStages, rejectionReasons?, componentId? }

GET /api/v1/components/upload/:id/stream
  Auth: Required (must be uploader)
  Output: text/event-stream (SSE)
  Events: { stage, status, completedStages, result?, issues? }
  Note: Max 3 concurrent SSE connections per user
```

#### Checkpoint Routes (`/api/v1/checkpoints`)
```
POST /api/v1/checkpoints
  Auth: Required
  Input: { projectId, componentLocalId, componentName, version, files, manifest, description, trigger }
  Output: 201 { id, createdAt }

GET /api/v1/checkpoints/:componentLocalId
  Auth: Required
  Query: { projectId }
  Output: 200 { componentName, checkpoints: { id, version, description, trigger, createdAt }[] }

GET /api/v1/checkpoints/:componentLocalId/:version
  Auth: Required
  Query: { projectId }
  Output: 200 { full checkpoint with files and manifest }

DELETE /api/v1/checkpoints/:componentLocalId/:version
  Auth: Required
  Query: { projectId }
  Output: 204
```

#### User Routes (`/api/v1/users`)
```
GET /api/v1/users/me
  Auth: Required
  Output: 200 { id, email, displayName, createdAt, stats }

GET /api/v1/users/me/components
  Auth: Required
  Query: { limit?, offset? }
  Output: 200 { components: CommunityComponent[], total }

GET /api/v1/users/me/checkpoints
  Auth: Required
  Query: { projectId? }
  Output: 200 { checkpoints grouped by component }

GET /api/v1/users/me/quota
  Auth: Required
  Output: 200 { checkpoints: { used, max }, uploads: { used, max, resetAt } }

PATCH /api/v1/users/me
  Auth: Required
  Input: { displayName?: string }
  Output: 200 { user }
```

---

## 7. Review Pipeline

### Stage Definitions

Each stage is a function with the signature:
```typescript
type StageFunction = (input: PipelineContext) => Promise<StageResult>

interface PipelineContext {
  uploadId: string
  manifest: ComponentManifest
  files: Record<string, string>       // path → source content
  previousResults: StageResult[]      // Results of completed stages
}

interface StageResult {
  stage: string
  status: 'passed' | 'failed' | 'warning'
  duration: number                    // ms
  issues?: Issue[]
  data?: Record<string, any>          // Stage-specific output (enriched manifest, embedding, etc.)
}

interface Issue {
  severity: 'critical' | 'warning' | 'info'
  file?: string
  line?: number
  pattern?: string
  message: string
  fix?: string
}
```

### Stage 1: `manifest_validation` (no LLM)
- Validate `manifest` against `@cslate/shared` Zod schema
- Verify all files in `manifest.files[]` exist in uploaded `files` map
- Verify file naming conventions (ui.tsx, logic.ts, types.ts, context.md)
- Verify `index.ts` exists with barrel exports
- Verify `defaultSize` and `minSize` use `{ width: number, height: number }` format (in grid units ×8px) — reject old `cols/rows` format
- Verify `dataSources` count ≤ 5 if present (error code: `TOO_MANY_DATA_SOURCES`)
- Verify `context.md` length ≤ 2,000 characters (it's an AI-generated summary, not raw chat)
- **Fail:** Invalid manifest, missing files, invalid field values, >5 dataSources

### Stage 2: `security_scan` (static analysis + LLM)
- **Static patterns** (regex/AST scan):
  - Block: `fetch(`, `XMLHttpRequest`, `new WebSocket(`, `navigator.sendBeacon`, `new EventSource(`
  - Block: `window.fetch`, `globalThis.fetch`
  - Block: `eval(`, `new Function(`, `Function(`
  - Block: `document.cookie`, `localStorage`, `sessionStorage`
  - Block: `require("child_process")`, `require("fs")`, `import("electron")`
  - Block: `innerHTML` with dynamic content
  - Allow: `bridge.fetch(`, `bridge.subscribe(`, `bridge.getConfig(`
- **URL validation**:
  - Check `dataSources[].baseUrl` against Tier 1 (known-safe), Tier 3 (blocked)
  - Tier 2 (unknown) → flag for LLM review
- **LLM review** (claude-haiku-4-5 for speed + cost) for:
  - Obfuscation attempts (string concatenation to build `fetch`, encoded payloads)
  - Hidden behavior not matching component's stated purpose
  - Hardcoded sensitive values (API keys, tokens, passwords)
  - Data exfiltration vectors disguised as normal logic
- **Fail:** Any critical security issue

### Stage 3: `dependency_check` (no LLM)
- Validate `dependencies.npmPackages` against allowlist (`packages/pipeline/config/npm-allowlist.json`)
- Check for known vulnerable package versions
- Validate `dependencies.cslateComponents` exist in DB and are approved
- Flag unknown npm packages for manual review
- **Fail:** Malicious or disallowed npm packages. **Warning:** Unknown packages.

### Stage 4: `quality_review` (LLM — claude-sonnet-4-6)

**Static pre-check (before LLM call):**
- Scan all `.tsx`/`.ts` files for raw Tailwind color utilities using regex:
  ```
  /\b(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  ```
- If any hardcoded color utility found → **hard reject** (no LLM call needed):
  ```json
  { "code": "STYLING_TOKEN_VIOLATION",
    "message": "Component uses raw color utilities instead of semantic design tokens. Use bg-primary, text-muted, border-border etc. — not bg-blue-500, text-gray-900." }
  ```
  This is a static rule because CSlate's cross-theme compatibility depends on it absolutely.

**LLM review:**
- Code quality: readability, structure, React best practices
- UI/logic separation: is business logic in `logic.ts`, not `ui.tsx`?
- Type safety: are TypeScript types in `types.ts` complete? No `any` types?
- Manifest accuracy: do declared inputs/outputs/events/actions match actual code?
- Context verification: does code align with requirements in `context.md` (AI-generated summary)?
- dataSources: every `bridge.fetch(sourceId)` matches a declared `dataSources` entry
- userConfig: sensitive fields accessed only via `bridge.getConfig()`, never hardcoded
- Accessibility: semantic HTML, ARIA labels where appropriate
- **Fail:** Major quality issues, token violations. **Warning:** Minor suggestions.

### Stage 5: `test_render` (TypeScript compilation — no headless browser)
- Write uploaded files to temp directory with bridge type stubs + tsconfig
- Run `tsc --noEmit --strict` — zero tolerance for type errors
- Capture all TS errors with file + line numbers
- **Fail:** Any TypeScript compilation error

### Stage 6: `cataloging` (LLM — claude-haiku-4-5)
- Generate 1-2 sentence `summary`
- Assign `category` and `subcategory`
- Estimate `complexity` (simple/moderate/complex)
- Generate `contextSummary` from `context.md` — "why this was built"
- Generate `ai.modificationHints` — specific, file-referencing guidance for future AI agents
- Generate `ai.extensionPoints` — named customization surfaces
- Verify/improve `description` and `tags`
- **Always passes** (enrichment, not validation)

### Stage 7: `embedding` + Store
- Compose embedding input text from: `description` + `name` + `tags` + `summary` + `contextSummary` + `dataSources` descriptions + input/output descriptions
- Call embedding API (text-embedding-3-small, 1536 dims)
- Compute `ai.similarTo` — top 5 nearest neighbors from pgvector
- Detect versioning: if same `name` + same `author_id` exists, create new version (set `parent_id`)
- Store: insert into `components` table, update `uploads` record with `component_id`
- **Always passes**

### Pipeline Orchestration

```typescript
// packages/pipeline/src/runner.ts
async function runPipeline(ctx: PipelineContext, onProgress: ProgressCallback): Promise<PipelineResult> {
  const stages = [
    { name: 'manifest_validation', fn: manifestValidation },   // Zod schema + file structure
    { name: 'security_scan', fn: securityScan },               // Static analysis + LLM
    { name: 'dependency_check', fn: dependencyCheck },         // npm allowlist + CSlate deps
    { name: 'quality_review', fn: qualityReview },             // LLM code quality + context
    { name: 'test_render', fn: testRender },                   // TypeScript compilation
    { name: 'cataloging', fn: cataloging },                    // LLM summary + ai hints
    { name: 'embedding', fn: embeddingAndStore },              // Vector + DB store
  ]

  for (const stage of stages) {
    onProgress({ stage: stage.name, status: 'in_progress' })
    const result = await stage.fn(ctx)
    ctx.previousResults.push(result)
    onProgress({ stage: stage.name, status: 'complete', result })

    if (result.status === 'failed') {
      return { status: 'rejected', completedStages: ctx.previousResults }
    }
  }

  return { status: 'approved', completedStages: ctx.previousResults }
}
```

**Smart retry:** If a job fails mid-pipeline (e.g., LLM timeout at Stage 4), pg-boss retries. The worker checks `upload.completed_stages` and skips already-passed stages.

---

## 8. Search & Embedding

### Composite Embedding

When generating an embedding for a component, we compose a text document from multiple manifest fields:

```
Component: {name}
Description: {description}
Tags: {tags.join(', ')}
Summary: {summary}
Context: {contextSummary}           ← AI summary from context.md (max 2,000 chars)
Data Sources: {dataSources[].description joined}
Inputs: {inputs[].description joined}
Outputs: {outputs[].description joined}
```

`context.md` uploaded by the client is an AI-generated summary of why the component was built (not raw chat history). This makes it ideal for embedding — it captures intent and use case in concise natural language.

This composite text is embedded via OpenAI `text-embedding-3-small` (1536 dimensions).

### Search Flow

1. Client sends `q` (natural language query)
2. Server embeds `q` using same embedding model
3. pgvector cosine similarity search:
   ```sql
   SELECT *, 1 - (embedding <=> query_embedding) AS relevance_score
   FROM components
   WHERE flagged = false
     AND (tags && $tags OR $tags IS NULL)
     AND (category = $category OR $category IS NULL)
     AND (complexity = $complexity OR $complexity IS NULL)
     AND (rating_sum::float / NULLIF(rating_count, 0) >= $minRating OR $minRating IS NULL)
   ORDER BY
     CASE $sortBy
       WHEN 'relevance' THEN 1 - (embedding <=> query_embedding)
       WHEN 'rating' THEN rating_sum::float / NULLIF(rating_count, 0)
       WHEN 'downloads' THEN download_count
       WHEN 'recent' THEN EXTRACT(EPOCH FROM created_at)
     END DESC
   LIMIT $limit OFFSET $offset
   ```
4. Return results with full manifests (including `ai` field)

### HNSW Index

```sql
CREATE INDEX idx_components_embedding
ON components USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

Default `ef_search = 40` is sufficient for <100K components. Tunable per-session if needed.

---

## 9. File Storage

### R2 Key Structure

```
packages/
  components/
    {component-id}/
      {version}/
        manifest.json
        ui.tsx
        logic.ts
        types.ts
        context.md
        index.ts
  checkpoints/
    {user-id}/
      {project-id}/
        {component-local-id}/
          {version}/
            manifest.json
            ui.tsx
            logic.ts
            ...
  uploads/
    {upload-id}/                      # Temporary, pre-review
      manifest.json
      ui.tsx
      ...
```

### Storage Operations

**Upload:** Files arrive as `Record<string, string>` in the JSON body. Server writes each file to R2 individually under the upload key. Total package size limit: 2MB.

**Retrieval:** Server reads all files for a component from R2, returns as `Record<string, string>`.

**Cleanup:** Failed/rejected uploads have their R2 keys cleaned up by a periodic job (daily).

---

## 10. Authentication

### API Key Flow

1. **Register:** Client sends email → server generates API key (`cslate_` + 32 random bytes base64url) → stores SHA-256 hash → returns raw key (only time it's shown)
2. **Authenticate:** Client sends `Authorization: ApiKey cslate_xxxxx` header → server hashes the key → looks up user by hash
3. **Regenerate:** Authenticated user requests new key → old hash replaced → new raw key returned

### Middleware

```typescript
// Auth middleware validates API key on every request except /api/auth/register
const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('ApiKey ')) throw new HTTPException(401)
  const key = header.slice(7)
  const hash = sha256(key)
  const user = await db.query.users.findFirst({ where: eq(users.apiKeyHash, hash) })
  if (!user) throw new HTTPException(401)
  c.set('user', user)
  await next()
})
```

---

## 11. Job Queue

### pg-boss Configuration

```typescript
const boss = new PgBoss({
  connectionString: DATABASE_URL,
  retryLimit: 3,
  retryDelay: 30,           // 30 seconds between retries
  retryBackoff: true,        // Exponential backoff
  expireInHours: 24,         // Jobs expire after 24h
  archiveCompletedAfterSeconds: 7 * 24 * 3600,  // Archive after 7 days
})
```

### Job Types

```typescript
// Review job
boss.work('review-component', { teamConcurrency: 5 }, async (job) => {
  const { uploadId } = job.data
  const upload = await getUpload(uploadId)
  const files = await storage.getComponentFiles(upload.storageKey)
  const ctx: PipelineContext = { uploadId, manifest: upload.manifest, files, previousResults: [] }

  await runPipeline(ctx, async (progress) => {
    // Update upload record + notify SSE listeners via pg_notify
    await updateUploadProgress(uploadId, progress)
    await db.execute(sql`SELECT pg_notify(${`upload:${uploadId}`}, ${JSON.stringify(progress)})`)
  })
})

// Maintenance jobs (periodic)
boss.schedule('cleanup-failed-uploads', '0 3 * * *', {})  // Daily at 3 AM — prune R2 + DB
boss.schedule('create-partition', '0 0 25 * *', {})       // Monthly: create next month's partition
boss.schedule('drop-old-partitions', '0 1 1 * *', {})     // Monthly: drop partitions > 12 months
```

**`teamConcurrency: 5` — calibrated to LLM rate limits:**
- Claude claude-sonnet-4-6 rate limit: ~60 RPM (Anthropic default)
- Each pipeline: ~3 LLM calls, each taking 10-30s → ~2 RPM per pipeline
- 5 concurrent pipelines × 2 RPM = 10 RPM — well under 60 RPM limit, with headroom for retries
- Increase to 15-20 if on a higher Anthropic tier

---

## 12. Real-Time Updates (SSE)

### SSE Stream for Review Progress

**Implementation: Postgres LISTEN/NOTIFY** (not polling)

The worker publishes a notification after each stage update. The SSE handler holds an open Postgres connection and LISTENS on a per-upload channel. No polling loops — purely event-driven.

```typescript
// Worker: after each stage completes, notify the SSE channel
// packages/pipeline/src/runner.ts
async function notifyProgress(db: Pool, uploadId: string, progress: StageProgress) {
  await db.query(
    `SELECT pg_notify($1, $2)`,
    [`upload:${uploadId}`, JSON.stringify(progress)]
  )
}

// API: SSE endpoint subscribes via LISTEN
// apps/api/src/routes/uploads.ts
app.get('/api/components/upload/:id/stream', authMiddleware, async (c) => {
  const uploadId = c.req.param('id')
  const upload = await getUpload(uploadId)

  // Verify ownership
  if (upload.authorId !== c.get('user').id) throw new HTTPException(403)

  // If already terminal, return immediately (no SSE connection needed)
  if (upload.status === 'approved' || upload.status === 'rejected') {
    return c.json({ status: upload.status, componentId: upload.componentId,
                    rejectionReasons: upload.rejectionReasons })
  }

  return streamSSE(c, async (stream) => {
    // Acquire a dedicated pg connection for LISTEN (not from the query pool)
    const pgClient = await pgPool.connect()
    try {
      await pgClient.query(`LISTEN "upload:${uploadId}"`)

      // Send current state immediately so client doesn't wait for first notification
      await stream.writeSSE({
        event: 'stage',
        data: JSON.stringify({
          stage: upload.currentStage,
          status: 'in_progress',
          completedStages: upload.completedStages,
        })
      })

      // SSE connection timeout: max 10 minutes (pipeline shouldn't take longer)
      const timeout = setTimeout(() => pgClient.release(), 10 * 60 * 1000)

      pgClient.on('notification', async (msg) => {
        const progress = JSON.parse(msg.payload!)
        await stream.writeSSE({ event: 'stage', data: JSON.stringify(progress) })

        if (progress.status === 'approved' || progress.status === 'rejected') {
          await stream.writeSSE({
            event: 'complete',
            data: JSON.stringify(progress)
          })
          clearTimeout(timeout)
          pgClient.release()
        }
      })

      // Keep SSE open until client disconnects or pipeline completes
      await stream.close()
    } finally {
      pgClient.release()
    }
  })
})
```

**Why LISTEN/NOTIFY over polling:**
- Polling 2s per client × 100 concurrent users = 50 DB queries/second just for progress updates. Pure noise.
- LISTEN/NOTIFY is event-driven: 0 queries per second at rest, 1 notification per stage transition regardless of connected clients.
- Postgres LISTEN uses a dedicated long-lived connection (not a query pool slot) — the dedicated `pgPool` (separate from Drizzle's pool) is sized for concurrent SSE connections.

**SSE connection rate limiting:** Max 3 concurrent SSE connections per user (checked in middleware before establishing LISTEN). Prevents a misbehaving client from exhausting the dedicated pg connection pool.

**`pgPool` sizing:** Dedicated pool for LISTEN connections only. Size = `MAX_SSE_CONNECTIONS_PER_USER × expected_concurrent_users` (e.g., 3 × 30 users = 90 connections, well within Neon pooler limits via PgBouncer).

**Fallback:** `GET /api/components/upload/:id/status` for clients that can't use SSE (polls on-demand at their own rate).

---

## 13. Rate Limiting

### Per-User Limits

| Endpoint Group | Limit | Window |
|---|---|---|
| Search | 100 req/min | Sliding window |
| Component retrieval | 120 req/min | Sliding window |
| Upload | 10 req/hour | Fixed window |
| Checkpoint upload | 60 req/hour | Fixed window |
| Checkpoint retrieval | 120 req/min | Sliding window |
| Report | 10 req/hour | Fixed window |
| Rating | 30 req/min | Sliding window |

### Implementation

Rate limiting via a simple Postgres-backed counter (no Redis needed):
- Table: `rate_limits (user_id, endpoint_group, window_start, count)`
- Middleware checks/increments count per request
- Cleanup: expired windows pruned by periodic job

### Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1711612800
X-RateLimit-RetryAfter: 13          // Seconds until next allowed request (only on 429)
```

---

## 14. Error Handling

### Consistent Error Format

```typescript
interface ApiError {
  error: {
    code: string          // Machine-readable: COMPONENT_NOT_FOUND
    message: string       // Human-readable description
    details?: any         // Validation errors, stage results, etc.
  }
  statusCode: number
}
```

### Error Codes

| Code | HTTP | When |
|---|---|---|
| AUTH_REQUIRED | 401 | Missing or invalid API key |
| FORBIDDEN | 403 | Not authorized for this resource |
| NOT_FOUND | 404 | Component, upload, checkpoint not found |
| VALIDATION_ERROR | 400 | Invalid request body/params (Zod errors in details) |
| MANIFEST_INVALID | 400 | Manifest fails Zod schema validation |
| UPLOAD_TOO_LARGE | 413 | Package exceeds 2MB or file exceeds 500KB |
| REVIEW_REJECTED | 422 | Component failed review (stage results in details) |
| REVIEW_IN_PROGRESS | 200 | Upload still being reviewed (not an error, informational) |
| RATE_LIMITED | 429 | Too many requests |
| DUPLICATE_REPORT | 409 | User already reported this component |
| SERVER_ERROR | 500 | Unexpected internal error |

### Global Error Handler

```typescript
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: { code: err.message, message: err.cause }, statusCode: err.status }, err.status)
  }
  logger.error({ err }, 'Unhandled error')
  return c.json({ error: { code: 'SERVER_ERROR', message: 'Internal server error' }, statusCode: 500 }, 500)
})
```

---

## 15. Deployment

### Fly.io Configuration

**API Server (`fly.api.toml`):**
```toml
app = "cslate-api"
primary_region = "iad"

[build]
  dockerfile = "apps/api/Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**Worker (`fly.worker.toml`):**
```toml
app = "cslate-worker"
primary_region = "iad"

[build]
  dockerfile = "apps/worker/Dockerfile"

[metrics]
  port = 9091
  path = "/metrics"

# No http_service — worker doesn't serve HTTP (except Prometheus metrics)

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**FAS Autoscaler** — scales workers based on pg-boss queue depth:
- Worker exposes `cslate_queue_depth` Prometheus metric on port 9091
- FAS reconciles every 15s: `desired = max(1, ceil(queue_depth / 3))`
- Min 1 worker, max 10 workers

### Environment Variables

```
DATABASE_URL=            # Neon connection string (pooled)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
ANTHROPIC_API_KEY=       # For all LLM calls (security, quality, cataloging)
OPENAI_API_KEY=          # For embeddings only (text-embedding-3-small)
LLM_QUALITY_MODEL=       # 'claude-sonnet-4-6' (security + quality review)
LLM_CATALOG_MODEL=       # 'claude-haiku-4-5-20251001' (cataloging)
EMBEDDING_MODEL=         # 'text-embedding-3-small'
```

---

## 16. Testing Strategy

### Unit Tests
- Each pipeline stage tested independently with fixture component packages
- Zod schema validation edge cases
- URL allowlist/blocklist matching
- API key hashing and verification
- Rate limit counter logic

### Integration Tests
- Full pipeline run with test component packages (approved + rejected cases)
- Search query → embedding → pgvector similarity → ranked results
- Upload → review → approval → searchable flow
- Checkpoint CRUD operations
- Auth flow (register → authenticate → regenerate → delete)

### Test Infrastructure
- **Local Postgres** with pgvector via Docker (`pgvector/pgvector:pg16`)
- **Test R2** — use MinIO locally as S3-compatible storage
- **LLM mocking** — for fast tests, mock LLM responses. For integration tests, use real LLM with small test components
- **Vitest** as test runner (fast, TypeScript-native, workspace support)

### Test Commands
```
pnpm test              # Run all unit tests
pnpm test:integration  # Run integration tests (requires Docker)
pnpm test:pipeline     # Run pipeline tests specifically
```
