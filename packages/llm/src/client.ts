import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createLogger } from '@cslate/logger'

const log = createLogger('llm')

let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null
let _embedding: OpenAI | null = null

// ─── Gateway Resolution ───────────────────────────────────────────────────────
//
// Priority order for base URL resolution:
//   1. AI_GATEWAY_URL  — Vercel AI Gateway (appends /anthropic or /openai per provider)
//   2. ANTHROPIC_BASE_URL / OPENAI_BASE_URL — explicit per-provider override
//      (use for Vertex AI proxy, OpenRouter, or any OpenAI-compatible endpoint)
//   3. Direct provider API (default)

function resolveAnthropicBaseUrl(): string | undefined {
  const gateway = process.env.AI_GATEWAY_URL
  if (gateway) return `${gateway.replace(/\/$/, '')}/anthropic`
  return process.env.ANTHROPIC_BASE_URL || undefined
}

function resolveOpenAIBaseUrl(): string | undefined {
  const gateway = process.env.AI_GATEWAY_URL
  if (gateway) return `${gateway.replace(/\/$/, '')}/openai`
  return process.env.OPENAI_BASE_URL || undefined
}

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const baseURL = resolveAnthropicBaseUrl()
    const via = process.env.AI_GATEWAY_URL ? 'vercel-gateway' : baseURL ? 'custom-base-url' : 'direct'
    log.debug({ via, baseURL }, 'anthropic client init')
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(baseURL ? { baseURL } : {}),
    })
  }
  return _anthropic
}

export function getOpenAI(): OpenAI {
  if (!_openai) {
    const baseURL = resolveOpenAIBaseUrl()
    const via = process.env.AI_GATEWAY_URL ? 'vercel-gateway' : baseURL ? 'custom-base-url' : 'direct'
    log.debug({ via, baseURL }, 'openai client init')
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(baseURL ? { baseURL } : {}),
    })
  }
  return _openai
}

export async function callAnthropic(options: {
  model: string
  system: string
  prompt: string
  maxTokens?: number
}): Promise<string> {
  const start = Date.now()
  log.debug({ model: options.model, promptChars: options.prompt.length, maxTokens: options.maxTokens ?? 4096 }, 'llm call start')

  const client = getAnthropic()
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
    })
  } catch (err) {
    log.warn({ model: options.model, promptChars: options.prompt.length, err }, 'llm call failed')
    throw err
  }

  const durationMs = Date.now() - start
  const inputTokens = message.usage.input_tokens
  const outputTokens = message.usage.output_tokens
  log.debug({ model: options.model, inputTokens, outputTokens, durationMs }, 'llm call done')

  const block = message.content[0]
  if (!block || block.type !== 'text') throw new Error('Unexpected LLM response type')
  return block.text
}

// ─── Embedding Client ─────────────────────────────────────────────────────────
//
// Separate from the main OpenAI client so embeddings can use a different
// provider (e.g. DashScope for Qwen3) without affecting completion calls.
//
// EMBEDDING_BASE_URL  — provider base URL (default: OpenAI)
//   DashScope (Qwen):  https://dashscope.aliyuncs.com/compatible-mode/v1
//   OpenRouter:        https://openrouter.ai/api/v1
// EMBEDDING_API_KEY   — provider API key (falls back to OPENAI_API_KEY)
// EMBEDDING_MODEL     — model name (default: text-embedding-3-small)
//   Qwen3:             qwen3-embedding-4b  (via DashScope)
//                      alibaba/qwen3-embedding-4b  (via OpenRouter)

function getEmbeddingClient(): OpenAI {
  if (!_embedding) {
    const baseURL = process.env.EMBEDDING_BASE_URL || undefined
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY
    const via = baseURL ? baseURL.replace(/https?:\/\//, '').split('/')[0] : 'openai'
    log.debug({ via, baseURL }, 'embedding client init')
    _embedding = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }
  return _embedding
}

export async function getEmbedding(text: string): Promise<number[]> {
  const start = Date.now()
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
  log.debug({ model, textChars: text.length }, 'embedding start')

  const client = getEmbeddingClient()
  let res: Awaited<ReturnType<typeof client.embeddings.create>>
  try {
    res = await client.embeddings.create({ model, input: text })
  } catch (err) {
    log.warn({ model, textChars: text.length, err }, 'embedding failed')
    throw err
  }

  const embedding = res.data[0]?.embedding
  if (!embedding) throw new Error('No embedding returned')
  log.debug({ model, dims: embedding.length, durationMs: Date.now() - start }, 'embedding done')
  return embedding
}
