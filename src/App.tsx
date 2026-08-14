import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Cloud, LoaderCircle, RefreshCw } from 'lucide-react'
import { getAiStatus } from './lib/api'
import { createBlankNotebook, createEmptyAppData } from './lib/notebook'
import { repository } from './lib/repository'
import type { AiStatus, AppData, AppSettings, Notebook } from './types'
import { HomeScreen } from './components/HomeScreen'
import { SettingsDialog } from './components/SettingsDialog'
import { Workspace } from './components/Workspace'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function notebookIdFromHash() {
  const match = window.location.hash.match(/^#\/notebook\/([^/]+)$/)
  return match?.[1] ?? null
}

function sharedRouteFromHash() {
  const match = window.location.hash.match(/^#\/shared\/([^/]+)$/)
  if (!match) return { present: false, token: null }
  return { present: true, token: UUID_PATTERN.test(match[1]) ? match[1] : null }
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
  const [sharedToken, setSharedToken] = useState<string | null>(null)
  const [sharedAccess, setSharedAccess] = useState<'full' | 'chat' | null>(null)

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
        const sharedRoute = sharedRouteFromHash()
        if (sharedRoute.present && !sharedRoute.token) throw new Error('This shared notebook link is invalid.')
        if (sharedRoute.token) {
          const shared = await repository.loadSharedNotebook(sharedRoute.token)
          if (cancelled) return
          replaceData({ notebooks: [shared.notebook], settings: createEmptyAppData().settings })
          setActiveNotebookId(shared.notebook.id)
          setSharedToken(sharedRoute.token)
          setSharedAccess(shared.access)
          setAiStatus(null)
          setLoading(false)
          return
        }
        const workspace = await repository.loadWorkspace()
        if (cancelled) return
        replaceData(workspace)
        setActiveNotebookId(notebookIdFromHash())
        setSharedToken(null)
        setSharedAccess(null)
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
    const syncFromHash = () => {
      const nextSharedRoute = sharedRouteFromHash()
      const currentlyShared = sharedToken !== null || sharedAccess !== null
      if (nextSharedRoute.present !== currentlyShared || (nextSharedRoute.token && nextSharedRoute.token !== sharedToken)) {
        setLoading(true)
        setLoadError('')
        setLoadAttempt((value) => value + 1)
        return
      }
      if (!nextSharedRoute.present) setActiveNotebookId(notebookIdFromHash())
    }
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [sharedAccess, sharedToken])

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

  const updateSharedNotebook = (id: string, recipe: (notebook: Notebook) => Notebook) => {
    const current = dataRef.current.notebooks.find((notebook) => notebook.id === id)
    if (!current) return null
    const next = recipe(current)
    replaceData({ ...dataRef.current, notebooks: dataRef.current.notebooks.map((notebook) => notebook.id === id ? next : notebook) })
    return next
  }

  const leaveSharedNotebook = () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setLoadError('')
    setLoading(true)
    setLoadAttempt((value) => value + 1)
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
    const openingSharedNotebook = sharedRouteFromHash().present
    return <main className="app-state-screen"><LoaderCircle className="spin" size={30} /><h1>{openingSharedNotebook ? 'Opening shared notebook' : 'Opening your notebooks'}</h1><p>Connecting securely to Supabase…</p></main>
  }

  if (loadError) {
    const sharedRouteFailed = sharedRouteFromHash().present
    return <main className="app-state-screen error"><AlertTriangle size={30} /><h1>{sharedRouteFailed ? 'Shared notebook unavailable' : 'Supabase setup needed'}</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={sharedRouteFailed ? leaveSharedNotebook : () => { setLoading(true); setLoadError(''); setLoadAttempt((value) => value + 1) }}>{sharedRouteFailed ? null : <RefreshCw size={17} />}{sharedRouteFailed ? 'Go to my notebooks' : 'Try again'}</button></main>
  }

  return (
    <>
      {syncError && <div className="sync-error-banner" role="alert"><Cloud size={16} /><span>{syncError}</span><button type="button" onClick={() => setSyncError('')}>Dismiss</button></div>}
      {activeNotebook ? (
        <Workspace
          key={`${activeNotebook.id}-${sharedToken ?? 'owner'}`}
          notebook={activeNotebook}
          settings={data.settings}
          startWithAddSource={!sharedToken && newNotebookId === activeNotebook.id}
          aiStatus={aiStatus}
          shareAccess={sharedAccess ?? undefined}
          shareToken={sharedToken ?? undefined}
          onBack={sharedToken ? leaveSharedNotebook : () => { window.location.hash = ''; setActiveNotebookId(null); setNewNotebookId(null) }}
          onUpdate={(recipe) => sharedToken ? updateSharedNotebook(activeNotebook.id, recipe) : updateNotebook(activeNotebook.id, recipe)}
          onFlush={() => sharedToken ? Promise.resolve() : repository.flushNotebook(activeNotebook.id)}
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
      {!sharedToken && <SettingsDialog open={settingsOpen} data={data} settings={data.settings} aiStatus={aiStatus} onClose={() => setSettingsOpen(false)} onChange={updateSettings} onReset={() => { void clearWorkspace() }} />}
    </>
  )
}
