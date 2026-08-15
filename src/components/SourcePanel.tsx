import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  FolderInput,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { sourceKindLabel } from '../lib/source'
import type { Source } from '../types'
import { SourceIcon } from './ProductIcon'
import { SourceLabelDialog } from './SourceLabelDialog'

interface SourcePanelProps {
  sources: Source[]
  readOnly?: boolean
  onAdd: () => void
  onResearch: (query: string, mode: 'fast' | 'deep') => void
  onToggle: (id: string) => void
  onToggleAll: (selected: boolean) => void
  onOpen: (source: Source) => void
  onDelete: (id: string) => void
  onOrganize: () => void
  onSetLabel: (id: string, label: string) => void
  onRenameLabel: (currentLabel: string, nextLabel: string) => void
  onDeleteLabel: (label: string) => void
  onCollapse: () => void
}

type LabelAction =
  | { mode: 'source'; source: Source }
  | { mode: 'rename'; label: string }

const researchModes = [
  { value: 'fast', label: 'Fast research', hint: 'One focused web scan', icon: Zap },
  { value: 'deep', label: 'Deep research', hint: 'Multi-step investigation + report', icon: BrainCircuit },
] as const

export function SourcePanel({
  sources,
  readOnly = false,
  onAdd,
  onResearch,
  onToggle,
  onToggleAll,
  onOpen,
  onDelete,
  onOrganize,
  onSetLabel,
  onRenameLabel,
  onDeleteLabel,
  onCollapse,
}: SourcePanelProps) {
  const [query, setQuery] = useState('')
  const [researchMode, setResearchMode] = useState<'fast' | 'deep'>('fast')
  const [researchMenuOpen, setResearchMenuOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [labelMenuFor, setLabelMenuFor] = useState<string | null>(null)
  const [labelAction, setLabelAction] = useState<LabelAction | null>(null)
  const [collapsedLabels, setCollapsedLabels] = useState<Set<string>>(() => new Set())
  const [sourceFilter, setSourceFilter] = useState('')
  const researchMenuRef = useRef<HTMLDivElement>(null)
  const selectedCount = sources.filter((source) => source.selected).length
  const allSelected = sources.length > 0 && selectedCount === sources.length
  const normalizedFilter = sourceFilter.trim().toLowerCase()
  const visibleSources = sources.filter((source) => !normalizedFilter || [source.title, source.summary, source.label, ...source.topics].some((value) => value.toLowerCase().includes(normalizedFilter)))
  const existingLabels = [...new Set(sources.map((source) => source.label).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const grouped = existingLabels.length > 0
  const groups = new Map<string, Source[]>()
  visibleSources.forEach((source) => {
    const label = source.label || ''
    groups.set(label, [...(groups.get(label) ?? []), source])
  })
  const sourceGroups = [...groups.entries()]
    .map(([label, groupSources]) => ({ label, sources: groupSources }))
    .sort((a, b) => {
      if (!a.label) return 1
      if (!b.label) return -1
      return a.label.localeCompare(b.label)
    })
  const unlabeledCount = sources.filter((source) => !source.label).length
  const activeResearchMode = researchModes.find((mode) => mode.value === researchMode) ?? researchModes[0]

  useEffect(() => {
    if (!researchMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!researchMenuRef.current?.contains(event.target as Node)) setResearchMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setResearchMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [researchMenuOpen])

  const submitResearch = () => {
    if (!query.trim()) return
    onResearch(query, researchMode)
    setQuery('')
  }

  const toggleGroup = (label: string) => {
    setCollapsedLabels((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const renderSource = (source: Source) => (
    <div className={`source-row ${readOnly ? 'read-only' : ''}`} key={source.id}>
      <button className="source-open-button" type="button" aria-label={`Open source ${source.title}`} onClick={() => onOpen(source)}>
        <span className={`source-kind-icon source-${source.kind}`}><SourceIcon kind={source.kind} size={17} /></span>
        <span className="source-row-copy"><strong>{source.title}</strong><small>{sourceKindLabel(source)}{source.topics[0] ? ` · ${source.topics[0]}` : ''}</small></span>
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
        aria-expanded={menuFor === source.id}
        onClick={() => { setMenuFor(menuFor === source.id ? null : source.id); setLabelMenuFor(null) }}
      >
        <MoreVertical size={16} />
      </button>}
      {!readOnly && menuFor === source.id && (
        <div className="context-menu source-context-menu">
          <button type="button" onClick={() => { onOpen(source); setMenuFor(null) }}>Open source guide</button>
          <button type="button" onClick={() => { setLabelAction({ mode: 'source', source }); setMenuFor(null) }}><FolderInput size={15} /> Move to label</button>
          <button className="danger-menu-item" type="button" onClick={() => { onDelete(source.id); setMenuFor(null) }}>
            <Trash2 size={15} /> Delete source
          </button>
        </div>
      )}
    </div>
  )

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

        {!readOnly && <button className="deep-research-banner" type="button" onClick={() => onResearch('', 'deep')}>
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
            <span className="mini-select static">Web</span>
            <div className="research-mode-picker" ref={researchMenuRef}>
              <button className="mini-select" type="button" aria-haspopup="menu" aria-expanded={researchMenuOpen} aria-label={`Research mode: ${activeResearchMode.label}`} onClick={() => setResearchMenuOpen(!researchMenuOpen)}>
                <Sparkles size={14} /> {activeResearchMode.label} <ChevronDown size={14} />
              </button>
              {researchMenuOpen && <div className="context-menu research-mode-menu" role="menu" aria-label="Research mode">
                {researchModes.map((mode) => (
                  <button
                    type="button"
                    key={mode.value}
                    role="menuitemradio"
                    aria-checked={researchMode === mode.value}
                    className={researchMode === mode.value ? 'active' : ''}
                    onClick={() => { setResearchMode(mode.value); setResearchMenuOpen(false) }}
                  >
                    <mode.icon size={16} />
                    <span><strong>{mode.label}</strong><small>{mode.hint}</small></span>
                    {researchMode === mode.value && <Check className="research-mode-check" size={15} />}
                  </button>
                ))}
              </div>}
            </div>
            <button className="round-submit" type="button" onClick={submitResearch} disabled={!query.trim()} aria-label="Research topic">
              <ArrowRight size={19} />
            </button>
          </div>
        </div>}

        {sources.length > 0 ? (
          <div className="source-list-wrap">
            <label className="source-filter-input">
              <Search size={16} />
              <span className="visually-hidden">Filter sources</span>
              <input value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} placeholder="Filter sources" />
              {sourceFilter && <button type="button" onClick={() => setSourceFilter('')} aria-label="Clear source filter"><X size={15} /></button>}
            </label>
            {!readOnly && sources.length >= 5 && unlabeledCount > 0 && <div className="source-organize-callout">
              <span className="source-organize-icon"><Sparkles size={16} /></span>
              <span><strong>Organize by topic</strong><small>{unlabeledCount} source{unlabeledCount === 1 ? '' : 's'} without a label</small></span>
              <button type="button" onClick={onOrganize}>Organize</button>
            </div>}
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
              {grouped ? sourceGroups.map((group) => {
                const collapsed = collapsedLabels.has(group.label)
                const groupName = group.label || 'Unlabeled'
                return <div className="source-group" key={`label:${group.label}`}>
                  <div className="source-group-header">
                    <button className="source-group-toggle" type="button" onClick={() => toggleGroup(group.label)} aria-expanded={!collapsed}>
                      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                      <Tag size={14} />
                      <strong>{groupName}</strong>
                      <span>{group.sources.length}</span>
                    </button>
                    {!readOnly && group.label && <button
                      className="source-group-menu-button"
                      type="button"
                      aria-label={`Manage label ${group.label}`}
                      aria-expanded={labelMenuFor === group.label}
                      onClick={() => { setLabelMenuFor(labelMenuFor === group.label ? null : group.label); setMenuFor(null) }}
                    ><MoreVertical size={15} /></button>}
                    {!readOnly && labelMenuFor === group.label && <div className="context-menu source-group-context-menu">
                      <button type="button" onClick={() => { setLabelAction({ mode: 'rename', label: group.label }); setLabelMenuFor(null) }}><Pencil size={15} /> Rename label</button>
                      <button type="button" onClick={() => { onDeleteLabel(group.label); setLabelMenuFor(null) }}><Trash2 size={15} /> Delete label</button>
                    </div>}
                  </div>
                  {!collapsed && <div className="source-group-items">{group.sources.map(renderSource)}</div>}
                </div>
              }) : visibleSources.map(renderSource)}
              {visibleSources.length === 0 && <div className="source-filter-empty"><Search size={20} /><strong>No matching sources</strong><span>Search by title, label, or topic.</span></div>}
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
      {labelAction && <SourceLabelDialog
        key={labelAction.mode === 'source' ? `source:${labelAction.source.id}:${labelAction.source.label}` : `rename:${labelAction.label}`}
        open
        mode={labelAction.mode}
        subject={labelAction.mode === 'source' ? labelAction.source.title : labelAction.label}
        currentLabel={labelAction.mode === 'source' ? labelAction.source.label : labelAction.label}
        labels={existingLabels}
        onClose={() => setLabelAction(null)}
        onSave={(label) => {
          if (labelAction.mode === 'source') onSetLabel(labelAction.source.id, label)
          else onRenameLabel(labelAction.label, label)
          setLabelAction(null)
        }}
        onRemove={() => {
          if (labelAction.mode === 'source') onSetLabel(labelAction.source.id, '')
          else onDeleteLabel(labelAction.label)
          setLabelAction(null)
        }}
      />}
    </section>
  )
}
