import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

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
  const client = getAnthropic()
  const message = await client.messages.create({
    model: options.model,
    max_tokens: options.maxTokens ?? 4096,
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
  })
  const block = message.content[0]
  if (!block || block.type !== 'text') throw new Error('Unexpected LLM response type')
  return block.text
}

export async function getEmbedding(text: string): Promise<number[]> {
  const client = getOpenAI()
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
  const res = await client.embeddings.create({ model, input: text })
  const embedding = res.data[0]?.embedding
  if (!embedding) throw new Error('No embedding returned')
  return embedding
}
