# Decision 006: Server Architecture Pattern

**Date:** 2026-03-28
**Status:** Accepted

## Context

CSlate-Server needs an architecture pattern that handles:
- REST API serving (search, retrieval, upload, auth) — fast, I/O-bound
- 7-stage AI review pipeline — slow (1-3 min), LLM API calls, async
- Variable load — 0-50 uploads/day initially, potentially 1000+/day

## Options Evaluated

### A) Monolith — Single Process, Modular
API + pipeline worker in one process.
- **Pro:** Simplest to develop, deploy, debug
- **Con:** Review pipeline shares resources with API. Can't scale independently.

### B) Worker Separation — API + Worker Process (Selected)
Same codebase, two deployment targets. API enqueues jobs, workers consume them.
- **Pro:** API stays responsive. Workers scale independently. Clean separation.
- **Con:** Two processes to deploy. Minor local dev complexity.

### C) Microservices — Separate Service Per Pipeline Stage
Each of the 7 pipeline stages as an independent service.
- **Pro:** Maximum per-stage scaling and fault isolation.
- **Con:** Enormous operational overhead for negligible benefit at this scale.

## Deep Analysis: Why NOT Microservices

This was thoroughly evaluated, not dismissed on principle. The reasoning is specific to CSlate's workload:

### 1. LLM stages are I/O-bound, not compute-bound
CSlate calls external LLM APIs (Claude, GPT-4o). Workers spend 95% of their time *waiting on HTTP responses*, not computing. A single Node.js worker handles dozens of concurrent LLM calls via async/await. You don't need 10 instances of one stage — you need more concurrent async operations, which Node.js handles natively.

**Contrast with microservices use case:** Video transcoding or ML inference ARE compute-bound — each frame/batch consumes 100% CPU. Those workloads genuinely benefit from per-stage scaling. CSlate's workload does not.

### 2. Network overhead per stage adds up
7 microservices = 6 inter-service calls per pipeline run. Each adds serialization, network latency (10-50ms), potential failure, and retry logic. For a pipeline already taking 1-3 minutes, this adds 200-500ms of overhead plus significant failure surface area.

### 3. Shared state is heavy
Component files, manifests, review results, and pipeline status are accessed by every stage. Sharing through function calls is free; sharing through network calls requires either a shared database (coupling through data) or large payloads between services.

### 4. Operational overhead is the real cost
8 services (7 stages + API) each need: Dockerfile, CI/CD pipeline, health checks, scaling config, env vars, secrets, logging config. That's your entire operational capacity consumed by infrastructure instead of product.

### 5. Observability is dramatically harder
Monolith: `WHERE pipelineRunId = 'xyz'` shows the entire pipeline in one log stream.
Microservices: Requires OpenTelemetry instrumentation across 8 services, a trace collector (Jaeger/SigNoz), and trace ID propagation in every inter-service call.

### 6. Real-world validation
- Shopify: explicitly rejected microservices, runs modular monolith with thousands of engineers
- Vercel (v0): monolithic Next.js with streaming LLM calls, not per-stage services
- Uber: grew to 2,200 microservices, consolidated back via DOMA after finding simple investigations required "50 services across 12 teams"

## Decision: Approach B — Worker Separation

### Architecture
```
Single codebase (Turborepo monorepo), two deployment targets:

[API Process]     ──── Hono routes, auth, search, upload, SSE
       │
       │ (enqueue job via pg-boss)
       │
[Worker Process]  ──── pg-boss consumer, runs all 7 pipeline stages
       │
       ├── Stage 1: structuralValidation(component)
       ├── Stage 2: securityAnalysis(component)
       ├── Stage 3: codeQualityReview(component)  ← LLM call
       ├── Stage 4: contextVerification(component) ← LLM call
       ├── Stage 5: manifestEnrichment(component)  ← LLM call
       ├── Stage 6: embeddingGeneration(component)
       └── Stage 7: cataloging(component)
```

### Monorepo Structure (Turborepo + pnpm workspaces)
```
cslate-server/
  apps/
    api/          # Hono API server (deployable)
    worker/       # pg-boss worker process (deployable)
  packages/
    db/           # Drizzle schema, migrations, connection
    shared/       # Zod schemas, types, constants (mirrors @cslate/shared)
    queue/        # pg-boss job definitions, typed job creators
    pipeline/     # Review pipeline stages (shared between worker and tests)
    storage/      # R2 client, file operations
  turbo.json
  pnpm-workspace.yaml
```

### Key Design Principles

1. **Stages are functions, not services.** Each stage has a clean interface: `(input: StageInput) => Promise<StageOutput>`. They live in `packages/pipeline/` and are imported by the worker. This gives the option to extract any stage later without refactoring.

2. **pg-boss handles orchestration.** Job persistence, retries with exponential backoff, concurrency control, multi-instance coordination via SKIP LOCKED. No Redis needed.

3. **Horizontal scaling via worker instances.** Multiple worker instances safely dequeue from pg-boss without conflicts. Each worker can process N concurrent pipelines (configurable).

4. **Stage-level parallelism within a single pipeline.** Stages 3 (quality) and 4 (context verification) are independent — run via `Promise.all([stage3(), stage4()])`. No infrastructure change needed.

5. **Smart retry.** Persist stage progress in job data: `{ completedStages: [1, 2], currentStage: 3 }`. On retry, skip completed stages.

### Deployment: Fly.io
- **`cslate-api`**: 1 always-on machine (shared-cpu-1x, 512MB). ~$3.50/mo
- **`cslate-worker`**: 1+ machines, auto-scaled via FAS (Fly Autoscaler) based on pg-boss queue depth exposed as Prometheus metric. Sub-second cold starts for stopped machines. Pay-per-second.
- **Neon**: Postgres + pgvector (free tier)
- **Cloudflare R2**: Component file storage (free tier)

**Total cost at low volume: ~$7/month**
**At 1000 uploads/day: ~$50-80/month** (auto-scaled workers)

### When to Evolve

| Signal | Action |
|---|---|
| Need per-stage concurrency control | Split into per-stage pg-boss queues (Architecture B variant) |
| One stage needs different compute (e.g., GPU) | Extract THAT stage into a separate service |
| Team grows to 5+ pipeline engineers | Consider modular monolith with enforced boundaries |
| 10,000+ daily uploads | Evaluate K8s + KEDA for more sophisticated scaling |

The architecture evolves by extracting specific bottlenecks, not by starting over.
