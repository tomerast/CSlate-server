# Decision 005: Server Framework & Infrastructure

**Date:** 2026-03-28
**Status:** Pending

## Context

CSlate-Server needs a TypeScript backend framework and data infrastructure to handle:
- Component upload API (multi-file packages)
- AI review pipeline (multi-stage, async, 1-3 min per component)
- pgvector semantic search
- API key authentication
- Real-time status updates (review progress)
- Object storage for component source files

## Framework Comparison

### Express + tRPC

| Dimension | Rating | Notes |
|---|---|---|
| Performance | C+ | ~9.4k req/s — 5x slower than Fastify. Irrelevant for CSlate's I/O-bound workload |
| TypeScript | A+ | tRPC gives end-to-end type safety with Electron client, zero codegen |
| File uploads | A | Multer is battle-tested + tRPC FormData support |
| WebSocket/SSE | A | tRPC subscriptions via SSE with auto-reconnect, or full WS |
| Plugin architecture | B | Express middleware is linear, tRPC middleware is typed. Neither suits pipeline orchestration (need job queue) |
| Ecosystem | A+ | 96M weekly downloads, universal knowledge |
| Production readiness | A | Most deployed Node.js framework in history |
| Logging | B | No built-in structured logging (bring Pino) |

**Key strength:** tRPC's end-to-end type safety is ideal for TypeScript-on-both-ends.
**Key weakness:** Express raw throughput is lowest. No built-in structured logging or graceful shutdown.

### Fastify

| Dimension | Rating | Notes |
|---|---|---|
| Performance | A | ~46.7k req/s — 5x Express. Fast JSON serialization via schema |
| TypeScript | A- | Type Providers (TypeBox/Zod) give runtime validation + static types. Verbose generics |
| File uploads | A | @fastify/multipart with streaming, size limits, disk storage |
| WebSocket | A- | @fastify/websocket, but no rooms/pub-sub (manage yourself) |
| Plugin architecture | A+ | Encapsulated scopes, async dependency resolution, hooks per scope. Maps perfectly to CSlate domains |
| Ecosystem | A | 35.9k stars, 6.1M weekly downloads, 50+ official plugins |
| Production readiness | A+ | Built-in Pino logging with request correlation, graceful shutdown, error handlers per scope |
| Logging | A+ | Pino is integrated at the framework level — request-correlated structured JSON |

**Key strength:** Plugin architecture maps naturally to CSlate's domain separation (review, catalog, search, auth). Production-grade logging/shutdown built-in.
**Key weakness:** No end-to-end type safety with client (need OpenAPI codegen or shared TypeBox schemas). Verbose TypeScript generics.

### Hono

| Dimension | Rating | Notes |
|---|---|---|
| Performance | A | Competitive with Fastify on Node.js. Fastest on Bun |
| TypeScript | A+ | RPC mode gives end-to-end type safety like tRPC, zero codegen. Zod integration |
| File uploads | B+ | Native parseBody() for multipart. No streaming, no disk storage strategy (manual) |
| WebSocket | A- | Built-in upgradeWebSocket, participates in RPC types. Basic (no rooms/pub-sub) |
| Plugin architecture | B+ | Onion-model middleware, good but no encapsulated scopes like Fastify |
| Ecosystem | B+ | 45k+ stars, 35M downloads. Smaller plugin ecosystem than Express/Fastify |
| Production readiness | B+ | No built-in structured logging, no built-in graceful shutdown. More DIY |
| Logging | B- | Basic console logger. Bring Pino + build request correlation yourself |

**Key strength:** RPC type safety is a killer feature — typed API client for Electron with zero codegen. Lightweight, modern.
**Key weakness:** Less battle-tested for traditional long-running servers. More architectural setup work (logging, shutdown, file storage). Smaller ecosystem for Node.js-specific patterns.

## Head-to-Head: The Three Deciding Factors for CSlate

### 1. Type Safety with Electron Client

| | Express + tRPC | Fastify | Hono |
|---|---|---|---|
| Client type safety | End-to-end via shared AppRouter type | Requires OpenAPI codegen or shared schemas | End-to-end via RPC mode |
| Validation + types | Zod (single source of truth) | TypeBox or Zod (single source) | Zod (single source) |
| Effort | Zero codegen | Extra step (generate client) | Zero codegen |

**Winner:** tRPC and Hono RPC are tied. Fastify requires extra work.

### 2. Production Readiness for CSlate's Workload

| | Express + tRPC | Fastify | Hono |
|---|---|---|---|
| Structured logging | Manual (add Pino) | Built-in (Pino integrated) | Manual (add Pino) |
| Graceful shutdown | Manual | Built-in (onClose hooks) | Manual |
| Error handling | Manual + tRPC error formatting | Built-in per-scope error handlers | Manual (app.onError) |
| File uploads | Multer (excellent) | @fastify/multipart (excellent) | Basic (no streaming/disk) |

**Winner:** Fastify. It ships production-ready out of the box.

### 3. Architecture Fit for CSlate's Domains

