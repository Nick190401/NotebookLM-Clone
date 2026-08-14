import type { AiStatus, ArtifactConfig, ArtifactContent, ArtifactType, ChatConfig, GroundedAnswer, SourceKind } from '../types'
import { requireSupabase } from './supabase'

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

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message)
  }
}

async function toApiError(error: unknown) {
  const context = (error as { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const payload = await context.json() as { error?: { message?: string; code?: string } }
      return new ApiError(payload.error?.message || 'The request failed.', payload.error?.code || 'FUNCTION_FAILED', context.status)
    } catch {
      return new ApiError(`The request failed with HTTP ${context.status}.`, 'FUNCTION_FAILED', context.status)
    }
  }
  return new ApiError(error instanceof Error ? error.message : 'The Edge Function request failed.', 'FUNCTION_FAILED', 500)
}

async function invoke<T>(functionName: 'notebook-ai' | 'source-import', body: FormData | Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke(functionName, { body })
  if (error) throw await toApiError(error)
  return data as T
}

export function getAiStatus() {
  return invoke<AiStatus>('notebook-ai', { action: 'status' })
}

export function askAi(input: {
  notebookId: string
  sourceIds: string[]
  shareToken?: string
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
  config: ChatConfig
  language: 'English' | 'Deutsch'
}) {
  return invoke<GroundedAnswer>('notebook-ai', { action: 'chat', ...input })
}

export function createArtifact(input: { notebookId: string; sourceIds: string[]; type: ArtifactType; config: ArtifactConfig }) {
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
  const response = await invoke<{ results: Omit<DiscoveredSource, 'id'>[] }>('notebook-ai', { action: 'discover', query, language })
  return response.results.map((result, index) => ({ ...result, id: `discovery-${index}-${result.url}` }))
}

export function createSpeech(text: string, voice = 'hannah') {
  return invoke<Blob>('notebook-ai', { action: 'speech', text, voice })
}
