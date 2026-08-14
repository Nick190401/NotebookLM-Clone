import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { AppData, AppSettings, Notebook, NotebookShareAccess, NotebookShareDetails, SharedNotebook } from '../types'
import { requireSupabase } from './supabase'

const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  outputLanguage: z.enum(['English', 'Deutsch']),
})

const citationSchema = z.object({ sourceId: z.string(), label: z.number(), excerpt: z.string() })
const sourceSchema = z.object({
  id: z.string(), title: z.string(), kind: z.enum(['pdf', 'web', 'youtube', 'text', 'audio', 'image']),
  origin: z.string(), content: z.string(), summary: z.string(), topics: z.array(z.string()), selected: z.boolean(), createdAt: z.number(),
})
const artifactContentSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string(), sourceIds: z.array(z.string()) })),
  cards: z.array(z.object({ front: z.string(), back: z.string(), sourceId: z.string() })),
  questions: z.array(z.object({ question: z.string(), options: z.array(z.string()), correctIndex: z.number(), explanation: z.string(), sourceId: z.string() })),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), parentId: z.string(), sourceId: z.string() })),
  slides: z.array(z.object({ title: z.string(), body: z.string(), metric: z.string(), sourceIds: z.array(z.string()) })),
  columns: z.array(z.string()),
  rows: z.array(z.object({ cells: z.array(z.string()), sourceIds: z.array(z.string()) })),
  metrics: z.array(z.object({ value: z.string(), label: z.string(), context: z.string(), sourceId: z.string() })),
  transcript: z.array(z.object({ speaker: z.string(), text: z.string(), sourceIds: z.array(z.string()) })),
  narration: z.string(),
})
const notebookSchema = z.object({
  id: z.string(), title: z.string(), emoji: z.string(),
  sources: z.array(sourceSchema),
  messages: z.array(z.object({ id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), citations: z.array(citationSchema), createdAt: z.number(), saved: z.boolean().optional() })),
  artifacts: z.array(z.object({
    id: z.string(), type: z.enum(['audio', 'video', 'mindmap', 'report', 'flashcards', 'quiz', 'infographic', 'slides', 'datatable']),
    title: z.string(), status: z.enum(['generating', 'ready', 'error']), createdAt: z.number(),
    config: z.object({ focus: z.string(), language: z.string(), format: z.string().optional(), difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(), amount: z.enum(['Fewer', 'Standard', 'More']).optional() }),
    content: artifactContentSchema.optional(), error: z.string().optional(), model: z.string().optional(),
  })),
  notes: z.array(z.object({ id: z.string(), title: z.string(), body: z.string(), createdAt: z.number(), locked: z.boolean().optional() })),
  chatConfig: z.object({ style: z.enum(['Default', 'Learning Guide', 'Custom']), length: z.enum(['Shorter', 'Default', 'Longer']), instructions: z.string() }),
  createdAt: z.number(), updatedAt: z.number(),
})
const appDataSchema = z.object({ notebooks: z.array(notebookSchema), settings: settingsSchema })
const shareDetailsSchema = z.object({
  access: z.enum(['private', 'full', 'chat']),
  token: z.string().uuid().nullable(),
})
const sharedNotebookSchema = z.object({
  access: z.enum(['full', 'chat']),
  notebook: notebookSchema,
})

export class RepositoryError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
  }
}

function databaseError(message: string, cause: unknown) {
  return new RepositoryError(message, cause)
}

