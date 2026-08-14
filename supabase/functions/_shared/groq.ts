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
    throw new ProviderError(message, response.status, retryAfterSeconds(message, response.headers.get('retry-after')))
  }
  return response
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

export function toGroqError(error: unknown) {
  if (error instanceof HttpError) return error
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) return new HttpError('The Groq API key is invalid or unauthorized.', 'AI_AUTH_FAILED', 503)
    if (error.status === 429) return new HttpError('The Groq rate limit has been reached. Please try again later.', 'AI_RATE_LIMITED', 429, error.retryAfter)
    return new HttpError('Groq could not process the request.', 'AI_PROVIDER_ERROR', 502)
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
        model: GROQ_MODELS.vision, temperature: 0.2, max_completion_tokens: 2_000,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Extract all readable text (OCR), then describe diagrams, charts, objects, and their relationships in detail. Return plain source text, no JSON.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${toBase64(bytes)}` } },
        ] }],
      }),
    })
    const body = await response.json() as { choices?: { message?: { content?: string } }[] }
    const content = body.choices?.[0]?.message?.content?.trim()
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

export async function synthesizeSpeech(text: string, voice: string) {
  try {
    const response = await groqFetch('/audio/speech', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: GROQ_MODELS.speech, voice, response_format: 'wav' }),
    })
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    throw toGroqError(error)
  }
}
