import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createLogger } from '@cslate/logger'

const log = createLogger('llm')

let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

export function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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

export async function getEmbedding(text: string): Promise<number[]> {
  const start = Date.now()
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
  log.debug({ model, textChars: text.length }, 'embedding start')

  const client = getOpenAI()
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
