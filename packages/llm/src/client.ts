import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createLogger } from '@cslate/logger'

const log = createLogger('llm')

let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null
let _embedding: OpenAI | null = null

// ─── Config ───────────────────────────────────────────────────────────────────
//
// Gateway mode  (AI_GATEWAY_URL is set)
//   A single AI_GATEWAY_KEY authenticates all providers.
//   Anthropic calls → ${gateway}/anthropic   (native claude-* model names)
//   OpenAI calls    → ${gateway}/openai      (native gpt-* / text-embedding-* names)
//   Embedding calls → ${gateway}/openai      (supports provider/model e.g. alibaba/qwen3-*)
//
// Direct mode  (no gateway)
//   ANTHROPIC_API_KEY  — Anthropic direct
//   OPENAI_API_KEY     — OpenAI direct
//   EMBEDDING_BASE_URL + EMBEDDING_API_KEY — custom embedding provider (e.g. DashScope)
//   Falls back to OPENAI_API_KEY for embeddings if EMBEDDING_API_KEY is unset.

function gatewayUrl(): string | undefined {
  return process.env.AI_GATEWAY_URL?.replace(/\/$/, '')
}

function isGatewayMode(): boolean {
  return !!gatewayUrl()
}

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const gw = gatewayUrl()
    const apiKey = gw ? process.env.AI_GATEWAY_KEY : process.env.ANTHROPIC_API_KEY
    const baseURL = gw ? `${gw}/anthropic` : undefined
    log.debug({ via: gw ? 'gateway' : 'direct', baseURL }, 'anthropic client init')
    _anthropic = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }
  return _anthropic
}

export function getOpenAI(): OpenAI {
  if (!_openai) {
    const gw = gatewayUrl()
    const apiKey = gw ? process.env.AI_GATEWAY_KEY : process.env.OPENAI_API_KEY
    const baseURL = gw ? `${gw}/openai` : undefined
    log.debug({ via: gw ? 'gateway' : 'direct', baseURL }, 'openai client init')
    _openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }
  return _openai
}

function getEmbeddingClient(): OpenAI {
  if (!_embedding) {
    const gw = gatewayUrl()
    // Gateway mode: route through gateway's OpenAI-compatible endpoint
    // Direct mode: use EMBEDDING_BASE_URL if set (e.g. DashScope), else OpenAI
    const baseURL = gw ? `${gw}/openai` : (process.env.EMBEDDING_BASE_URL || undefined)
    const apiKey = gw
      ? process.env.AI_GATEWAY_KEY
      : (process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY)
    const via = gw ? 'gateway' : baseURL ? 'custom' : 'openai'
    log.debug({ via, baseURL }, 'embedding client init')
    _embedding = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }
  return _embedding
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
