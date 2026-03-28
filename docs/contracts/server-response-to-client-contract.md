# Server Response to Client API Contract

**Date:** 2026-03-28
**From:** CSlate-Server
**Re:** `CSlate/docs/contracts/server-api-contract.md` v1.0 Draft

---

## Summary

The contract is a solid foundation. We **agree** with most of the API surface, endpoint design, error handling, rate limiting, and lifecycle flow. We have **3 significant disagreements** and **several additions** the client needs to know about.

---

## AGREE

### 1. Server Responsibilities — Fully Agreed
All 7 responsibilities match our design exactly. The "server does NOT" list is also correct.

### 2. API Endpoints — Mostly Agreed
The endpoint structure is clean and RESTful. We agree on:
- `GET /api/components/search` — semantic search
- `GET /api/components/:id` — component metadata
- `GET /api/components/:id/source` — blueprint source retrieval
- `POST /api/components/upload` → 202 Accepted → async review
- `GET /api/components/upload/:id/status` — review progress polling
- `GET /api/components/trending`, `/popular`, `/tags`, `/categories`
- Checkpoint CRUD endpoints
- User profile endpoints

### 3. Upload Lifecycle — Agreed
The 202 Accepted → async pipeline → poll for status flow is exactly right.

### 4. Error Handling — Agreed
The `ApiError` format and error codes are well-designed. We'll implement this exactly as specified.

**One addition:** We'll add a `REVIEW_IN_PROGRESS` status code (HTTP 200) for the upload status endpoint, since review takes 1-3 minutes and the client needs to distinguish "still reviewing" from "pending in queue."

### 5. Rate Limiting — Agreed with Minor Adjustments
The limits and headers are reasonable. We'll adjust slightly:
- Search: 60 req/min → **100 req/min** (search should feel instant and unlimited to users)
- Upload: 10 req/hour → agreed (prevents spam)
- We'll add a `X-RateLimit-RetryAfter` header (seconds until reset) for better client UX

### 6. Search & Retrieval — Agreed
The `SearchRequest` and `SearchResponse` interfaces are well-designed. The `sortBy` options and filtering are good.

**One addition to SearchResponse results:** We'll include an `ai` field with `modificationHints` and `extensionPoints` from the manifest. This helps the client AI agent understand HOW to modify a blueprint before even fetching the full source.

### 7. Checkpoint Backup — Agreed
This is a valuable feature. The data model and endpoints are clean. We'll implement as specified.

**One note:** Checkpoints should have storage quotas per user (e.g., 100 checkpoints, 50MB total). We'll add a `GET /api/users/me/quota` endpoint so the client can check remaining space.

---

## DISAGREE

### DISAGREE 1: Component as Single `sourceCode: string` → Should Be Multi-File Package

**Client contract says:**
```typescript
sourceCode: string;  // React + Tailwind component code
```

**We disagree.** A component should be a **multi-file package**, not a single string. This was a deliberate design decision on the server side (see `docs/decisions/001-component-package-structure.md`).

**Why this matters:**

1. **UI/Logic separation is essential for AI agents.** When a future user's AI agent retrieves a blueprint, it needs to know which file to modify for visual changes (UI) vs behavioral changes (logic). A single string forces the AI to parse and understand everything at once.

2. **The review agent needs structure to review.** Our 7-stage review pipeline checks UI/logic separation, type safety, manifest accuracy, and context/decisions documentation. A single string blob makes quality review significantly harder.

3. **Context preservation is CSlate's differentiator.** Every component should carry `context/decisions.md` — the conversation context and design decisions that created it. This is what makes CSlate's community library smarter than a code dump.

**Proposed package structure:**
```
{component-name}/
├── manifest.json                     # Machine-readable metadata
├── context/
│   └── decisions.md                  # User conversation context, why decisions were made
├── ui/
│   ├── {component-name}.tsx          # Presenter (pure visual)
│   ├── {component-name}.variants.ts  # Visual variants
│   └── parts/                        # Sub-components (if compound)
├── logic/
│   ├── {component-name}.hook.ts      # Business logic, state, side effects
│   └── {component-name}.utils.ts     # Pure utilities (if needed)
├── types/
│   └── {component-name}.types.ts     # TypeScript interfaces
├── examples/
│   └── {component-name}.examples.tsx # Usage examples
└── index.ts                          # Barrel exports
```

