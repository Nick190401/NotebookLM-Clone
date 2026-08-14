import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Cloud, LoaderCircle, RefreshCw } from 'lucide-react'
import { getAiStatus } from './lib/api'
import { createBlankNotebook, createEmptyAppData } from './lib/notebook'
import { repository } from './lib/repository'
import type { AiStatus, AppData, AppSettings, Notebook } from './types'
import { HomeScreen } from './components/HomeScreen'
import { SettingsDialog } from './components/SettingsDialog'
import { Workspace } from './components/Workspace'

function notebookIdFromHash() {
  const match = window.location.hash.match(/^#\/notebook\/([^/]+)$/)
  return match?.[1] ?? null
}

export default function App() {
  const [data, setData] = useState<AppData>(() => createEmptyAppData())
  const dataRef = useRef(data)
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(() => notebookIdFromHash())
  const [newNotebookId, setNewNotebookId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  const replaceData = (next: AppData) => {
    dataRef.current = next
    setData(next)
  }

  const activeNotebook = useMemo(() => data.notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null, [activeNotebookId, data.notebooks])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await repository.ensureSession()
        const workspace = await repository.loadWorkspace()
        if (cancelled) return
        replaceData(workspace)
        setLoading(false)
        void getAiStatus().then(setAiStatus).catch(() => setAiStatus(null))
      } catch (caught) {
        if (cancelled) return
        setLoadError(caught instanceof Error ? caught.message : 'The Supabase workspace could not be loaded.')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [loadAttempt])

  useEffect(() => {
    const syncFromHash = () => setActiveNotebookId(notebookIdFromHash())
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => {
      const dark = data.settings.theme === 'dark' || (data.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    applyTheme()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [data.settings.theme])

  const recordPersistenceError = (caught: unknown) => {
    setSyncError(caught instanceof Error ? caught.message : 'Supabase could not save the latest change.')
  }

  const openNotebook = (id: string) => {
    window.location.hash = `/notebook/${id}`
    setActiveNotebookId(id)
  }

  const createNotebook = () => {
    const notebook = createBlankNotebook()
    replaceData({ ...dataRef.current, notebooks: [notebook, ...dataRef.current.notebooks] })
    void repository.saveNotebook(notebook).then(() => setSyncError('')).catch(recordPersistenceError)
    setNewNotebookId(notebook.id)
    openNotebook(notebook.id)
  }

  const updateNotebook = (id: string, recipe: (notebook: Notebook) => Notebook) => {
    const current = dataRef.current.notebooks.find((notebook) => notebook.id === id)
    if (!current) return null
    const next = recipe(current)
    replaceData({ ...dataRef.current, notebooks: dataRef.current.notebooks.map((notebook) => notebook.id === id ? next : notebook) })
    void repository.saveNotebook(next).then(() => setSyncError('')).catch(recordPersistenceError)
    return next
  }

  const updateSettings = (settings: AppSettings) => {
    replaceData({ ...dataRef.current, settings })
    void repository.saveSettings(settings).then(() => setSyncError('')).catch(recordPersistenceError)
  }

  const deleteNotebook = async (id: string) => {
    try {
      await repository.deleteNotebook(id)
      replaceData({ ...dataRef.current, notebooks: dataRef.current.notebooks.filter((notebook) => notebook.id !== id) })
      setSyncError('')
    } catch (caught) {
      recordPersistenceError(caught)
    }
  }

  const clearWorkspace = async () => {
    try {
      await repository.clearWorkspace()
      replaceData(createEmptyAppData())
      setActiveNotebookId(null)
      window.location.hash = ''
      setSyncError('')
    } catch (caught) {
      recordPersistenceError(caught)
    }
  }

  if (loading) {
    return <main className="app-state-screen"><LoaderCircle className="spin" size={30} /><h1>Opening your notebooks</h1><p>Connecting securely to Supabase…</p></main>
  }

  if (loadError) {
    return <main className="app-state-screen error"><AlertTriangle size={30} /><h1>Supabase setup needed</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={() => { setLoading(true); setLoadError(''); setLoadAttempt((value) => value + 1) }}><RefreshCw size={17} /> Try again</button></main>
  }

  return (
    <>
      {syncError && <div className="sync-error-banner" role="alert"><Cloud size={16} /><span>{syncError}</span><button type="button" onClick={() => setSyncError('')}>Dismiss</button></div>}
      {activeNotebook ? (
        <Workspace
          key={activeNotebook.id}
          notebook={activeNotebook}
          settings={data.settings}
          startWithAddSource={newNotebookId === activeNotebook.id}
          aiStatus={aiStatus}
          onBack={() => { window.location.hash = ''; setActiveNotebookId(null); setNewNotebookId(null) }}
          onUpdate={(recipe) => updateNotebook(activeNotebook.id, recipe)}
          onFlush={() => repository.flushNotebook(activeNotebook.id)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <HomeScreen
          notebooks={data.notebooks}
          onCreate={createNotebook}
          onOpen={openNotebook}
          onDelete={(id) => { void deleteNotebook(id) }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      <SettingsDialog open={settingsOpen} data={data} settings={data.settings} aiStatus={aiStatus} onClose={() => setSettingsOpen(false)} onChange={updateSettings} onReset={() => { void clearWorkspace() }} />
    </>
  )
}
