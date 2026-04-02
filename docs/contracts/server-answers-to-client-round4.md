# Server Answers to Client Round 4 (Decision 017 Changes)

**Date:** 2026-03-28
**From:** CSlate-Server
**Re:** 8 items from client critical review (Decision 017)

---

## 1. API Versioning `/v1/` — ACCEPTED ✓

All routes prefixed with `/api/v1/`. Every response includes `API-Version: 1` header.

Updated in spec Section 6. When v2 launches, both run in parallel during deprecation window.

**New routes:**
- `POST /api/v1/auth/verify` (was missing — email verification step)
- `POST /api/v1/auth/recover` + `POST /api/v1/auth/recover/confirm` (account recovery)

---

## 2. Component Revocation — ACCEPTED ✓

**New endpoint:** `POST /api/v1/components/:id/revoke`
- Auth: required (must be the component author OR admin)
- Input: `{ reason: 'security'|'abuse'|'legal'|'author-request', message?: string }`
- Sets `revoked = true`, `revoke_reason`, `revoked_at` on the component record
- Revoked components: removed from all search results immediately

**Updated endpoint:** `POST /api/v1/components/check-updates`
```typescript
interface CheckUpdatesResponse {
  updates: { id: string; currentVersion: string; latestVersion: string; changelog?: string }[];
  revocations: {
    id: string;
    reason: 'security' | 'abuse' | 'legal' | 'author-request';
    message?: string;
  }[];
}
```

**Client behavior as requested:** Show notification, do NOT auto-delete. User decides.

**Schema addition:** `revoked`, `revoke_reason`, `revoked_at` columns on `components` table.

**Search queries updated:** `WHERE flagged = false AND revoked = false`

---

## 3. context.md = AI Summary (not raw chat) — ACCEPTED ✓

**Server impact:**
- Stage 1 (`manifest_validation`): Validate `context.md` length ≤ 2,000 characters
- Embedding composition: `context.md` is treated as a concise intent summary — ideal embedding input
- No structural parsing of context.md (we never assumed chat turn format, but confirming: it's treated as a plain text summary)

**Embedding benefit:** Concise AI summaries produce better semantic vectors than raw chat history. This is a quality improvement for search.

---

## 4. Tailwind Token Enforcement: Hard Reject — ACCEPTED ✓

Added as a **static pre-check** in Stage 4 (`quality_review`) — before any LLM call:

```typescript
// Regex scan on all .tsx/.ts files
const RAW_COLOR_REGEX = /\b(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
```

If matched → immediate rejection with code `STYLING_TOKEN_VIOLATION`.

**Why static (not LLM):** Regex is deterministic and ~0ms. We detect the exact violation with file/line precision. LLM is unnecessary here and would slow the feedback loop for a fixable rule.

---

## 5. dataSources Cap (Max 5) — ACCEPTED ✓

Added to Stage 1 (`manifest_validation`):
```
if Object.keys(manifest.dataSources ?? {}).length > 5:
  reject with { code: 'TOO_MANY_DATA_SOURCES', message: 'Component declares N data sources. Maximum is 5.' }
```

---

## 6. defaultSize/minSize: `cols/rows` → `width/height` — ACCEPTED ✓

This is a breaking schema change. The `@cslate/shared` Zod schema must be updated:

```typescript
// NEW (update @cslate/shared)
defaultSize: z.object({ width: z.number().positive(), height: z.number().positive() })
minSize: z.object({ width: z.number().positive(), height: z.number().positive() }).optional()

// OLD — remove
// defaultSize: z.object({ cols: z.number(), rows: z.number() })
```

Stage 1 (`manifest_validation`) will reject the old format because it won't match the Zod schema.

**Please confirm:** Is there a migration period where old `cols/rows` components still work, or is this a hard cut? Our assumption is hard cut — since no components are in production yet, there's nothing to migrate.

---

## 7. Community Sharing: Default Changed to Opt-In — NOTED ✓

No server changes required. The pipeline is unchanged. Opt-in means fewer uploads — which is a positive signal for pipeline load. Noted in spec Section 1.

---

## 8. dataSources/userConfig: Now Optional — ACCEPTED ✓

The `@cslate/shared` Zod schema update:

```typescript
dataSources: z.record(DataSourceSchema).optional(),
userConfig: z.record(UserConfigFieldSchema).optional(),
```

Stage 1 validation already handles this correctly if the schema marks them optional. No other server-side changes — the pipeline's security and quality checks already guard the `dataSources` object conditionally.

---

## Additional Server-Side Updates (From Our Own Review)

Beyond the 8 items above, we also updated:

- **SSE LISTEN/NOTIFY**: Replaced 2s polling loop with Postgres LISTEN/NOTIFY (event-driven, zero idle queries)
- **download_events partitioning**: Monthly range partitions from day 1
- **LLM vendor**: Anthropic-only for all review calls. OpenAI only for embeddings (no Anthropic embedding API yet)
- **API auth header**: `Authorization: ApiKey` (confirmed aligned with client v2.0 contract)
- **Account recovery flow**: Deep-link based (`cslate://recover?token=...`) for Electron
- **teamConcurrency**: Documented as calibrated to Claude claude-sonnet-4-6 rate limits (60 RPM)
- **@cslate/shared**: Confirmed as external npm dependency, not a local package

---

## Open Question

**Item 6:** Hard cut on `cols/rows` → `width/height`? Confirm there are no existing components in the DB to migrate.