| | Express + tRPC | Fastify | Hono |
|---|---|---|---|
| Domain isolation | Route-level only | Plugin scopes with encapsulation | Sub-app splitting |
| Auth scoping | Global middleware | Scope hooks to specific plugins | Route-group middleware |
| Plugin dependency mgmt | Manual | avvio async resolution | Manual |
| Testing isolation | Moderate | Excellent (test plugins independently) | Good |

**Winner:** Fastify's plugin architecture is purpose-built for this.

## Recommendation: Hono

**Despite Fastify winning on production readiness and architecture, I recommend Hono for these reasons:**

1. **RPC type safety is transformative for CSlate.** Both repos are TypeScript. The Electron client gets a fully typed API client with zero codegen, zero shared packages, zero OpenAPI specs. Change a server endpoint → client immediately shows type errors. For a two-person (you + AI) team, this eliminates an entire category of bugs.

2. **The production readiness gap is closable.** Adding Pino structured logging + graceful shutdown to Hono is ~50 lines of middleware. You do it once. Fastify's plugin architecture advantage is real but the AI review pipeline will use a job queue regardless — the framework's plugin system doesn't drive pipeline orchestration.

3. **Hono is lighter and more modern.** ~15kb core, sub-second startup. The Web Standards foundation means your code is portable. If Bun matures, you can switch runtimes for free performance.

4. **Zod as single source of truth.** Hono's `@hono/zod-validator` means your Zod schemas simultaneously validate at runtime AND generate the RPC types. One schema definition → runtime checks + client types + OpenAPI docs (via `@hono/zod-openapi`).

5. **WebSocket typing.** Hono's WebSocket helper participates in RPC mode — the Electron client gets typed WebSocket connections for review progress. This is unique to Hono.

**What we accept:**
- More DIY for logging, shutdown, file storage (~2-3 hours of setup)
- Smaller ecosystem (mitigated by using generic Node.js libraries)
- Fewer "Hono + traditional server" war stories (mitigated by the framework's simplicity)

**Escape hatch:** If Hono proves problematic, the Zod schemas and Drizzle queries are framework-agnostic. Migration to Fastify would be a route-layer rewrite, not a full rebuild.

## ORM: Drizzle

**No contest for CSlate's use case.**

- First-class pgvector support (native `vector()` column, `cosineDistance()`, HNSW index)
- Best TypeScript inference (no codegen, schema-driven types)
- SQL-like API gives full control for vector queries
- JSONB support for storing manifest.json
- Lightweight (~7.4kb), zero dependencies
- drizzle-kit for migrations (generate SQL files, version-controlled)

### Alternatives rejected:
- **Prisma:** No native pgvector — must use raw SQL for all vector operations. Defeats the purpose.
- **Kysely:** Good but requires manual type definitions for vector operations.
- **Raw pg:** Maximum flexibility but no type safety. Maintenance burden too high.

## Database: PostgreSQL + pgvector

- **Hosting:** Neon (free tier, auto-scaling to zero, native pgvector, database branching for testing migrations)
- **Vector index:** HNSW with cosine distance
- **Embedding dimensions:** 1536 (OpenAI text-embedding-3-small or equivalent)
- **Connection pooling:** pg Pool for MVP, PgBouncer for production multi-instance

### Scale expectations:
| Components | Query latency | Storage (vectors only) |
|---|---|---|
| 1,000 | < 5ms | ~6MB |
| 10,000 | < 10ms | ~60MB |
| 100,000 | 10-50ms | ~600MB |

## File Storage: Object Storage (not Postgres)

- **Component source files** stored in S3-compatible object storage (Cloudflare R2 recommended — no egress fees)
- **Postgres stores:** manifest (JSONB), metadata columns, embedding (vector), review status, S3 key reference
- **Why not Postgres:** Blob storage bloats the DB, slows backups, pressures connection pools. Object storage is purpose-built.

### Storage structure:
```
packages/
  {component-id}/
    {version}/
      manifest.json
      ui/login-form.tsx
      logic/login-form.hook.ts
      types/login-form.types.ts
      context/decisions.md
      ...
```

## Job Queue: BullMQ (Redis) or pg-boss (Postgres)

For the async AI review pipeline:
- **BullMQ** if we want maximum features (priorities, retries, progress, job dependencies, concurrency control). Requires Redis.
- **pg-boss** if we want to avoid Redis (uses Postgres for job storage). Simpler but fewer features.

**Recommendation:** Start with **pg-boss** to keep infrastructure simple (just Postgres). Migrate to BullMQ if we need advanced job orchestration features later.

## Full Stack Summary

| Layer | Technology | Why |
|---|---|---|
| Framework | Hono | RPC type safety with Electron client, lightweight, modern |
| Runtime | Node.js | Ecosystem maturity, all npm packages work. Bun possible later |
| ORM | Drizzle | First-class pgvector, best TS inference, SQL-like control |
| Database | PostgreSQL + pgvector (Neon) | Semantic search, auto-scaling, free tier |
| File storage | Cloudflare R2 (S3-compatible) | No egress fees, purpose-built for files |
| Job queue | pg-boss | Postgres-backed, no Redis needed for MVP |
| Logging | Pino (manual integration) | Fastest Node.js logger, structured JSON |
| Validation | Zod | Single source for runtime validation + RPC types + OpenAPI |
