import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env before verification.')

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const primary = createClient(url, key, clientOptions)
const isolated = createClient(url, key, clientOptions)
const verificationId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
const notebookId = `verification-notebook-${verificationId}`
const sourceId = `verification-source-${verificationId}`
const sourceContent = 'The NotebookLM Supabase deployment verification code is AURORA-731. It was approved on 14 August 2026.'
let primaryAuthenticated = false
let isolatedAuthenticated = false

async function requireAnonymousSession(client, label) {
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw new Error(`${label} anonymous auth failed: ${error?.message || 'no user returned'}`)
  return data.user
}

async function requireWorkspace(client, label) {
  const { data, error } = await client.rpc('load_workspace')
  if (error) throw new Error(`${label} workspace RPC failed: ${error.message}`)
  if (!data || !Array.isArray(data.notebooks)) throw new Error(`${label} workspace RPC returned an invalid payload.`)
  return data
}

async function clearWorkspace(client, label) {
  const { error } = await client.rpc('clear_workspace')
  if (error) throw new Error(`${label} cleanup failed: ${error.message}`)
}

async function functionErrorMessage(error) {
  if (!error) return 'unknown function error'
  const response = error.context
  if (!(response instanceof Response)) return error.message || String(error)
  const body = await response.clone().text().catch(() => '')
  return `${error.message || 'Function request failed'} (HTTP ${response.status})${body ? `: ${body.slice(0, 2_000)}` : ''}`
}

try {
  const primaryUser = await requireAnonymousSession(primary, 'Primary')
  primaryAuthenticated = true
  await clearWorkspace(primary, 'Primary preflight')

  const now = Date.now()
  const snapshot = {
    id: notebookId,
    title: 'Remote verification notebook',
    emoji: '🔎',
    sources: [{
      id: sourceId,
      title: 'Deployment evidence',
      kind: 'text',
      origin: 'remote-verifier',
      content: sourceContent,
      summary: 'A deterministic deployment fact.',
      topics: ['verification', 'supabase'],
      selected: true,
      createdAt: now,
    }],
    messages: [],
    artifacts: [],
    notes: [{ id: `verification-note-${verificationId}`, title: 'Deployment check', body: 'Temporary and removed.', createdAt: now, locked: false }],
    chatConfig: { style: 'Default', length: 'Shorter', instructions: '' },
    createdAt: now,
    updatedAt: now,
  }

  const { error: saveError } = await primary.rpc('save_notebook_snapshot', { snapshot })
  if (saveError) throw new Error(`Snapshot save failed: ${saveError.message}`)

  const { error: settingsError } = await primary.from('user_settings').upsert({
    user_id: primaryUser.id,
    theme: 'dark',
    output_language: 'English',
    updated_at: new Date().toISOString(),
  })
  if (settingsError) throw new Error(`Settings RLS write failed: ${settingsError.message}`)

  const workspace = await requireWorkspace(primary, 'Primary')
  const savedNotebook = workspace.notebooks.find((notebook) => notebook.id === notebookId)
  if (!savedNotebook || savedNotebook.sources?.[0]?.content !== sourceContent || savedNotebook.notes?.length !== 1) {
    throw new Error('Save/load round trip returned an incomplete notebook snapshot.')
  }
  if (workspace.settings?.theme !== 'dark') throw new Error('Settings round trip did not preserve the RLS write.')

  const { data: sources, error: sourcesError } = await primary.rpc('load_ai_sources', {
    requested_notebook_id: notebookId,
    requested_source_ids: [sourceId],
  })
  if (sourcesError || !Array.isArray(sources) || sources.length !== 1 || sources[0]?.content !== sourceContent) {
    throw new Error(`AI source RPC failed its owner check: ${sourcesError?.message || 'unexpected rows returned'}`)
  }

  await requireAnonymousSession(isolated, 'Isolated')
  isolatedAuthenticated = true
  const isolatedWorkspace = await requireWorkspace(isolated, 'Isolated')
  if (isolatedWorkspace.notebooks.length !== 0) throw new Error('RLS isolation failed: another user can see the verification notebook.')

  const { data: leakedSources, error: isolatedSourceError } = await isolated.rpc('load_ai_sources', {
    requested_notebook_id: notebookId,
    requested_source_ids: [sourceId],
  })
  if (isolatedSourceError || !Array.isArray(leakedSources) || leakedSources.length !== 0) {
    throw new Error(`RLS source isolation failed: ${isolatedSourceError?.message || 'another user received source rows'}`)
  }

  const { data: isolatedRows, error: isolatedRowsError } = await isolated.from('notebooks').select('id').eq('id', notebookId)
  if (isolatedRowsError || isolatedRows?.length !== 0) {
    throw new Error(`Direct-table RLS isolation failed: ${isolatedRowsError?.message || 'another user received notebook rows'}`)
  }

  const { error: isolatedFunctionError } = await isolated.functions.invoke('notebook-ai', {
    body: {
      action: 'chat', notebookId, sourceIds: [sourceId], message: 'What is the verification code?', history: [],
      config: { style: 'Default', length: 'Shorter', instructions: '' }, language: 'English',
    },
  })
  if (!isolatedFunctionError) throw new Error('Notebook AI did not reject another user\'s source ID.')

  const { data: status, error: statusError } = await primary.functions.invoke('notebook-ai', { body: { action: 'status' } })
  if (statusError || !status?.configured) {
    throw new Error(`Notebook AI status failed: ${statusError ? await functionErrorMessage(statusError) : 'Groq is not configured'}`)
  }

  const { data: chat, error: chatError } = await primary.functions.invoke('notebook-ai', {
    body: {
      action: 'chat', notebookId, sourceIds: [sourceId], message: 'What is the deployment verification code?', history: [],
      config: { style: 'Default', length: 'Shorter', instructions: '' }, language: 'English',
    },
  })
  if (chatError || !chat?.content?.includes('AURORA-731') || chat?.citations?.[0]?.sourceId !== sourceId) {
    throw new Error(`Grounded Groq chat failed: ${chatError ? await functionErrorMessage(chatError) : 'answer or citation was not grounded'}`)
  }

  const form = new FormData()
  form.set('file', new File(['Non-persistent deployment verification source.'], 'verification.txt', { type: 'text/plain' }))
  const { data: imported, error: importError } = await primary.functions.invoke('source-import', { body: form })
  if (importError || imported?.imported?.content !== 'Non-persistent deployment verification source.') {
    throw new Error(`Source import function failed: ${importError ? await functionErrorMessage(importError) : 'unexpected extraction result'}`)
  }

  await clearWorkspace(primary, 'Primary')
  primaryAuthenticated = false
  const clearedWorkspace = await requireWorkspace(primary, 'Cleared')
  if (clearedWorkspace.notebooks.length !== 0) throw new Error('Workspace cleanup did not remove the verification notebook.')

  console.log(JSON.stringify({
    anonymousAuth: 'ok', snapshotRoundTrip: 'ok', settingsRoundTrip: 'ok', rlsIsolation: 'ok',
    aiSourceRpc: 'ok', notebookAiFunction: 'ok', groundedGroqChat: 'ok', sourceImportFunction: 'ok', cleanup: 'ok',
    groqConfigured: true, primaryModel: status.primaryModel ?? null, responseModel: chat.model ?? null,
  }, null, 2))
} finally {
  if (primaryAuthenticated) await clearWorkspace(primary, 'Primary finalizer').catch((error) => console.error(error.message))
  if (isolatedAuthenticated) await clearWorkspace(isolated, 'Isolated finalizer').catch((error) => console.error(error.message))
}
