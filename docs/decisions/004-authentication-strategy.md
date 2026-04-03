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
- Transmitted via `Authorization: ApiKey <key>` header (NOT Bearer — matches client contract v2.0)

### Registration Flow (Electron-aware)

The Electron app has no system browser, so traditional email link flows need care:

1. User opens CSlate desktop app for the first time (or goes to Settings → Account)
2. User enters email address
3. Client calls `POST /api/auth/register` → server creates unverified user + sends verification email
4. Verification email contains a deep link: `cslate://verify?token=<token>`
5. User clicks link → macOS/Windows launches CSlate (registered as `cslate://` URI handler) → app calls `POST /api/auth/verify { token }` → server marks email verified + generates API key + returns raw key
6. Client stores API key in Electron's `safeStorage` (OS keychain-backed)
7. All subsequent API calls include `Authorization: ApiKey cslate_xxxxx`

**If user is already inside the app when they click the link** (most common case): the deep link triggers a `cslate://verify` IPC event → app handles inline. No external browser needed.

**Token expiry:** Verification tokens expire after 24 hours. User can request a new email if expired.

### Account Recovery

If a user loses their API key (reinstalls app, new machine):
1. User goes to Settings → Forgot Key
2. Client calls `POST /api/auth/recover { email }` → server sends recovery email with a one-time token
3. User clicks deep link `cslate://recover?token=<token>` → app calls `POST /api/auth/recover/confirm { token }` → server generates new API key → old key invalidated → returns new raw key
4. Client stores new key in safeStorage

Recovery tokens expire after 1 hour (higher security than verification tokens).

### What's Stored Per User
- Hashed API key
- Email (verified)
- Created timestamp
- Component uploads (count, IDs)
- Approval rate (approved / total uploads)
- Rate limit tier (default, elevated for high-quality contributors)

### Rate Limiting (MVP — simple flat limits)
- Default: 10 uploads/hour, 100 searches/hour, 60 checkpoint uploads/hour
- Tiered rate limits (higher tiers for trusted contributors) deferred to v2 — complexity not justified at MVP scale
- Abuse: key revoked manually via DB; email blocked in `blocked_emails` config

> **Deferred to v2:** Automated tier promotion based on approval rate. At MVP scale, flat limits are sufficient and simpler to reason about.

### Auth API Endpoints (v1)

```
POST /api/auth/register          { email } → 201 { message: 'verification email sent' }
POST /api/auth/verify            { token } → 200 { apiKey: string, user: User }
POST /api/auth/recover           { email } → 200 { message: 'recovery email sent' }
POST /api/auth/recover/confirm   { token } → 200 { apiKey: string }
POST /api/auth/regenerate        (auth required) → 200 { apiKey: string }
DELETE /api/auth/account         (auth required) → 204
```

Verification and recovery tokens are stored in a `verification_tokens` table:
```
id          UUID PRIMARY KEY
user_id     UUID REFERENCES users(id) ON DELETE CASCADE
token_hash  TEXT NOT NULL  -- SHA-256 hash
type        TEXT NOT NULL CHECK (type IN ('verify', 'recover'))
expires_at  TIMESTAMPTZ NOT NULL
used_at     TIMESTAMPTZ  -- null until consumed
```

### Migration Path to Full Auth (Phase 2)
- Email already verified → can become the login identifier
- API key stays valid as a "personal access token" alongside OAuth sessions
- User record already exists → just add profile fields, OAuth provider links
- No breaking changes to existing clients
