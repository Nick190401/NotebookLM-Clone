import { useMemo, useState } from 'react'
import { ArrowDownAZ, Copy, Grid2X2, List, MoreVertical, Plus, Search, Settings, Trash2 } from 'lucide-react'
import type { AccountIdentity } from '../lib/repository'
import type { Notebook } from '../types'
import { AccountButton } from './AccountButton'
import { Brand } from './Brand'
import { Modal } from './Modal'

interface HomeScreenProps {
  notebooks: Notebook[]
  onCreate: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onOpenSettings: () => void
  account: AccountIdentity
  onOpenAccount: () => void
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function HomeScreen({
  notebooks,
  onCreate,
  onOpen,
  onDelete,
  onDuplicate,
  onOpenSettings,
  account,
  onOpenAccount,
}: HomeScreenProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Notebook | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'title'>('recent')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const visibleNotebooks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return notebooks
      .filter((notebook) => notebook.title.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt))
  }, [notebooks, query, sort])

  return (
    <main className="home-screen">
      <header className="home-topbar">
        <Brand />
        <div className="topbar-actions">
          <button className="primary-button home-create-button" type="button" onClick={onCreate}>
            <Plus size={18} /> New notebook
          </button>
          <button className="icon-button" type="button" onClick={onOpenSettings} aria-label="Settings">
            <Settings size={18} />
          </button>
          <AccountButton account={account} onClick={onOpenAccount} />
        </div>
      </header>

      <section className="home-content" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="eyebrow">Source-grounded workspace</p>
          <h1 id="welcome-title">My notebooks</h1>
          <p>Build understanding from the material you trust.</p>
        </div>

        <div className="recent-heading">
          <div>
            <h2>Recent</h2>
            <span>
              {notebooks.length} notebook{notebooks.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="notebook-toolbar">
            <label className="notebook-search">
              <Search size={17} />
              <span className="visually-hidden">Search notebooks</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notebooks" />
            </label>
            <button
              className="toolbar-select"
              type="button"
              onClick={() => setSort((current) => (current === 'recent' ? 'title' : 'recent'))}
              aria-label={`Sort by ${sort === 'recent' ? 'title' : 'recent activity'}`}
            >
              <ArrowDownAZ size={17} />
              <span>{sort === 'recent' ? 'Most recent' : 'Title'}</span>
            </button>
            <div className="view-toggle" role="group" aria-label="Notebook view">
              <button
                type="button"
                className={view === 'grid' ? 'active' : ''}
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={17} />
              </button>
              <button
                type="button"
                className={view === 'list' ? 'active' : ''}
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className={`notebook-grid ${view === 'list' ? 'list-view' : ''}`}>
          {!query && (
            <button className="new-notebook-card" type="button" onClick={onCreate}>
              <span className="new-notebook-icon">
                <Plus size={26} />
              </span>
              <strong>Create new notebook</strong>
              <span>Upload sources to begin</span>
            </button>
          )}

          {visibleNotebooks.map((notebook, index) => (
            <article className="notebook-card" key={notebook.id}>
              <button
                className="notebook-card-main"
                type="button"
                aria-label={`Open notebook ${notebook.title}`}
                onClick={() => onOpen(notebook.id)}
              >
                <span className={`notebook-cover cover-${index % 4}`}>
                  <span className="notebook-emoji">{notebook.emoji}</span>
                  <span className="cover-lines" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="notebook-card-copy">
                  <strong>{notebook.title}</strong>
                  <span>
                    {notebook.sources.length} source{notebook.sources.length === 1 ? '' : 's'} ·{' '}
                    {relativeTime(notebook.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                className="icon-button notebook-menu-button"
                type="button"
                aria-label={`More options for ${notebook.title}`}
                aria-expanded={menuFor === notebook.id}
                onClick={() => setMenuFor(menuFor === notebook.id ? null : notebook.id)}
              >
                <MoreVertical size={18} />
              </button>
              {menuFor === notebook.id && (
                <div className="context-menu">
                  <button
                    type="button"
                    onClick={() => {
                      onDuplicate(notebook.id)
                      setMenuFor(null)
                    }}
                  >
                    <Copy size={16} /> Create a copy
                  </button>
                  <button
                    type="button"
                    className="danger-menu-item"
                    onClick={() => {
                      setPendingDelete(notebook)
                      setMenuFor(null)
                    }}
                  >
                    <Trash2 size={16} /> Delete notebook
                  </button>
                </div>
              )}
            </article>
          ))}

          {query && visibleNotebooks.length === 0 && (
            <div className="notebook-search-empty">
              <Search size={24} />
              <strong>No notebooks found</strong>
              <span>Try a different title.</span>
            </div>
          )}
        </div>
      </section>

      <footer className="home-footer">
        <span>NotebookLM Clone</span>
        <span>Sources stay grounded and private to your workspace</span>
      </footer>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={`Delete “${pendingDelete?.title ?? ''}”?`}
        description="Deleting a notebook also removes its sources, chat history, Studio outputs, and notes. This cannot be undone."
      >
        <div className="delete-summary">
          <span>
            {pendingDelete?.sources.length ?? 0} source{(pendingDelete?.sources.length ?? 0) === 1 ? '' : 's'}
          </span>
          <span>
            {pendingDelete?.artifacts.length ?? 0} Studio output
            {(pendingDelete?.artifacts.length ?? 0) === 1 ? '' : 's'}
          </span>
          <span>
            {pendingDelete?.notes.length ?? 0} note{(pendingDelete?.notes.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>
            Cancel
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => {
              if (pendingDelete) onDelete(pendingDelete.id)
              setPendingDelete(null)
            }}
          >
            Delete notebook
          </button>
        </div>
      </Modal>
    </main>
  )
}
