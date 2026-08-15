import { HttpError } from './http.ts'

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

export const GROQ_MODELS = {
  primary: Deno.env.get('GROQ_PRIMARY_MODEL') || 'openai/gpt-oss-120b',
  fallback: Deno.env.get('GROQ_FALLBACK_MODEL') || 'openai/gpt-oss-20b',
  fast: Deno.env.get('GROQ_FAST_MODEL') || 'llama-3.1-8b-instant',
  vision: Deno.env.get('GROQ_VISION_MODEL') || 'qwen/qwen3.6-27b',
  transcription: Deno.env.get('GROQ_TRANSCRIPTION_MODEL') || 'whisper-large-v3-turbo',
  speech: Deno.env.get('GROQ_SPEECH_MODEL') || 'canopylabs/orpheus-v1-english',
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: string) {
    super(message)
  }
}

function retryAfterSeconds(message: string, header: string | null) {
  if (header) return header
  const match = message.match(/try again in\s+([0-9.]+)(ms|s|m)/i)
  if (!match) return undefined
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) return undefined
  const seconds = match[2].toLowerCase() === 'ms' ? value / 1_000 : match[2].toLowerCase() === 'm' ? value * 60 : value
  return String(Math.max(1, Math.ceil(seconds)))
}

function apiKey() {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) throw new HttpError('Groq is not configured. Set the GROQ_API_KEY Supabase secret.', 'AI_NOT_CONFIGURED', 503)
  return key
}

export async function groqFetch(path: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(`${GROQ_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(55_000),
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('The AI service is currently unreachable.', 'AI_UNAVAILABLE', 502)
  }
  if (!response.ok) {
    let message = `Groq returned HTTP ${response.status}.`
    try {
      const body = await response.json() as { error?: { message?: string } }
      message = body.error?.message || message
    } catch {
      // HTTP status remains the reliable error signal.
    }
    console.error('Groq request failed', JSON.stringify({ path, status: response.status, message }))
    throw new ProviderError(message, response.status, retryAfterSeconds(message, response.headers.get('retry-after')))
  }
  return response
}

export function stripReasoning(value: string) {
  const withoutClosed = value.replace(/<think>[\s\S]*?<\/think>/gi, ' ')
  const openIndex = withoutClosed.search(/<think>/i)
  const cleaned = openIndex >= 0 ? withoutClosed.slice(0, openIndex) : withoutClosed
  return cleaned.replace(/<\/?think>/gi, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export async function verifyGroqConfiguration() {
  if (!Deno.env.get('GROQ_API_KEY')) return false
  try {
    await groqFetch('/models', { method: 'GET', signal: AbortSignal.timeout(10_000) })
    return true
  } catch {
    return false
  }
}

function rateLimited(error: ProviderError) {
  return error.status === 429
    || error.status === 498
    || (error.status === 413 && /per minute|TPM|RPM|rate limit/i.test(error.message))
}

export function toGroqError(error: unknown) {
  if (error instanceof HttpError) return error
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) return new HttpError('The Groq API key is invalid or unauthorized.', 'AI_AUTH_FAILED', 503)
    if (rateLimited(error)) return new HttpError('The Groq rate limit has been reached. Please try again in a moment.', 'AI_RATE_LIMITED', 429, error.retryAfter)
    if (error.status === 413) return new HttpError('The request is too large for the AI model. Select fewer sources.', 'AI_REQUEST_TOO_LARGE', 413)
    if (error.status === 503 || error.status === 502) return new HttpError('Groq is temporarily unavailable. Please try again.', 'AI_UNAVAILABLE', 503, error.retryAfter)
    return new HttpError(`Groq could not process the request: ${error.message}`, 'AI_PROVIDER_ERROR', 502)
  }
  return new HttpError('The AI service is currently unavailable.', 'AI_UNAVAILABLE', 502)
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function analyzeImage(bytes: Uint8Array, mimeType: string) {
  if (bytes.byteLength > 3_500_000) throw new HttpError('The image exceeds the 3.5 MB vision limit.', 'IMAGE_TOO_LARGE', 413)
  try {
    const response = await groqFetch('/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODELS.vision, temperature: 0.2, max_completion_tokens: 3_000,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Extract all readable text (OCR), then describe diagrams, charts, objects, and their relationships in detail. Return plain source text, no JSON, and no commentary about the task itself.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${toBase64(bytes)}` } },
        ] }],
      }),
    })
    const body = await response.json() as { choices?: { message?: { content?: string; reasoning?: string } }[] }
    const content = stripReasoning(body.choices?.[0]?.message?.content ?? '')
    if (!content) throw new HttpError('The image contains no recognizable content.', 'EMPTY_SOURCE', 422)
    return content
  } catch (error) {
    throw toGroqError(error)
  }
}

