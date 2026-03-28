# Decision 004: Authentication Strategy

**Date:** 2026-03-28
**Status:** Accepted

## Context

CSlate-Server serves all CSlate desktop clients. We need to identify users for ownership tracking, abuse prevention, and contribution history.

## Options Considered

### A) Anonymous
No accounts. Anyone can upload and search.
**Rejected:** No ownership tracking, no abuse prevention, no personalization.

### B) Simple API Key (Selected for MVP)
Users generate an API key in the Electron app, linked to an email or GitHub account.

**What it provides:**
- Component ownership tracking (who uploaded what)
- Abuse prevention (rate limiting per key, revoke bad actors)
- Contribution history (per-user upload count, approval rate)
- Simple to implement — no OAuth flows, no session management
- Key generated on first launch or via settings

**What it doesn't provide (deferred to Phase 2):**
- User profiles / avatars
- Social features (favorites, collections, following)
- OAuth sign-in flows
- Fine-grained permissions

### C) Full Auth (Future — Phase 2)
Sign up / sign in with email, OAuth (GitHub/Google). User profiles, contribution history, favorites, personal collections.
**Deferred:** Adds significant complexity. Not needed for MVP.

## Decision

**Option B: Simple API Key for MVP, with a clear migration path to Option C.**

## Implementation Details

### API Key Format
- Generated server-side on registration
- Format: `cslate_` prefix + 32 random bytes (base64url) → e.g., `cslate_a1b2c3d4e5f6...`
- Stored hashed (SHA-256) in database — never store raw keys
- Transmitted via `Authorization: Bearer <key>` header

### Registration Flow
1. User opens CSlate desktop app for the first time (or goes to settings)
2. User provides an email address
3. Client sends email to server → server sends verification link
4. User clicks link → server generates API key → returns to client
5. Client stores API key securely (Electron's safeStorage API)
6. All subsequent API calls include the key

### What's Stored Per User
- Hashed API key
- Email (verified)
- Created timestamp
- Component uploads (count, IDs)
- Approval rate (approved / total uploads)
- Rate limit tier (default, elevated for high-quality contributors)

### Rate Limiting
- Default: 20 uploads/hour, 100 searches/hour
- Elevated (>80% approval rate, >10 approved components): 50 uploads/hour, 500 searches/hour
- Abuse: key revoked, email blocked

### Migration Path to Full Auth (Phase 2)
- Email already verified → can become the login identifier
- API key stays valid as a "personal access token" alongside OAuth sessions
- User record already exists → just add profile fields, OAuth provider links
- No breaking changes to existing clients
