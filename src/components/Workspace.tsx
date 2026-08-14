import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Menu,
  PanelLeftOpen,
  PanelRightOpen,
  Settings,
  Sparkles,
} from 'lucide-react'
import { artifactTitle } from '../data/artifacts'
import { askAi, createArtifact } from '../lib/api'
import { createId } from '../lib/id'
import { makeSource } from '../lib/source'
import type { AccountIdentity } from '../lib/repository'
import type { AiStatus, AppSettings, Artifact, ArtifactConfig, ArtifactType, ChatMessage, Note, Notebook, Source } from '../types'
import { AccountButton } from './AccountButton'
import { AddSourceDialog } from './AddSourceDialog'
import { ArtifactConfigDialog } from './ArtifactConfigDialog'
import { ArtifactViewer } from './ArtifactViewer'
import { Brand } from './Brand'
import { ChatConfigDialog } from './ChatConfigDialog'
import { ChatPanel } from './ChatPanel'
import { NoteEditorDialog } from './NoteEditorDialog'
import { SourceDetailDialog } from './SourceDetailDialog'
import { SourcePanel } from './SourcePanel'
import { StudioPanel } from './StudioPanel'

type MobileTab = 'sources' | 'chat' | 'studio'

interface WorkspaceProps {
  notebook: Notebook
  settings: AppSettings
  startWithAddSource: boolean
  aiStatus: AiStatus | null
  onBack: () => void
  onUpdate: (recipe: (notebook: Notebook) => Notebook) => Notebook | null
  onFlush: () => Promise<void>
  onOpenSettings: () => void
  account: AccountIdentity
  onOpenAccount: () => void
}

const emojiOptions = ['📓', '🚋', '🧠', '🔬', '📚', '🌍', '🎓', '💡']