export async function transcribeAudio(bytes: Uint8Array, filename: string, mimeType: string) {
  try {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(bytes).buffer], filename, { type: mimeType }))
    form.set('model', GROQ_MODELS.transcription)
    form.set('response_format', 'json')
    const response = await groqFetch('/audio/transcriptions', { method: 'POST', body: form })
    const body = await response.json() as { text?: string }
    const text = body.text?.trim()
    if (!text) throw new HttpError('The audio contains no transcribable speech.', 'EMPTY_SOURCE', 422)
    return text
  } catch (error) {
    throw toGroqError(error)
  }
}

const SPEECH_CHUNK_LIMIT = 200

export function splitSpeechChunks(text: string, limit = SPEECH_CHUNK_LIMIT) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) ?? []
  const chunks: string[] = []
  let current = ''
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = '' }

  for (const sentence of sentences) {
    if (sentence.trim().length > limit) {
      push()
      let word_buffer = ''
      for (const word of sentence.trim().split(' ')) {
        if ((`${word_buffer} ${word}`).trim().length > limit) {
          if (word_buffer.trim()) chunks.push(word_buffer.trim())
          word_buffer = word.slice(0, limit)
        } else {
          word_buffer = `${word_buffer} ${word}`.trim()
        }
      }
      if (word_buffer.trim()) chunks.push(word_buffer.trim())
      continue
    }
    if ((current + sentence).trim().length > limit) push()
    current += sentence
  }
  push()
  return chunks
}

export function concatenateWav(parts: Uint8Array[]) {
  const usable = parts.filter((part) => part.byteLength > 44)
  if (usable.length === 0) return new Uint8Array(0)

  const header = usable[0].slice(0, 44)
  const payloads = usable.map((part) => part.subarray(44))
  const dataLength = payloads.reduce((total, payload) => total + payload.byteLength, 0)
  const output = new Uint8Array(44 + dataLength)
  output.set(header, 0)
  let offset = 44
  for (const payload of payloads) {
    output.set(payload, offset)
    offset += payload.byteLength
  }
  const view = new DataView(output.buffer)
  view.setUint32(4, 36 + dataLength, true)
  view.setUint32(40, dataLength, true)
  return output
}

export async function synthesizeSpeech(text: string, voice: string) {
  try {
    const chunks = splitSpeechChunks(text)
    if (!chunks.length) throw new HttpError('There is no narration to speak.', 'EMPTY_SOURCE', 422)
    const parts: Uint8Array[] = []
    for (const chunk of chunks) {
      const response = await groqFetch('/audio/speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: chunk, model: GROQ_MODELS.speech, voice, response_format: 'wav' }),
      })
      parts.push(new Uint8Array(await response.arrayBuffer()))
    }
    const audio = concatenateWav(parts)
    if (!audio.byteLength) throw new HttpError('The narration could not be turned into audio.', 'EMPTY_SOURCE', 422)
    return audio
  } catch (error) {
    throw toGroqError(error)
  }
}
