# Client-Side Decisions Summary (for Server Reference)

**Date:** 2026-03-28
**Source:** CSlate/docs/decisions/ (001-016)

## Decisions That Impact the Server

### Component Communication (Decision 005)
- **Zustand Store** — shared reactive state per tab. Components declare `inputs` (read) and `outputs` (write) in manifest with `stateKey` bindings.
- **Typed Event Bus** — pub/sub for fire-and-forget notifications. Components declare `events` (emit) and `actions` (respond to) in manifest.
- **Server impact:** Index inputs/outputs/events/actions for searchability. A search for "component that shows user details" should match components with user-related inputs.

### Component Sandboxing (Decision 006)
- Single iframe with `sandbox="allow-scripts"` + SES Compartments (SES deferred to v2)
- Components have NO direct network access, NO Node.js, NO filesystem
- All external communication via `bridge.fetch()` / `bridge.subscribe()` through host proxy
- **Server impact:** Review pipeline must verify components only use bridge APIs, not direct fetch/XHR/WebSocket.

### AI Agent Architecture (Decision 007)
- Orchestrator + specialized sub-agents (modeled after Claude Code)
- Skills: `component-builder`, `component-search`, `manifest-generator`, `layout-arranger`, `feedback-iterator`, `state-wirer`
- Agent uses `component-search` skill to query server DB
- `upload-component` workflow handles async upload + review monitoring
- **Server impact:** The primary "client" of our API is an AI agent, not a human clicking buttons. API responses must be AI-parseable and information-rich.

### Component Styling (Decision 008)
- Tailwind CSS + CSlate design tokens (CSS custom properties)
- Semantic token classes: `bg-primary`, `text-muted` — NOT hardcoded: `bg-blue-500`
- **Server impact:** Quality review must flag hardcoded Tailwind colors. Community components must use semantic tokens for cross-theme compatibility.

### Grid System (Decision 013)
- 8px base unit, snap-to-grid
- Components have `defaultSize` and `minSize` in manifest (in grid units)
- **Server impact:** Manifest validation must check defaultSize/minSize are reasonable positive integers.

### MVP Scope (Decision 014)
- v1 includes: search, upload (7-stage review), checkpoint backup, API key auth
- v1 defers: rating UI, version notifications, author profiles, SES lockdown, MCP servers
- **Server impact:** Build search, upload pipeline, checkpoints, and auth. Defer rating/versioning endpoints but design schema to support them.

### Community Sharing Default-On (Decision 015)
- Every accepted component auto-uploads for community review
- Users can opt out (per-component, per-project, or global)
- **Server impact:** Expect HIGH upload volume. Pipeline must handle burst gracefully. pg-boss queue is essential.

### Data Bridge & Permissions (Decision 016)
- Components declare `dataSources` (external APIs) and `userConfig` (parameterized values) in manifest
- Host acts as permission-gated proxy — validates requests against manifest
- Sensitive userConfig (API keys) stored in Electron safeStorage, never on server
- On community upload: userConfig VALUES stripped, schemas preserved
- **Server impact:**
  - Validate `dataSources.baseUrl` against URL allowlist (tiered: known-safe, unknown, blocked)
  - Verify components use `bridge.fetch()` not direct `fetch()`
  - Verify sensitive userConfig fields accessed via `bridge.getConfig()` only
  - Index `dataSources` descriptions in composite embedding for search
  - Never store actual userConfig values for community components

## Updated Manifest Fields (from client)

The manifest now includes these additional fields (beyond what we initially agreed):

```typescript
// Data Bridge fields
dataSources: { [sourceId]: { description, type, baseUrl, endpoints, rateLimit } }
userConfig: { [key]: { type, description, required, default?, sensitive?, example? } }

// Package structure (simplified from our initial proposal)
files: { path, type: 'ui'|'logic'|'types'|'context'|'style'|'test'|'other', role }[]
```

The client simplified the package structure slightly:
- `ui.tsx` instead of `ui/{name}.tsx`
- `logic.ts` instead of `logic/{name}.hook.ts`
- `types.ts` instead of `types/{name}.types.ts`
- `context.md` instead of `context/decisions.md`
- Flat file layout, no subdirectories

This is fine — simpler is better. The manifest's `files[]` array describes what's in the package regardless of directory structure.