export function Workspace({ notebook, settings, startWithAddSource, aiStatus, onBack, onUpdate, onFlush, onOpenSettings, account, onOpenAccount }: WorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [addSourceOpen, setAddSourceOpen] = useState(startWithAddSource)
  const [sourceDetail, setSourceDetail] = useState<Source | null>(null)
  const [chatConfigOpen, setChatConfigOpen] = useState(false)
  const [artifactConfigType, setArtifactConfigType] = useState<ArtifactType | null>(null)
  const [artifactViewer, setArtifactViewer] = useState<Artifact | null>(null)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [sourcesVisible, setSourcesVisible] = useState(true)
  const [chatVisible, setChatVisible] = useState(true)
  const [studioVisible, setStudioVisible] = useState(true)
  const [emojiMenuOpen, setEmojiMenuOpen] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [toast, setToast] = useState('')
  const [sourceResearchQuery, setSourceResearchQuery] = useState('')

  const update = (recipe: (current: Notebook) => Notebook) => {
    return onUpdate((current) => ({ ...recipe(current), updatedAt: Date.now() }))
  }

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const addSources = (sources: Source[]) => {
    update((current) => ({ ...current, sources: [...current.sources, ...sources] }))
    showToast(`${sources.length} source${sources.length === 1 ? '' : 's'} added`)
  }

  const toggleSource = (id: string) => update((current) => ({ ...current, sources: current.sources.map((source) => source.id === id ? { ...source, selected: !source.selected } : source) }))

  const sendMessage = async (content: string) => {
    const selectedSources = notebook.sources.filter((source) => source.selected)
    if (!selectedSources.length) {
      showToast('Select at least one source')
      return
    }
    const userMessage: ChatMessage = { id: createId('message'), role: 'user', content, citations: [], createdAt: Date.now() }
    update((current) => ({ ...current, messages: [...current.messages, userMessage] }))
    setChatBusy(true)
    try {
      await onFlush()
      const answer = await askAi({
        notebookId: notebook.id,
        sourceIds: selectedSources.map((source) => source.id),
        message: content,
        history: notebook.messages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        config: notebook.chatConfig,
        language: settings.outputLanguage,
      })
      const assistantMessage: ChatMessage = { id: createId('message'), role: 'assistant', content: answer.content, citations: answer.citations, createdAt: Date.now() }
      update((current) => ({ ...current, messages: [...current.messages, assistantMessage] }))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The AI request failed.'
      const assistantMessage: ChatMessage = { id: createId('message'), role: 'assistant', content: `AI request failed: ${message}`, citations: [], createdAt: Date.now() }
      update((current) => ({ ...current, messages: [...current.messages, assistantMessage] }))
      showToast(message)
    } finally {
      setChatBusy(false)
    }
  }

  const generateArtifact = async (type: ArtifactType, artifactConfig: ArtifactConfig) => {
    const selectedSources = notebook.sources.filter((source) => source.selected)
    if (selectedSources.length === 0) {
      setAddSourceOpen(true)
      return
    }
    const artifact: Artifact = { id: createId('artifact'), type, title: artifactTitle(type), status: 'generating', config: artifactConfig, createdAt: Date.now() }
    update((current) => ({ ...current, artifacts: [...current.artifacts, artifact] }))
    showToast(`${artifactTitle(type)} is generating`)
    try {
      await onFlush()
      const result = await createArtifact({ notebookId: notebook.id, sourceIds: selectedSources.map((source) => source.id), type, config: artifactConfig })
      update((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.id === artifact.id ? { ...item, status: 'ready', content: result.content, model: result.model } : item) }))
      showToast(`${artifactTitle(type)} is ready`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The artifact could not be generated.'
      update((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.id === artifact.id ? { ...item, status: 'error', error: message } : item) }))
      showToast(message)
    }
  }

  const saveMessageToNote = (messageId: string) => update((current) => {
    const message = current.messages.find((item) => item.id === messageId)
    if (!message || message.saved) return current
    return {
      ...current,
      messages: current.messages.map((item) => item.id === messageId ? { ...item, saved: true } : item),
      notes: [...current.notes, { id: createId('note'), title: 'Saved chat response', body: message.content.replace(/\[\d+\]/g, ''), createdAt: Date.now(), locked: true }],
    }
  })

  const saveNote = (title: string, body: string) => update((current) => {
    if (activeNote) return { ...current, notes: current.notes.map((note) => note.id === activeNote.id ? { ...note, title, body } : note) }
    return { ...current, notes: [...current.notes, { id: createId('note'), title, body, createdAt: Date.now() }] }
  })

  const openNote = (note: Note | null) => {
    setActiveNote(note)
    setNoteEditorOpen(true)
  }

  const visibleCount = [sourcesVisible, chatVisible, studioVisible].filter(Boolean).length
  const gridColumns = visibleCount === 3 ? 'minmax(250px, 0.82fr) minmax(420px, 1.75fr) minmax(280px, 1fr)' : visibleCount === 2 ? 'minmax(320px, 1fr) minmax(420px, 1.55fr)' : 'minmax(0, 1fr)'

  return (
    <main className="workspace-screen">
      <header className="workspace-topbar">
        <div className="workspace-identity">
          <button className="icon-button back-button" type="button" onClick={onBack} aria-label="Back to notebooks"><ArrowLeft size={20} /></button>
          <Brand compact />
          <div className="notebook-title-group">
            <div className="emoji-picker-wrap">
              <button className="notebook-emoji-button" type="button" onClick={() => setEmojiMenuOpen(!emojiMenuOpen)} aria-label="Change notebook emoji">{notebook.emoji}<ChevronDown size={12} /></button>
              {emojiMenuOpen && <div className="emoji-menu">{emojiOptions.map((emoji) => <button type="button" key={emoji} onClick={() => { update((current) => ({ ...current, emoji })); setEmojiMenuOpen(false) }}>{emoji}</button>)}</div>}
            </div>
            {titleEditing ? (
              <input
                className="notebook-title-input"
                defaultValue={notebook.title}
                autoFocus
                onBlur={(event) => { const title = event.target.value.trim(); if (title) update((current) => ({ ...current, title })); setTitleEditing(false) }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setTitleEditing(false) }}
              />
            ) : <button className="notebook-title-button" type="button" onClick={() => setTitleEditing(true)}>{notebook.title}</button>}
            <span className="saved-state"><Check size={12} /> Supabase</span>
          </div>
        </div>
        <div className="workspace-actions">
          <button className={`ai-status-chip ${aiStatus?.configured ? 'ready' : 'setup'}`} type="button" onClick={onOpenSettings} title={aiStatus?.configured ? `Groq · ${aiStatus.primaryModel}` : 'Configure Groq'}>
            <Sparkles size={14} />{aiStatus?.configured ? 'Groq AI' : 'Set up AI'}
          </button>
          <button className="outline-button" type="button" onClick={onOpenSettings}><Settings size={16} /><span>Settings</span></button>
          <AccountButton account={account} onClick={onOpenAccount} />
        </div>
      </header>

      <nav className="mobile-workspace-tabs" aria-label="Notebook sections">
        {(['sources', 'chat', 'studio'] as const).map((tab) => <button type="button" key={tab} className={mobileTab === tab ? 'active' : ''} onClick={() => setMobileTab(tab)}>{tab === 'sources' ? `Sources (${notebook.sources.length})` : tab[0].toUpperCase() + tab.slice(1)}</button>)}
      </nav>

      <div className="workspace-shell">
        {!sourcesVisible && <button className="collapsed-panel-button sources-collapsed-button" type="button" onClick={() => setSourcesVisible(true)}><PanelLeftOpen size={18} /> Sources</button>}
        {!chatVisible && <button className="collapsed-panel-button chat-collapsed-button" type="button" onClick={() => setChatVisible(true)}><Menu size={18} /> Chat</button>}
        {!studioVisible && <button className="collapsed-panel-button studio-collapsed-button" type="button" onClick={() => setStudioVisible(true)}><PanelRightOpen size={18} /> Studio</button>}
        <div className="workspace-grid" style={{ gridTemplateColumns: gridColumns }}>
          {sourcesVisible && <div className={mobileTab === 'sources' ? 'mobile-active-panel' : 'mobile-hidden-panel'}>
            <SourcePanel
              sources={notebook.sources}
              onAdd={() => setAddSourceOpen(true)}
              onResearch={(query) => { setSourceResearchQuery(query); setAddSourceOpen(true) }}
              onToggle={toggleSource}
              onToggleAll={(selected) => update((current) => ({ ...current, sources: current.sources.map((source) => ({ ...source, selected })) }))}
              onOpen={setSourceDetail}
              onDelete={(id) => update((current) => ({ ...current, sources: current.sources.filter((source) => source.id !== id) }))}
              onCollapse={() => setSourcesVisible(false)}
            />
          </div>}
          {chatVisible && <div className={mobileTab === 'chat' ? 'mobile-active-panel' : 'mobile-hidden-panel'}>
            <ChatPanel
              messages={notebook.messages}
              sources={notebook.sources}
              config={notebook.chatConfig}
              busy={chatBusy}
              onSend={sendMessage}
              onAddSource={() => setAddSourceOpen(true)}
              onConfigure={() => setChatConfigOpen(true)}
              onClear={() => update((current) => ({ ...current, messages: [] }))}
              onSave={saveMessageToNote}
              onOpenSource={setSourceDetail}
              onCollapse={() => setChatVisible(false)}
            />
          </div>}
          {studioVisible && <div className={mobileTab === 'studio' ? 'mobile-active-panel' : 'mobile-hidden-panel'}>
            <StudioPanel
              artifacts={notebook.artifacts}
              notes={notebook.notes}
              sourceCount={notebook.sources.length}
              settings={settings}
              onGenerate={generateArtifact}
              onCustomize={(type) => notebook.sources.length ? setArtifactConfigType(type) : setAddSourceOpen(true)}
              onOpenArtifact={setArtifactViewer}
              onDeleteArtifact={(id) => update((current) => ({ ...current, artifacts: current.artifacts.filter((artifact) => artifact.id !== id) }))}
              onAddNote={() => openNote(null)}
              onOpenNote={openNote}
              onDeleteNote={(id) => update((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }))}
              onAddSource={() => setAddSourceOpen(true)}
              onCollapse={() => setStudioVisible(false)}
            />
          </div>}
        </div>
      </div>

      <AddSourceDialog key={addSourceOpen ? sourceResearchQuery || 'manual-open' : 'closed'} open={addSourceOpen} language={settings.outputLanguage} initialQuery={sourceResearchQuery} onClose={() => { setAddSourceOpen(false); setSourceResearchQuery('') }} onAdd={addSources} />
      <SourceDetailDialog source={sourceDetail} onClose={() => setSourceDetail(null)} onToggle={toggleSource} />
      <ChatConfigDialog key={`${chatConfigOpen}-${notebook.chatConfig.style}-${notebook.chatConfig.length}`} open={chatConfigOpen} config={notebook.chatConfig} onClose={() => setChatConfigOpen(false)} onSave={(chatConfig) => update((current) => ({ ...current, chatConfig }))} />
      <ArtifactConfigDialog key={artifactConfigType ?? 'artifact-config-closed'} type={artifactConfigType} settings={settings} onClose={() => setArtifactConfigType(null)} onGenerate={generateArtifact} />
      <ArtifactViewer artifact={artifactViewer} sources={notebook.sources} onClose={() => setArtifactViewer(null)} />
      <NoteEditorDialog
        key={`${noteEditorOpen}-${activeNote?.id ?? 'new'}`}
        open={noteEditorOpen}
        note={activeNote}
        onClose={() => setNoteEditorOpen(false)}
        onSave={saveNote}
        onConvert={(note) => addSources([makeSource({ title: note.title, kind: 'text', origin: 'Converted note', content: note.body })])}
      />
      {toast && <div className="toast" role="status"><Sparkles size={16} />{toast}</div>}
    </main>
  )
}
