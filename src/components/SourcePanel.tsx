import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  MoreVertical,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Source } from '../types'
import { SourceIcon } from './ProductIcon'

interface SourcePanelProps {
  sources: Source[]
  readOnly?: boolean
  onAdd: () => void
  onResearch: (query: string) => void
  onToggle: (id: string) => void
  onToggleAll: (selected: boolean) => void
  onOpen: (source: Source) => void
  onDelete: (id: string) => void
  onCollapse: () => void
}

export function SourcePanel({
  sources,
  readOnly = false,
  onAdd,
  onResearch,
  onToggle,
  onToggleAll,
  onOpen,
  onDelete,
  onCollapse,
}: SourcePanelProps) {
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const selectedCount = sources.filter((source) => source.selected).length
  const allSelected = sources.length > 0 && selectedCount === sources.length

  const submitResearch = () => {
    if (!query.trim()) return
    onResearch(query)
    setQuery('')
  }

  return (
    <section className="workspace-panel sources-panel" aria-labelledby="sources-heading">
      <header className="panel-header">
        <h2 id="sources-heading">Sources</h2>
        <button className="icon-button desktop-only" type="button" onClick={onCollapse} aria-label="Collapse sources panel">
          <PanelLeftClose size={19} />
        </button>
      </header>
      <div className="panel-scroll sources-scroll">
        {!readOnly && <button className="panel-add-button" type="button" onClick={onAdd}>
          <Plus size={19} />
          Add sources
        </button>}

        {!readOnly && <button className="deep-research-banner" type="button" onClick={() => onResearch('Current developments and reliable evidence')}>
          <span className="research-spark"><Sparkles size={19} /></span>
          <span><strong>Try Deep Research</strong><small>Build an in-depth report and find new sources</small></span>
          <ArrowRight size={17} />
        </button>}

        {!readOnly && <div className="source-research-box">
          <div className="source-research-input">
            <Search size={19} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submitResearch() }}
              placeholder="Search the web for sources"
              aria-label="Search the web for sources"
            />
          </div>
          <div className="source-research-footer">
            <button className="mini-select" type="button">Web <ChevronDown size={14} /></button>
            <button className="mini-select" type="button"><Sparkles size={14} /> Fast research <ChevronDown size={14} /></button>
            <button className="round-submit" type="button" onClick={submitResearch} disabled={!query.trim()} aria-label="Research topic">
              <ArrowRight size={19} />
            </button>
          </div>
        </div>}

        {sources.length > 0 ? (
          <div className="source-list-wrap">
            <div className="select-all-row">
              <button type="button" onClick={() => onToggleAll(!allSelected)}>
                <span>Select all sources</span>
                <span className={`source-checkbox ${allSelected ? 'checked' : selectedCount > 0 ? 'mixed' : ''}`}>
                  {allSelected && <Check size={14} />}
                  {!allSelected && selectedCount > 0 && <i />}
                </span>
              </button>
              <small>{selectedCount} of {sources.length}</small>
            </div>
            <div className="source-list">
              {sources.map((source) => (
                <div className={`source-row ${readOnly ? 'read-only' : ''}`} key={source.id}>
                  <button className="source-open-button" type="button" onClick={() => onOpen(source)}>
                    <span className={`source-kind-icon source-${source.kind}`}><SourceIcon kind={source.kind} size={17} /></span>
                    <span className="source-row-copy"><strong>{source.title}</strong><small>{source.kind.toUpperCase()}</small></span>
                  </button>
                  <button
                    type="button"
                    className={`source-check ${source.selected ? 'checked' : ''}`}
                    onClick={() => onToggle(source.id)}
                    aria-label={`${source.selected ? 'Exclude' : 'Include'} ${source.title}`}
                    aria-pressed={source.selected}
                  >
                    {source.selected && <Check size={14} />}
                  </button>
                  {!readOnly && <button
                    className="source-more-button"
                    type="button"
                    aria-label={`More options for ${source.title}`}
                    onClick={() => setMenuFor(menuFor === source.id ? null : source.id)}
                  >
                    <MoreVertical size={16} />
                  </button>}
                  {!readOnly && menuFor === source.id && (
                    <div className="context-menu source-context-menu">
                      <button type="button" onClick={() => onOpen(source)}>Open source guide</button>
                      <button
                        className="danger-menu-item"
                        type="button"
                        onClick={() => { onDelete(source.id); setMenuFor(null) }}
                      >
                        <Trash2 size={15} /> Delete source
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="panel-empty sources-empty">
            <span className="empty-document"><span /><span /><span /></span>
            <h3>{readOnly ? 'No shared sources' : 'Saved sources will appear here'}</h3>
            <p>{readOnly ? 'The notebook owner has not shared any source material.' : 'Add PDFs, websites, text, videos, or audio files to begin.'}</p>
            {!readOnly && <button className="primary-button compact" type="button" onClick={onAdd}>Upload a source</button>}
          </div>
        )}
      </div>
    </section>
  )
}