**Upload format change:**
Instead of `{ sourceCode: string, manifest: ComponentManifest }`, the upload should be:
```typescript
// Option A: Multipart upload with files
POST /api/components/upload
Content-Type: multipart/form-data

// Option B: JSON with files map (simpler for client)
POST /api/components/upload
{
  manifest: ComponentManifest,        // The manifest
  files: {
    "ui/login-form.tsx": "...",       // File path → source content
    "logic/login-form.hook.ts": "...",
    "types/login-form.types.ts": "...",
    "context/decisions.md": "...",
    "index.ts": "..."
  }
}
```

**We recommend Option B** — JSON with a files map. Simpler for the client to construct, no multipart complexity, and the total payload is still small (component packages are 5-50KB).

**Source retrieval also changes:**
```typescript
interface ComponentSourceResponse {
  id: string;
  manifest: ComponentManifest;
  files: Record<string, string>;      // File path → source content
  summary: string;
  authorDisplayName: string;
  version: string;
  updatedAt: string;
}
```

**Impact on client:** The client's local AI agent should generate components in this package structure. When the user finalizes a component, the client bundles all files + the conversation context into a package and uploads it. The client-side rendering sandbox imports from the package's `index.ts`.

---

### DISAGREE 2: Auth — JWT is Overkill for MVP, Use API Key

**Client contract says:** JWT with register/login/refresh/delete endpoints.

**We recommend: Simple API Key for MVP** (see `docs/decisions/004-authentication-strategy.md`).

**Why:**
1. CSlate is a desktop app, not a web app. There's no browser session to manage. An API key stored in Electron's `safeStorage` is simpler and equally secure.
2. JWT refresh token flows add complexity (token rotation, revocation, storage) with no benefit for a desktop client that's always "logged in."
3. API keys are simpler to implement, debug, and manage. One header: `Authorization: Bearer cslate_xxxxx`.

**Proposed auth flow:**
```
POST /api/auth/register    { email: string } → sends verification email
POST /api/auth/verify      { token: string } → returns { apiKey: string }
DELETE /api/auth/account    → deletes account + all data
```

That's it. No login, no refresh, no token rotation. The API key is the session.

**Migration path to JWT/OAuth:** When we add social login (Phase 2), we can issue JWTs alongside API keys. The API key stays valid as a "personal access token." No breaking changes.

**If the client team strongly prefers JWT,** we can implement it — but it adds 2-3 days of work for zero user-facing benefit at the MVP stage.

---

### DISAGREE 3: ComponentManifest — Needs Enrichment

**Client contract's manifest** has good basics (inputs, outputs, events, actions, defaultSize) but is missing fields that are critical for the server's review, cataloging, and AI-agent-readability goals.

**Fields we need to add:**

```typescript
interface ComponentManifest {
  // --- EXISTING (agreed) ---
  id: string;
  name: string;
  description: string;
  tags: string[];
  version: string;
  inputs: { ... };
  outputs: { ... };
  events: { ... };
  actions: { ... };
  defaultSize: { cols: number; rows: number };
  minSize?: { cols: number; rows: number };

  // --- NEW: Package Structure ---
  files: {
    path: string;
    type: 'component' | 'hook' | 'types' | 'variants' | 'part' | 'util' | 'example' | 'context';
    role?: 'presenter' | 'logic' | 'types' | 'context';
  }[];

  // --- NEW: Component Anatomy (for compound components) ---
  anatomy?: {
    root: string;                    // Root component name
    parts: string[];                 // Named sub-components
  };

  // --- NEW: Dependencies ---
  dependencies?: {
    registry: string[];              // Other CSlate components this depends on
    npm: string[];                   // npm packages required
  };

  // --- NEW: AI Agent Guidance ---
  ai?: {
    modificationHints: string[];     // "To change X, modify file Y"
    extensionPoints: string[];       // Named customization surfaces
    complexity: 'simple' | 'moderate' | 'complex';
  };
}
```

**Why these additions matter:**

1. **`files`** — The manifest must describe what's in the package. Without this, the review agent and future AI agents have to guess the package structure.

2. **`anatomy`** — For compound components (like a Select with Trigger + Content + Item), documenting the parts in the manifest enables structural similarity search ("find all components with a Trigger + Content pattern").

