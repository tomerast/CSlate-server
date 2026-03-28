# Decision 002: Blueprint Storage Strategy

**Date:** 2026-03-28
**Status:** Pending

## Context

When a user requests a component, the AI searches for similar "blueprints" (reviewed, cataloged components) to use as starting points. Where should these blueprints be stored?

## Options Evaluated

### A) Server-Only
All blueprints in pgvector on the server. Client always fetches via API.

| Dimension | Rating |
|---|---|
| Latency | Poor — every generation needs a network round-trip (200ms-5s) |
| Offline support | None |
| Community benefit | Excellent — always up-to-date |
| Storage efficiency | Optimal — no duplication |
| Freshness | Perfect |

**Rejected:** No offline support is unacceptable for a desktop app.

### B) Client-Only
Blueprints stored locally. Server only for upload/distribution.

| Dimension | Rating |
|---|---|
| Latency | Excellent — all local |
| Offline support | Full |
| Community benefit | Poor — requires sync mechanism, inherent staleness |
| Storage efficiency | Bad — every client stores entire catalog |
| Freshness | Poor |

**Rejected:** Sync problem, storage bloat, and staleness make this impractical.

### C) Hybrid (Selected)
Server is source of truth + search engine. Client maintains local cache + user's own components.

| Dimension | Rating |
|---|---|
| Latency | Good — cache hits instant, misses need server |
| Offline support | Partial — cached + own components available |
| Community benefit | Excellent — server has full catalog |
| Storage efficiency | Good — client stores only what it uses |
| Freshness | Good — cache validated by version hash |

## Decision: Hybrid Strategy

### Two Local Stores on Client

**1. User's Own Components (Local Drafts Store)**
- Stored locally the moment user finalizes a component, BEFORE upload
- Persists across sessions (SQLite or local file storage)
- Always available offline
- Tracks upload status: `draft` → `uploading` → `reviewed` → `approved` / `rejected`
- User should never lose work due to network issues

**2. Community Blueprint Cache (LRU Cache)**
- Populated on-demand from server search results
- Keyed by blueprint ID + version hash
- Bounded by size (~200MB) with LRU eviction
- Cache validation: server response includes version metadata
- Offline: searchable via simple metadata/tag matching (not semantic)

### Search Flow (Online)

1. User describes a component
2. Client sends semantic search query to server
3. Server returns ranked results (ID, version, summary, similarity score)
4. Client checks local cache for each result
5. Cache hit + matching version → use local copy (zero latency)
6. Cache miss or stale → fetch from server, cache it
7. AI uses best-matching blueprint as starting point

### Search Flow (Offline)

1. User describes a component
2. Client searches local stores (own components first, then cached blueprints) via keyword/tag matching
3. If reasonable match found → use it. Otherwise → generate from scratch
4. Optionally queue semantic search for when connectivity returns

### Key Design Decisions

- **No local embeddings for community cache** — too large, too complex. Simple metadata search suffices for offline fallback
- **Optional local embeddings for user's own components** — small count (tens to hundreds), enables personal library semantic search offline
- **Optional warm-cache on startup** — fetch top 50-100 popular blueprints to pre-populate cache for new users
- **Blueprint size is manageable** — single blueprint ~5-50KB, 1000 cached ≈ 5-50MB

## Server Responsibilities

- Store all reviewed blueprints as source of truth
- pgvector semantic search API
- Version tracking for cache validation
- Popularity/trending tracking for warm-cache suggestions
- Handle component upload, review, embedding, cataloging pipeline
