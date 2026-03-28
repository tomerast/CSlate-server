# Server Answers to Client Open Items (Round 3)

**Date:** 2026-03-28
**From:** CSlate-Server
**Re:** 4 open items from `docs/contracts/server-team-full-context.md` Section 14

---

## 1. Should the server maintain a dataSources URL allowlist?

**Answer: Tiered approach — soft allowlist + LLM review for unknowns.**

### Tier 1: Known-Safe Domains (Auto-approve)
A curated list of popular API domains that skip manual review for `dataSources.baseUrl`:
- `api.openweathermap.org`
- `query1.finance.yahoo.com`, `finnhub.io`
- `api.github.com`
- `jsonplaceholder.typicode.com`
- `api.coingecko.com`
- `newsapi.org`
- ...etc (maintained as a config file, updated over time)

Components using only Tier 1 domains get faster review (security scan is lighter).

### Tier 2: Unknown Domains (LLM review)
For `baseUrl` values not on the allowlist:
1. The security scan (Stage 2) flags it for deeper inspection
2. The LLM examines the URL pattern — is it a legitimate public API? A known service?
3. If the domain is obviously malicious (known phishing, IP addresses, localhost, internal networks) → **auto-reject**
4. If the domain appears legitimate but unknown → **approve with flag**. The component enters the DB but the domain is queued for human review to potentially add to Tier 1