3. **`dependencies`** — If a DataTable blueprint depends on Button and Input, the client AI needs to know BEFORE fetching the source. The server uses this for dependency resolution in search results.

4. **`ai`** — This is what makes CSlate's community library dramatically more useful than a code dump. `modificationHints` tells the client AI agent exactly where to make changes. `extensionPoints` lists what's designed to be customized. The server's review agent generates/enriches these during cataloging.

**Note:** The `ai` field is **generated/enriched by the server's review agent**, not required from the client. The client can submit a manifest without `ai`, and the server will add it during the cataloging stage. But if the client's AI agent can generate initial hints, that's even better.

---

## ADDITIONAL CONTEXT FOR CLIENT

### 1. WebSocket Should Not Be "Optional, Future"

The client contract marks WebSocket as optional. **We recommend making it a Day 1 feature** via Server-Sent Events (SSE), not full WebSocket.

**Why:** The review pipeline takes 1-3 minutes. Polling `GET /upload/:id/status` every 5 seconds is wasteful and gives a poor UX. SSE is simpler than WebSocket (unidirectional, works through proxies, auto-reconnect) and perfect for progress updates.

**Proposed:**
```
GET /api/components/upload/:id/stream
Accept: text/event-stream

// Server pushes:
event: stage
data: {"stage": "structural_validation", "status": "passed", "progress": 14}

event: stage
data: {"stage": "security_analysis", "status": "in_progress", "progress": 28}

event: stage
data: {"stage": "security_analysis", "status": "passed", "progress": 42}

event: stage
data: {"stage": "quality_review", "status": "in_progress", "progress": 57}

// ... through all 7 stages ...

event: complete
data: {"status": "approved", "componentId": "uuid", "reviewResult": {...}}
```

The client keeps the polling endpoint as a fallback, but SSE is the primary path.

### 2. Server Tech Decisions (Answers to Client's Questions)

| Decision | Choice | Rationale |
|---|---|---|
| **Framework** | **Hono** | RPC type safety with Electron client (zero codegen typed API client). Zod as single source for validation + types |
| **ORM** | **Drizzle** | First-class pgvector support, best TypeScript inference, SQL-like control for vector queries |
| **Embedding model** | **TBD — leaning OpenAI text-embedding-3-small** (1536 dims) | Best balance of quality, cost, and ecosystem support. Will evaluate Cohere and local models |
| **Review agent LLM** | **Server-owned, likely Claude or GPT-4o** | Must be server-controlled (not user-configured). Needs strong code comprehension. Will evaluate cost/quality tradeoff |
| **File storage** | **Cloudflare R2** (S3-compatible) | No egress fees, purpose-built for files. Postgres stores metadata + embeddings only |
| **Auth** | **Simple API key** (see Disagree 2) | Simpler for desktop app, clean migration path to JWT/OAuth later |
| **Hosting** | **Neon** (Postgres) + **Node.js server** (Railway or Fly.io) | Neon: auto-scaling pgvector, free tier. Server: container-based deployment |
| **Search tuning** | **Cosine distance + HNSW index** | Best for normalized embeddings. Will add hybrid search (vector + full-text) in Phase 2 |
| **Job queue** | **pg-boss** | Postgres-backed, no Redis needed. Handles async review pipeline |
| **Validation** | **Zod** | Shared between client and server via `@cslate/shared` package |
| **Logging** | **Pino** | Structured JSON, request correlation, fastest Node.js logger |

### 3. Shared Types Package

Since both client and server are TypeScript, we should create a **shared types package** (`@cslate/shared` or a simple shared directory) containing:
- `ComponentManifest` Zod schema (source of truth for both sides)
- `ApiError` type
- `SearchRequest` / `SearchResponse` types
- All shared enums (status, category, complexity, trigger types)

This ensures the manifest validation is identical on both sides. With Hono's RPC mode, the client can also import the server's route types directly for end-to-end type safety — but the shared Zod schemas are the validation source of truth.

### 4. Upload Size Limits

Not specified in the contract. We propose:
- **Single file max:** 500KB (component source files should be small)
- **Total package max:** 2MB (including all files + context docs)
- **Manifest max:** 50KB
- **Context/decisions.md max:** 100KB

Components exceeding these limits are likely not well-structured and should be broken up.