export function createRepository(client: SupabaseClient) {
  const pending = new Map<string, Promise<void>>()
  const persistedSourceContent = new Map<string, Map<string, string>>()
  let settingsPending: Promise<void> = Promise.resolve()

  function rememberSources(notebook: Notebook) {
    persistedSourceContent.set(notebook.id, new Map(notebook.sources.map((source) => [source.id, source.content])))
  }

  function compactSnapshot(notebook: Notebook) {
    const previous = persistedSourceContent.get(notebook.id)
    return {
      ...notebook,
      sources: notebook.sources.map((source) => previous?.get(source.id) === source.content
        ? Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'content'))
        : source),
    }
  }

  async function ensureSession() {
    const { data: current, error: sessionError } = await client.auth.getSession()
    if (sessionError) throw databaseError('The Supabase session could not be restored.', sessionError)
    if (current.session?.user) return current.session.user
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data.user) throw databaseError('Anonymous Supabase sign-in failed. Confirm that anonymous sign-ins are enabled.', error)
    return data.user
  }

  async function loadWorkspace(): Promise<AppData> {
    const { data, error } = await client.rpc('load_workspace')
    if (error) throw databaseError('The workspace could not be loaded from Supabase.', error)
    const parsed = appDataSchema.safeParse(data)
    if (!parsed.success) throw databaseError('Supabase returned an invalid workspace snapshot.', parsed.error)
    const workspace = parsed.data as AppData
    workspace.notebooks.forEach(rememberSources)
    return workspace
  }

  async function loadSharedNotebook(token: string): Promise<SharedNotebook> {
    const { data, error } = await client.rpc('load_shared_notebook', { requested_share_token: token })
    if (error) throw databaseError('The shared notebook could not be loaded from Supabase.', error)
    if (data === null) throw new RepositoryError('This shared notebook link is unavailable or has been revoked.')
    const parsed = sharedNotebookSchema.safeParse(data)
    if (!parsed.success) throw databaseError('Supabase returned an invalid shared notebook snapshot.', parsed.error)
    return parsed.data as SharedNotebook
  }

  async function getNotebookSharing(id: string): Promise<NotebookShareDetails> {
    const { data, error } = await client.from('notebooks').select('sharing_access, share_token').eq('id', id).single()
    if (error) throw databaseError('The notebook sharing settings could not be loaded.', error)
    const parsed = shareDetailsSchema.safeParse({ access: data?.sharing_access, token: data?.share_token })
    if (!parsed.success) throw databaseError('Supabase returned invalid notebook sharing settings.', parsed.error)
    return parsed.data as NotebookShareDetails
  }

  async function setNotebookSharing(id: string, access: NotebookShareAccess): Promise<NotebookShareDetails> {
    const { data, error } = await client.rpc('set_notebook_sharing', {
      requested_notebook_id: id,
      requested_access: access,
    })
    if (error) throw databaseError('The notebook sharing settings could not be updated.', error)
    const parsed = shareDetailsSchema.safeParse(data)
    if (!parsed.success) throw databaseError('Supabase returned invalid notebook sharing settings.', parsed.error)
    return parsed.data as NotebookShareDetails
  }

  function saveNotebook(notebook: Notebook) {
    const previous = pending.get(notebook.id)?.catch(() => undefined) ?? Promise.resolve()
    const next = previous.then(async () => {
      const { error } = await client.rpc('save_notebook_snapshot', { snapshot: compactSnapshot(notebook) })
      if (error) throw databaseError(`Notebook "${notebook.title}" could not be saved.`, error)
      rememberSources(notebook)
    })
    pending.set(notebook.id, next)
    next.then(
      () => { if (pending.get(notebook.id) === next) pending.delete(notebook.id) },
      () => { if (pending.get(notebook.id) === next) pending.delete(notebook.id) },
    )
    return next
  }

  async function flushNotebook(id: string) {
    await pending.get(id)
  }

  function saveSettings(settings: AppSettings) {
    settingsPending = settingsPending.catch(() => undefined).then(async () => {
      const { data, error: authError } = await client.auth.getUser()
      if (authError || !data.user) throw databaseError('The active Supabase user could not be resolved.', authError)
      const { error } = await client.from('user_settings').upsert({
        user_id: data.user.id,
        theme: settings.theme,
        output_language: settings.outputLanguage,
        updated_at: new Date().toISOString(),
      })
      if (error) throw databaseError('Settings could not be saved.', error)
    })
    return settingsPending
  }

  async function deleteNotebook(id: string) {
    await flushNotebook(id).catch(() => undefined)
    const { error } = await client.from('notebooks').delete().eq('id', id)
    if (error) throw databaseError('The notebook could not be deleted.', error)
    persistedSourceContent.delete(id)
  }

  async function clearWorkspace() {
    await Promise.allSettled([...pending.values(), settingsPending])
    const { error } = await client.rpc('clear_workspace')
    if (error) throw databaseError('The workspace could not be cleared.', error)
    persistedSourceContent.clear()
  }

  return {
    ensureSession, loadWorkspace, loadSharedNotebook, getNotebookSharing, setNotebookSharing,
    saveNotebook, flushNotebook, saveSettings, deleteNotebook, clearWorkspace,
  }
}

export type NotebookRepository = ReturnType<typeof createRepository>

export const repository = {
  ensureSession: (...args: Parameters<NotebookRepository['ensureSession']>) => createRepositorySingleton().ensureSession(...args),
  loadWorkspace: (...args: Parameters<NotebookRepository['loadWorkspace']>) => createRepositorySingleton().loadWorkspace(...args),
  loadSharedNotebook: (...args: Parameters<NotebookRepository['loadSharedNotebook']>) => createRepositorySingleton().loadSharedNotebook(...args),
  getNotebookSharing: (...args: Parameters<NotebookRepository['getNotebookSharing']>) => createRepositorySingleton().getNotebookSharing(...args),
  setNotebookSharing: (...args: Parameters<NotebookRepository['setNotebookSharing']>) => createRepositorySingleton().setNotebookSharing(...args),
  saveNotebook: (...args: Parameters<NotebookRepository['saveNotebook']>) => createRepositorySingleton().saveNotebook(...args),
  flushNotebook: (...args: Parameters<NotebookRepository['flushNotebook']>) => createRepositorySingleton().flushNotebook(...args),
  saveSettings: (...args: Parameters<NotebookRepository['saveSettings']>) => createRepositorySingleton().saveSettings(...args),
  deleteNotebook: (...args: Parameters<NotebookRepository['deleteNotebook']>) => createRepositorySingleton().deleteNotebook(...args),
  clearWorkspace: (...args: Parameters<NotebookRepository['clearWorkspace']>) => createRepositorySingleton().clearWorkspace(...args),
}

let singleton: NotebookRepository | null = null
function createRepositorySingleton() {
  singleton ??= createRepository(requireSupabase())
  return singleton
}
