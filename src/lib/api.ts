import type {
  AiStatus,
  ArtifactConfig,
  ArtifactContent,
  ArtifactType,
  ChatConfig,
  Citation,
  GroundedAnswer,
  SourceKind,
} from '../types'
import { publishableKey, requireSupabase, supabaseUrl } from './supabase'

export interface ImportedSource {
  title: string
  kind: SourceKind
  origin: string
  content: string
}

export interface DiscoveredSource {
  id: string
  title: string
  url: string
  summary: string
}

export interface DeepResearchResult {
  report: string
  results: DiscoveredSource[]
  model: string
  toolCount: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

/** supabase-js hides the failed Response on `error.context`; without it every failure reads as a 500. */
async function toApiError(error: unknown) {
  const context = (error as { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const payload = (await context.json()) as { error?: { message?: string; code?: string } }
      return new ApiError(
        payload.error?.message || 'The request failed.',
        payload.error?.code || 'FUNCTION_FAILED',
        context.status,
      )
    } catch {
      return new ApiError(`The request failed with HTTP ${context.status}.`, 'FUNCTION_FAILED', context.status)
    }
  }
  return new ApiError(
    error instanceof Error ? error.message : 'The Edge Function request failed.',
    'FUNCTION_FAILED',
    500,
  )
}

async function invoke<T>(
  functionName: 'notebook-ai' | 'source-import',
  body: FormData | Record<string, unknown>,
): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke(functionName, { body })
  if (error) throw await toApiError(error)
  return data as T
}

export function getAiStatus() {
  return invoke<AiStatus>('notebook-ai', { action: 'status' })
}

export interface AskAiInput {
  notebookId: string
  sourceIds: string[]
  shareToken?: string
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
  config: ChatConfig
  language: 'English' | 'Deutsch'
}

export function askAi(input: AskAiInput) {
  return invoke<GroundedAnswer>('notebook-ai', { action: 'chat', ...input })
}

export type AnswerEvent =
  | { type: 'context'; usedSourceIds: string[]; omittedSourceIds: string[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; citations: Citation[]; model: string }
  | { type: 'error'; error: { code: string; message: string } }

/** Raw fetch skips the client's auth handling, so the session is resolved and attached here. */
async function functionsFetch(functionName: string, body: unknown, signal?: AbortSignal) {
  const client = requireSupabase()
  const { data, error } = await client.auth.getSession()
  if (error || !data.session)
    throw new ApiError('The Supabase session expired. Reload and try again.', 'AUTH_REQUIRED', 401)
  return fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: publishableKey ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
}

/** `functions.invoke` buffers the whole body, so the SSE transport is read directly here. */
export async function* streamAskAi(input: AskAiInput, signal?: AbortSignal): AsyncGenerator<AnswerEvent> {
  let response: Response
  try {
    response = await functionsFetch('notebook-ai', { action: 'chat', stream: true, ...input }, signal)
  } catch (caught) {
    if (caught instanceof ApiError) throw caught
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught
    throw new ApiError('The AI service could not be reached.', 'FUNCTION_FAILED', 502)
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null
    throw new ApiError(
      payload?.error?.message || `The request failed with HTTP ${response.status}.`,
      payload?.error?.code || 'FUNCTION_FAILED',
      response.status,
    )
  }
  if (!response.body) throw new ApiError('The AI stream returned no content.', 'FUNCTION_FAILED', 502)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
        const line = frame.split('\n').find((entry) => entry.startsWith('data:'))
        const payload = line?.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let event: AnswerEvent
        try {
          event = JSON.parse(payload) as AnswerEvent
        } catch {
          continue
        }
        if (event.type === 'error') throw new ApiError(event.error.message, event.error.code, 502)
        yield event
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export function createArtifact(input: {
  notebookId: string
  sourceIds: string[]
  type: ArtifactType
  config: ArtifactConfig
}) {
  return invoke<{ content: ArtifactContent; model: string }>('notebook-ai', { action: 'artifact', ...input })
}

export async function uploadSource(file: File) {
  const form = new FormData()
  form.append('file', file)
  const response = await invoke<{ imported: ImportedSource }>('source-import', form)
  return response.imported
}

export async function importSourceUrl(url: string) {
  const response = await invoke<{ imported: ImportedSource }>('source-import', { action: 'url', url })
  return response.imported
}

export async function discoverSources(query: string, language: 'English' | 'Deutsch') {
  const response = await invoke<{ results: Omit<DiscoveredSource, 'id'>[] }>('notebook-ai', {
    action: 'discover',
    query,
    language,
  })
  return response.results.map((result, index) => ({ ...result, id: `discovery-${index}-${result.url}` }))
}

export async function runDeepResearch(query: string, language: 'English' | 'Deutsch') {
  const response = await invoke<Omit<DeepResearchResult, 'results'> & { results: Omit<DiscoveredSource, 'id'>[] }>(
    'notebook-ai',
    { action: 'research', query, language },
  )
  return {
    ...response,
    results: response.results.map((result, index) => ({ ...result, id: `research-${index}-${result.url}` })),
  }
}

export function createSpeech(text: string, voice = 'hannah') {
  return invoke<Blob>('notebook-ai', { action: 'speech', text, voice })
}
