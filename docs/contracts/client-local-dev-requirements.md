# Client Local Dev Requirements

**Date:** 2026-03-28
**From:** CSlate-Server
**Purpose:** What the CSlate client (Electron app) needs to connect to the local server environment

---

## Overview

The server runs fully locally via `pnpm dev` (Docker + Node.js processes). The client needs to point at `localhost:3000` and skip the normal registration flow during development.

---

## Required: `.env.development` in CSlate client

```env
# Point at local server instead of production
VITE_SERVER_URL=http://localhost:3000

# Pre-seeded dev API key — works immediately, no registration needed
# Created by running `pnpm db:seed` in CSlate-server
VITE_DEV_API_KEY=cslate_dev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

When `VITE_DEV_API_KEY` is set and `NODE_ENV=development`, the Electron app should:
1. Use this key as the stored API key (bypass registration/verification)
2. Never prompt for account setup in dev mode

---

## Server Dev-Mode Behaviors

The server has `DEV_SKIP_EMAIL_VERIFY=true` in local dev:

- `POST /api/v1/auth/register` → **immediately returns** `{ apiKey: string }` (no email sent, no verification step)
- The pre-seeded key (`cslate_dev_aaa...`) works for all authenticated endpoints
- Rate limits are **disabled** in dev mode (`NODE_ENV=development`)

---

## Component Playground (Client builds this)

The server team recommends the client builds a standalone component playground at `localhost:5174`:

```
apps/playground/
├── main.tsx             — loads component by URL param (?component=name)
├── MockBridge.ts        — implements bridge.fetch() (real external API calls)
├── MockStore.tsx        — Zustand store with inspector panel
└── MockEventBus.tsx     — event bus with log panel
```

**What it provides:**
- **No sandbox** — components render directly in browser, full Chrome DevTools
- **Hot reload** — edit `ui.tsx`, see changes instantly
- **Real bridge calls** — `bridge.fetch()` hits actual third-party APIs
- **Mock config** — `bridge.getConfig()` returns values from `playground-config.json`

**NOT for integration testing** — use the real sandboxed Electron iframe for that.

**URL format:**
```
http://localhost:5174/?component=stock-ticker
http://localhost:5174/?component=weather-widget&config={"city":"Tel Aviv"}
```

---

## Local Dev Port Map

| Service | Port | Purpose |
|---|---|---|
| CSlate API | 3000 | All `/api/v1/*` endpoints |
| PostgreSQL | 5432 | DB (cslate / cslate / cslate_dev) |
| MinIO S3 | 9000 | File storage (R2 replacement) |
| MinIO UI | 9001 | Browse stored component files |
| MailHog SMTP | 1025 | Receives verification emails |
| MailHog UI | 8025 | View sent emails |
| Playground | 5174 | Component playground (client-side) |
| Electron dev | 5173 | Vite HMR for host renderer |

---

## IPC Inspector (Client builds this)

In dev mode (`NODE_ENV=development`), log all IPC messages to the main process console:

```typescript
// In your IPC handler setup
if (process.env.NODE_ENV === 'development') {
  ipcMain.on('*', (event, channel, ...args) => {
    console.log(`[IPC →] ${channel}`, JSON.stringify(args, null, 2))
  })
}
```

Format:
```
[IPC →] bridge:fetch  { componentId: "comp_abc", sourceId: "yahoo-finance" }
[IPC ←] bridge:fetch:response  { data: { AAPL: 189.43 } }
```

---

## Electron Dev Mode: Main Process Debugging

The server team wants to be able to attach to the Electron main process:

```json
// package.json dev script
{
  "dev": "electron --inspect=9229 ."
}
```

Then in Chrome: `chrome://inspect` → "Open dedicated DevTools for Node"
Or VS Code: attach to `localhost:9229`.

---

## Full Stack Dev Startup Sequence

```bash
# Terminal 1 — Server (infrastructure + API + worker)
cd CSlate-server
pnpm dev           # starts Docker + API + worker, seeds DB

# Terminal 2 — Client (Electron)
cd CSlate
pnpm dev           # starts Vite + Electron with HMR
```

Both repos must be running simultaneously for end-to-end local testing.
