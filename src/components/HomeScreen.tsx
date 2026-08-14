import { useState } from 'react'
import { MoreVertical, Plus, Settings, Trash2 } from 'lucide-react'
import type { AccountIdentity } from '../lib/repository'
import type { Notebook } from '../types'
import { AccountButton } from './AccountButton'
import { Brand } from './Brand'

interface HomeScreenProps {
  notebooks: Notebook[]
  onCreate: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
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

export function HomeScreen({ notebooks, onCreate, onOpen, onDelete, onOpenSettings, account, onOpenAccount }: HomeScreenProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null)

  return (
    <main className="home-screen">
      <header className="home-topbar">
        <Brand />
        <div className="topbar-actions">
          <button className="outline-button" type="button" onClick={onOpenSettings}>
            <Settings size={17} />
            Settings
          </button>
          <AccountButton account={account} onClick={onOpenAccount} />
        </div>
      </header>

      <section className="home-content" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <p className="eyebrow">Your source-grounded thinking space</p>
          <h1 id="welcome-title">Welcome to NotebookLM</h1>
          <p>Build understanding from the material you trust.</p>
        </div>

        <div className="recent-heading">
          <div>
            <h2>Recent notebooks</h2>
            <span>{notebooks.length} notebook{notebooks.length === 1 ? '' : 's'}</span>
          </div>
          <button className="primary-button compact" type="button" onClick={onCreate}>
            <Plus size={18} />
            New notebook
          </button>
        </div>

        <div className="notebook-grid">
          <button className="new-notebook-card" type="button" onClick={onCreate}>
            <span className="new-notebook-icon"><Plus size={26} /></span>
            <strong>Create new notebook</strong>
            <span>Add sources and start exploring</span>
          </button>

          {notebooks.map((notebook, index) => (
            <article className="notebook-card" key={notebook.id}>
              <button className="notebook-card-main" type="button" aria-label={`Open notebook ${notebook.title}`} onClick={() => onOpen(notebook.id)}>
                <span className={`notebook-cover cover-${index % 4}`}>
                  <span className="notebook-emoji">{notebook.emoji}</span>
                  <span className="cover-lines" aria-hidden="true"><i /><i /><i /></span>
                </span>
                <span className="notebook-card-copy">
                  <strong>{notebook.title}</strong>
                  <span>{notebook.sources.length} source{notebook.sources.length === 1 ? '' : 's'} · {relativeTime(notebook.updatedAt)}</span>
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
                    className="danger-menu-item"
                    onClick={() => {
                      onDelete(notebook.id)
                      setMenuFor(null)
                    }}
                  >
                    <Trash2 size={16} /> Delete notebook
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <footer className="home-footer">
        <span>NotebookLM Clone · Interview build</span>
        <span>Supabase notebooks · grounded Groq AI</span>
      </footer>
    </main>
  )
}
