# Decision 007: LLM Gateway Strategy

**Date:** 2026-03-29
**Status:** Accepted

## Context

The review pipeline (Decision 003) makes LLM calls in three stages: security scan, quality review, and cataloging. The current approach (Decision 005) calls the Anthropic and OpenAI SDKs directly using server-managed API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

The desktop client (CSlate Electron app) runs an AI agent loop (Plan 05) that also makes LLM calls — using the user's own API key stored in OS keychain.

Two problems:
1. **No unified observability.** Desktop LLM calls and server pipeline calls are completely separate — no shared cost tracking, caching, or rate limiting dashboard.
2. **No consistency.** If a provider goes down or a model is deprecated, both callsites need independent fixes.

## Options Considered

### Option A: Keep direct SDK calls (status quo)

Desktop uses `@ai-sdk/anthropic` etc. with user's key. Server uses `anthropic` SDK with env-var keys. Each callsite manages its own retry, rate limits, and logging independently.

- **Pros:** Simple. No external dependency beyond the LLM providers themselves.
- **Cons:** No caching across users. No unified observability. Provider failover must be coded in both places independently.

### Option B: Self-hosted gateway (e.g., LiteLLM, custom proxy)

Deploy a proxy server that both desktop and server route through. The proxy holds all provider credentials and standardises the request format.

- **Pros:** Full control. Can be self-hosted.
- **Cons:** Significant infrastructure to maintain. Another service to deploy, monitor, and scale. CSlate is a small team — operational overhead is not worth it.

### Option C: Vercel AI Gateway (recommended)

Vercel provides a hosted AI gateway at `ai-gateway.vercel.sh`. The Vercel AI SDK has first-class integration via `@ai-sdk/gateway`. Key properties:

- **No deployment.** Vercel hosts and operates the gateway.
- **BYOK per-request.** The user's (or server's) provider API key is passed as `providerOptions.gateway.byok` on each call. CSlate holds one gateway API key for authentication; the actual LLM costs are billed to the key owner.
- **Unified model strings.** `'anthropic/claude-sonnet-4.6'`, `'openai/gpt-4o'` — provider is encoded in the model identifier, not a separate SDK instance.
- **Observability.** All calls visible in the Vercel dashboard: latency, cost, cache hit rate, errors, per-model usage.
- **Caching.** Identical prompts (e.g., cataloging the same component twice) are served from cache.
- **Provider fallback.** Gateway retries with system credentials if a BYOK key fails.

## Decision: Vercel AI Gateway (Option C)

### Two keys per request

| Key | Held by | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` | CSlate (server env var) | Authenticates to `ai-gateway.vercel.sh` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | CSlate (server env var) | Passed as `byok` — actual LLM usage billed here |

For the desktop client, `gatewayApiKey` is a sensitive config value (OS keychain), and the user's own `llmApiKey` is the `byok` key. CSlate pays nothing for desktop LLM usage.

### `packages/llm/` implementation

The unified gateway factory lives in `packages/llm/src/gateway.ts`:

```typescript
import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModelV1 } from 'ai'

export function createServerGatewayModel(modelId: string, providerKey: string): LanguageModelV1 {
  const [provider] = modelId.split('/')
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY!,
    baseURL: process.env.AI_GATEWAY_URL ?? 'https://ai-gateway.vercel.sh'
  })
  return gateway(modelId, {
    providerOptions: {
      gateway: {
        byok: { [provider]: [{ apiKey: providerKey }] }
      }
    }
  })
}
```

Usage in pipeline stages:

```typescript
// security_scan, quality_review
const model = createServerGatewayModel(
  process.env.LLM_QUALITY_MODEL ?? 'anthropic/claude-sonnet-4.6',
  process.env.ANTHROPIC_API_KEY!
)

// cataloging
const model = createServerGatewayModel(
  process.env.LLM_CATALOG_MODEL ?? 'anthropic/claude-haiku-4.5-20251001',
  process.env.ANTHROPIC_API_KEY!
)

// embedding (note: OpenAI key for this one)
const model = createServerGatewayModel(
  process.env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
  process.env.OPENAI_API_KEY!
)
```

### Model string format change

| Stage | Old | New |
|---|---|---|
| security_scan | `claude-sonnet-4-6` (Anthropic SDK) | `anthropic/claude-sonnet-4.6` |
| quality_review | `claude-sonnet-4-6` (Anthropic SDK) | `anthropic/claude-sonnet-4.6` |
| cataloging | `claude-haiku-4-5-20251001` (Anthropic SDK) | `anthropic/claude-haiku-4.5-20251001` |
| embedding | `text-embedding-3-small` (OpenAI SDK) | `openai/text-embedding-3-small` |

### New environment variables

```
AI_GATEWAY_API_KEY=...                           # Required: CSlate's Vercel gateway key
AI_GATEWAY_URL=https://ai-gateway.vercel.sh      # Optional: override for testing
```

Existing `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are retained — they become `byok` values, not SDK constructor args.

### Packages

| Package | Action |
|---|---|
| `@ai-sdk/gateway` | Add to `packages/llm/` |
| `ai` | Add to `packages/llm/` (LanguageModelV1 type) |
| `anthropic` (SDK) | Remove from pipeline stages |
| `openai` (SDK) | Remove from embedding stage |

### Local development

In `docker-compose.yml` and `.env.local.example`, `AI_GATEWAY_URL` can be pointed at a local mock or left unset to use the real gateway. Tests mock `createGateway` directly — no live gateway calls in unit tests.

## What This Does Not Change

- **Provider choices** (Decision 005): Anthropic for review/cataloging, OpenAI for embeddings — unchanged.
- **Deployment** (Decision 006): API + Worker separation unchanged.
- **Pipeline stages** (Decision 003): same 7 stages, same model tiers — only the call mechanism changes.
- **Database, storage, queue** (Decision 005): no changes.