### 5. Versioning Strategy

The contract doesn't address what happens when a user uploads an **improved version** of an existing community component. We propose:
- Each upload is a **new component** by default (gets a new server ID)
- If the manifest `name` matches an existing component by the same author, offer to create a **new version** instead
- The server tracks version history per component
- Search returns the latest approved version by default
- Previous versions remain accessible via `GET /api/components/:id/versions`

### 6. Review Pipeline Is 7 Stages, Not 4

The client contract describes 4 review steps. Our pipeline has 7 stages (see `docs/decisions/003-review-agent-pipeline.md`):

1. **Structural validation** — package format, manifest validity, TypeScript compilation
2. **Security analysis** — static analysis + LLM review for malicious code
3. **Code quality review** — UI/logic separation, type safety, clean code, accessibility
4. **Context verification** — does code match what decisions.md says?
5. **Manifest enrichment** — server AI improves description, tags, generates `ai.modificationHints`
6. **Embedding generation** — vector for semantic search
7. **Cataloging** — assign category, summary, make discoverable

The SSE stream reports progress through all 7 stages. The client should display these stages to the user.

### 7. Component Rating System

The `CommunityComponent` interface includes `rating` and `ratingCount`. We need a rating endpoint:
```
POST /api/components/:id/rate    { rating: 1-5 }
```
One rating per user per component. Users can update their rating. This should be in the contract.

---

## ACTION ITEMS FOR CLIENT

1. **Update upload payload** from `{ sourceCode: string }` to `{ manifest, files: Record<string, string> }` (multi-file package)
2. **Generate `context/decisions.md`** during the iterative refinement loop — capture the conversation context and key decisions
3. **Structure generated components** into the package format (ui/, logic/, types/ separation)
4. **Implement SSE listener** for `GET /api/components/upload/:id/stream` to show review progress
5. **Add `files`, `anatomy`, `dependencies` fields** to ComponentManifest
6. **Accept `ai` field** on manifests returned from server (modificationHints, extensionPoints)
7. **Consider shared Zod schemas** via a shared package or monorepo path
8. **Implement API key auth** instead of JWT (or tell us if JWT is a hard requirement)
9. **Add rating UI** — users should be able to rate community components they use

---

## PROPOSED SHARED MANIFEST (Reconciled)

Here is the reconciled `ComponentManifest` that both sides should agree on:

```typescript
interface ComponentManifest {
  // Identity
  id?: string;                         // Server-assigned UUID (absent on upload)
  name: string;                        // kebab-case identifier
  title: string;                       // Human-readable display name
  description: string;                 // Natural language description (10-500 chars)
  tags: string[];                      // 1-10 categorization tags
  version: string;                     // Semver

  // Component Interface (how components interact on the Slate)
  inputs: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
      description: string;
      required: boolean;
      default?: any;
      stateKey?: string;               // Bind to shared state store
    };
  };
  outputs: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
      description: string;
      stateKey?: string;
    };
  };
  events: {
    [eventName: string]: {
      description: string;
      payload: Record<string, { type: string; description: string }>;
    };
  };
  actions: {
    [actionName: string]: {
      description: string;
      params: Record<string, { type: string; description: string }>;
    };
  };

  // Layout
  defaultSize: { cols: number; rows: number };
  minSize?: { cols: number; rows: number };

  // Package Structure (NEW — required)
  files: {
    path: string;
    type: 'component' | 'hook' | 'types' | 'variants' | 'part' | 'util' | 'example' | 'context';
    role?: 'presenter' | 'logic' | 'types' | 'context';
  }[];

  // Component Anatomy (NEW — optional, for compound components)
  anatomy?: {
    root: string;
    parts: string[];
  };

  // Dependencies (NEW — optional)
  dependencies?: {
    registry: string[];                // Other CSlate community components
    npm: string[];                     // npm packages
  };

  // AI Agent Guidance (NEW — optional on upload, enriched by server)
  ai?: {
    modificationHints: string[];
    extensionPoints: string[];
    complexity: 'simple' | 'moderate' | 'complex';
  };
}
```

The `inputs/outputs/events/actions` system from the client contract is excellent — it defines how components interact on the Slate. The new fields (`files`, `anatomy`, `dependencies`, `ai`) define how the component is structured internally and how AI agents should work with it. Both are needed.