### Tier 3: Blocked Patterns (Auto-reject)
- `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`
- Internal network ranges (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`)
- IP addresses (no domain name)
- Known malicious domains (maintained blocklist)
- `file://`, `ftp://`, non-HTTPS protocols

### Why not strict allowlist only?
CSlate's power is that users can connect components to ANY API. A strict allowlist would kill the "unlimited creation possibilities" vision. The tiered approach balances security (block known-bad) with openness (allow unknown-but-legitimate).

### Server implementation:
- `packages/pipeline/src/stages/security/url-validator.ts`
- Tier 1 and Tier 3 lists stored as config in the repo (version-controlled)
- Domain reputation can be enhanced over time with community data (if a domain is used by 50+ approved components, auto-add to Tier 1)

---

## 2. Should we add `POST /api/components/:id/report` in v1?

**Answer: Yes — minimal but essential.**

Even with automated review, edge cases will slip through. Users need a way to flag problematic content. Without it, bad components persist until someone manually notices.

### v1 Implementation (minimal):
```
POST /api/components/:id/report
{
  reason: 'malicious' | 'broken' | 'inappropriate' | 'copyright' | 'other',
  description?: string     // Optional free text
}
Response: 201 { reportId: string }
```

**Server behavior:**
- Store report in a `reports` table (component_id, reporter_id, reason, description, created_at, status)
- If a component receives **3+ unique reports** → auto-flag (remove from search results pending human review)
- Rate limit: 10 reports/hour per user (prevent abuse)
- Dedup: one report per user per component

**What we do NOT build in v1:**
- No admin dashboard (check reports via direct DB queries)
- No appeal flow
- No reporter feedback ("your report was reviewed")

This is a safety valve, not a moderation system. We add proper moderation tooling in v2.

---

## 3. How does component dependency resolution work?

**Answer: For v1, inline dependencies at retrieval time. No transitive resolution.**

### The problem:
Component A depends on CSlate components B and C (declared in `manifest.dependencies.cslateComponents`). When a client fetches A as a blueprint, it also needs B and C.

### v1 approach — Simple, no dependency tree:
```
GET /api/components/:id/source?includeDeps=true
```

Response:
```typescript
{
  component: {
    id: "A",
    manifest: { ... },
    files: { ... }
  },
  dependencies: [
    {
      id: "B",
      manifest: { ... },
      files: { ... }
    },
    {
      id: "C",
      manifest: { ... },
      files: { ... }
    }
  ]
}
```

**Rules for v1:**
- Only **direct dependencies** are resolved (one level deep). If B depends on D, D is NOT included automatically.
- If a dependency is not found (deleted, rejected), the response includes it in a `missingDependencies: string[]` array. The client AI generates a replacement or skips it.
- Dependencies must all be `approved` status. Draft/rejected dependencies are treated as missing.
- No version pinning for dependencies in v1. Always returns the latest approved version.

**Why no transitive resolution:**
- Transitive dependency trees add enormous complexity (circular deps, version conflicts, diamond problems)
- In practice, CSlate components are self-contained. Dependencies on other CSlate components will be rare in v1 — most components stand alone or use npm packages
- The client AI agent can handle missing dependencies by generating replacements

### v2 evolution:
- Full dependency tree resolution with cycle detection
- Version pinning (`"componentB": ">=1.2.0"`)
- Lock file concept for reproducible builds
- Dependency graph visualization in the client

---

## 4. Does the security scan check for `bridge.fetch()` vs direct `fetch()`?

**Answer: Yes — this is a critical security check in Stage 2.**

### What Stage 2 (Security Scan) checks for network access:

**Static analysis (no LLM needed):**
```
BLOCK patterns in all .ts/.tsx files:
- fetch(              → must NOT appear (only bridge.fetch allowed)
- XMLHttpRequest      → blocked
- new WebSocket(      → blocked (only bridge.subscribe allowed)
- navigator.sendBeacon → blocked
- new EventSource(    → blocked
- import("http       → blocked (dynamic imports of network modules)
- require("http      → blocked
- window.fetch       → blocked
- globalThis.fetch   → blocked
```

**LLM-assisted (for obfuscation detection):**
The LLM reviews the code for attempts to bypass the bridge:
- Variable aliasing: `const f = window['fet' + 'ch']; f(url)`
- Dynamic property access: `window[atob('ZmV0Y2g=')]`
- Eval-based construction: `eval('fe' + 'tch("...")')`
- Import expression tricks: `import(/* webpackIgnore: true */ 'module')`

**What IS allowed:**
- `bridge.fetch(sourceId, endpointId, params)` — the only legitimate network access
- `bridge.subscribe(sourceId, endpointId, params, callback)` — real-time data
- `bridge.getConfig(key)` — reading user config values

**Rejection message format:**
```json
{
  "stage": "security_scan",
  "result": "failed",
  "issues": [
    {
      "severity": "critical",
      "file": "logic.ts",
      "line": 42,
      "pattern": "fetch(",
      "message": "Direct fetch() call detected. Components must use bridge.fetch() for all network access. The host validates requests against the manifest's declared dataSources.",
      "fix": "Replace fetch('https://api.example.com/data') with bridge.fetch('source-id', 'endpoint-id', params)"
    }
  ]
}
```

The client can show this to the user and/or have the local AI agent auto-fix the issues before re-upload.

### Additional `dataSources` validation in Stage 4 (Quality Review):

The LLM also checks:
- Every `bridge.fetch(sourceId, ...)` call uses a `sourceId` that's declared in `manifest.dataSources`
- No undeclared data sources are accessed (component says it uses Yahoo Finance but also tries to access Google Maps)
- `userConfig` sensitive fields are only accessed via `bridge.getConfig()`, never hardcoded in source
- Refresh intervals declared in manifest are reasonable (not 100ms polling)

---

## Summary of New Contract Additions

| Addition | Endpoint / Feature |
|---|---|
| URL allowlist (tiered) | Config in server repo, checked in Stage 2 |
| Report abuse | `POST /api/components/:id/report` |
| Auto-flag on 3+ reports | Server-side logic, component removed from search |
| Dependency resolution | `GET /api/components/:id/source?includeDeps=true` |
| bridge.fetch enforcement | Stage 2 static analysis + LLM review |
| dataSources URL validation | Stage 2 (blocklist) + Stage 4 (LLM legitimacy check) |

All of these are v1 scope.
