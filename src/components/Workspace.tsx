import { Suspense, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Globe2,
  Menu,
  PanelLeftOpen,
  PanelRightOpen,
  Settings,
  Share2,
  Sparkles,
} from 'lucide-react'
import { artifactTitle } from '../data/artifacts'
import { createArtifact, streamAskAi } from '../lib/api'
import { useDismissOnOutside } from '../lib/dismiss'
import { createId } from '../lib/id'
import { makeSource, organizeSources, SOURCE_LABEL_THRESHOLD } from '../lib/source'
import type { AccountIdentity } from '../lib/repository'
import type {
  AiStatus,
  AppSettings,
  Artifact,
  ArtifactConfig,
  ArtifactType,
  ChatMessage,
  Citation,
  Note,
  Notebook,
  Source,
} from '../types'
import { AccountButton } from './AccountButton'
import { AddSourceDialog, type ResearchMode } from './AddSourceDialog'
import { Brand } from './Brand'
import { ChatPanel } from './ChatPanel'
import {
  ArtifactConfigDialog,
  ArtifactPromptDialog,
  ArtifactViewer,
  ChatConfigDialog,
  NoteEditorDialog,
  ShareDialog,
  SourceDetailDialog,
} from './lazy'
import { SourcePanel } from './SourcePanel'
import { StudioPanel } from './StudioPanel'

type MobileTab = 'sources' | 'chat' | 'studio'

interface WorkspaceProps {
  notebook: Notebook
  settings: AppSettings
  startWithAddSource: boolean
  aiStatus: AiStatus | null
  shareAccess?: 'full' | 'chat'
  shareToken?: string
  onBack: () => void
  onUpdate: (recipe: (notebook: Notebook) => Notebook) => Notebook | null
  onFlush: () => Promise<void>
  onOpenSettings: () => void
  account: AccountIdentity
  onOpenAccount: () => void
  onCopy?: () => Promise<void>
}

const emojiOptions = ['📓', '🚋', '🧠', '🔬', '📚', '🌍', '🎓', '💡']

export function Workspace({
  notebook,
  settings,
  startWithAddSource,
  aiStatus,
  shareAccess,
  shareToken,
  onBack,
  onUpdate,
  onFlush,
  onOpenSettings,
  account,
  onOpenAccount,
  onCopy,
}: WorkspaceProps) {
  const readOnly = Boolean(shareAccess)
  const chatOnly = shareAccess === 'chat'
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [addSourceOpen, setAddSourceOpen] = useState(!readOnly && startWithAddSource)
  const [sourceDetail, setSourceDetail] = useState<{ source: Source; citation?: Citation } | null>(null)
  const [chatConfigOpen, setChatConfigOpen] = useState(false)
  const [artifactConfigType, setArtifactConfigType] = useState<ArtifactType | null>(null)
  const [artifactViewer, setArtifactViewer] = useState<Artifact | null>(null)
  const [promptArtifact, setPromptArtifact] = useState<Artifact | null>(null)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState<string | null>(null)
  const streamRef = useRef<AbortController | null>(null)
  const [sourcesVisible, setSourcesVisible] = useState(!chatOnly)
  const [chatVisible, setChatVisible] = useState(true)
  const [studioVisible, setStudioVisible] = useState(!chatOnly)
  const [emojiMenuOpen, setEmojiMenuOpen] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [toast, setToast] = useState('')
  const [sourceResearchQuery, setSourceResearchQuery] = useState('')
  const [sourceResearchMode, setSourceResearchMode] = useState<ResearchMode>('fast')
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  useDismissOnOutside(emojiMenuOpen, emojiPickerRef, () => setEmojiMenuOpen(false))

  // Leaving the notebook must not keep a half-written answer streaming.
  useEffect(() => () => streamRef.current?.abort(), [])

  const update = (recipe: (current: Notebook) => Notebook) => {
    return onUpdate((current) => (readOnly ? recipe(current) : { ...recipe(current), updatedAt: Date.now() }))
  }

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const addSources = (sources: Source[]) => {
    update((current) => {
      const nextCount = current.sources.length + sources.length
      if (nextCount < SOURCE_LABEL_THRESHOLD) return { ...current, sources: [...current.sources, ...sources] }
      const existing =
        current.sources.length < SOURCE_LABEL_THRESHOLD ? organizeSources(current.sources) : current.sources
      return { ...current, sources: [...existing, ...organizeSources(sources)] }
    })
    showToast(`${sources.length} source${sources.length === 1 ? '' : 's'} added`)
  }

  const openSourceDialog = () => {
    setSourceResearchQuery('')
    setSourceResearchMode('fast')
    setAddSourceOpen(true)
  }

  const openSourceDetail = (source: Source, citation?: Citation) => {
    setSourceDetail({ source, citation })
  }

  const openResearchDialog = (query: string, mode: ResearchMode) => {
    setSourceResearchQuery(query)
    setSourceResearchMode(mode)
    setAddSourceOpen(true)
  }

  const toggleSource = (id: string) =>
    update((current) => ({
      ...current,
      sources: current.sources.map((source) => (source.id === id ? { ...source, selected: !source.selected } : source)),
    }))

  const organizeSourceLabels = () => {
    update((current) => ({ ...current, sources: organizeSources(current.sources) }))
    showToast('Sources organized by topic')
  }

  const setSourceLabel = (id: string, label: string) => {
    update((current) => ({
      ...current,
      sources: current.sources.map((source) => (source.id === id ? { ...source, label } : source)),
    }))
    showToast(label ? `Moved to ${label}` : 'Label removed')
  }

  const renameSourceLabel = (currentLabel: string, nextLabel: string) => {
    update((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.label === currentLabel ? { ...source, label: nextLabel } : source,
      ),
    }))
    showToast(`Label renamed to ${nextLabel}`)
  }

  const deleteSourceLabel = (label: string) => {
    update((current) => ({
      ...current,
      sources: current.sources.map((source) => (source.label === label ? { ...source, label: '' } : source)),
    }))
    showToast(`Label ${label} removed`)
  }

  const sendMessage = async (content: string) => {
    const selectedSources = notebook.sources.filter((source) => source.selected)
    if (!selectedSources.length) {
      showToast('Select at least one source')
      return
    }
    const userMessage: ChatMessage = {
      id: createId('message'),
      role: 'user',
      content,
      citations: [],
      createdAt: Date.now(),
    }
    update((current) => ({ ...current, messages: [...current.messages, userMessage] }))
    setChatBusy(true)
    setStreamingAnswer('')

    const controller = new AbortController()
    streamRef.current?.abort()
    streamRef.current = controller

    let answer = ''
    let citations: Citation[] = []
    try {
      await onFlush()
      // The partial answer stays in component state; only the finished message is
      // persisted, so a streamed reply costs one snapshot write instead of one
      // per token.
      for await (const event of streamAskAi(
        {
          notebookId: notebook.id,
          sourceIds: selectedSources.map((source) => source.id),
          message: content,
          history: notebook.messages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          config: notebook.chatConfig,
          language: settings.outputLanguage,
          shareToken,
        },
        controller.signal,
      )) {
        if (event.type === 'delta') {
          answer += event.text
          setStreamingAnswer(answer)
        }
        if (event.type === 'done') citations = event.citations
        if (event.type === 'context' && event.omittedSourceIds.length) {
          showToast(
            `${event.omittedSourceIds.length} source${event.omittedSourceIds.length === 1 ? '' : 's'} did not fit the answer context`,
          )
        }
      }
      if (!answer.trim()) throw new Error('The AI returned an empty answer.')
      update((current) => ({
        ...current,
        messages: [
          ...current.messages,
          { id: createId('message'), role: 'assistant', content: answer.trim(), citations, createdAt: Date.now() },
        ],
      }))
    } catch (caught) {
      if (controller.signal.aborted) return
      const message = caught instanceof Error ? caught.message : 'The AI request failed.'
      const partial = answer.trim()
      update((current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: createId('message'),
            role: 'assistant',
            content: partial ? `${partial}\n\n(Interrupted: ${message})` : `AI request failed: ${message}`,
            citations: partial ? citations : [],
            createdAt: Date.now(),
          },
        ],
      }))
      showToast(message)
    } finally {
      if (streamRef.current === controller) streamRef.current = null
      setStreamingAnswer(null)
      setChatBusy(false)
    }
  }

  const generateArtifact = async (type: ArtifactType, artifactConfig: ArtifactConfig) => {
    const selectedSources = notebook.sources.filter((source) => source.selected)
    if (selectedSources.length === 0) {
      openSourceDialog()
      return
    }
    const artifact: Artifact = {
      id: createId('artifact'),
      type,
      title: artifactTitle(type),
      status: 'generating',
      config: artifactConfig,
      createdAt: Date.now(),
    }
    update((current) => ({ ...current, artifacts: [...current.artifacts, artifact] }))
    showToast(`${artifactTitle(type)} is generating`)
    try {
      await onFlush()
      const result = await createArtifact({
        notebookId: notebook.id,
        sourceIds: selectedSources.map((source) => source.id),
        type,
        config: artifactConfig,
      })
      update((current) => ({
        ...current,
        artifacts: current.artifacts.map((item) =>
          item.id === artifact.id ? { ...item, status: 'ready', content: result.content, model: result.model } : item,
        ),
      }))
      showToast(`${artifactTitle(type)} is ready`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The artifact could not be generated.'
      update((current) => ({
        ...current,
        artifacts: current.artifacts.map((item) =>
          item.id === artifact.id ? { ...item, status: 'error', error: message } : item,
        ),
      }))
      showToast(message)
    }
  }

  const saveMessageToNote = (messageId: string) =>
    update((current) => {
      const message = current.messages.find((item) => item.id === messageId)
      if (!message || message.saved) return current
      return {
        ...current,
        messages: current.messages.map((item) => (item.id === messageId ? { ...item, saved: true } : item)),
        notes: [
          ...current.notes,
          {
            id: createId('note'),
            title: 'Saved chat response',
            body: message.content.replace(/\[\d+\]/g, ''),
            createdAt: Date.now(),
            locked: true,
          },
        ],
      }
    })

  const saveNote = (title: string, body: string) =>
    update((current) => {
      if (activeNote)
        return {
          ...current,
          notes: current.notes.map((note) => (note.id === activeNote.id ? { ...note, title, body } : note)),
        }
      return { ...current, notes: [...current.notes, { id: createId('note'), title, body, createdAt: Date.now() }] }
    })

  const openNote = (note: Note | null) => {
    setActiveNote(note)
    setNoteEditorOpen(true)
  }

  const visibleCount = [sourcesVisible && !chatOnly, chatVisible, studioVisible && !chatOnly].filter(Boolean).length
  const gridColumns =
    visibleCount === 3
      ? 'minmax(250px, 0.82fr) minmax(420px, 1.75fr) minmax(280px, 1fr)'
      : visibleCount === 2
        ? 'minmax(320px, 1fr) minmax(420px, 1.55fr)'
        : 'minmax(0, 1fr)'

  return (
    <main className="workspace-screen">
      <header className="workspace-topbar">
        <div className="workspace-identity">
          <button className="icon-button back-button" type="button" onClick={onBack} aria-label="Back to notebooks">
            <ArrowLeft size={20} />
          </button>
          <Brand compact />
          <div className="notebook-title-group">
            {readOnly ? (
              <span className="notebook-emoji-button read-only" aria-hidden="true">
                {notebook.emoji}
              </span>
            ) : (
              <div className="emoji-picker-wrap" ref={emojiPickerRef}>
                <button
                  className="notebook-emoji-button"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={emojiMenuOpen}
                  onClick={() => setEmojiMenuOpen(!emojiMenuOpen)}
                  aria-label="Change notebook emoji"
                >
                  {notebook.emoji}
                  <ChevronDown size={12} />
                </button>
                {emojiMenuOpen && (
                  <div className="emoji-menu" role="menu" aria-label="Notebook emoji">
                    {emojiOptions.map((emoji) => (
                      <button
                        type="button"
                        key={emoji}
                        role="menuitemradio"
                        aria-checked={notebook.emoji === emoji}
                        className={notebook.emoji === emoji ? 'active' : ''}
                        onClick={() => {
                          update((current) => ({ ...current, emoji }))
                          setEmojiMenuOpen(false)
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!readOnly && titleEditing ? (
              <input
                className="notebook-title-input"
                defaultValue={notebook.title}
                autoFocus
                onBlur={(event) => {
                  const title = event.target.value.trim()
                  if (title) update((current) => ({ ...current, title }))
                  setTitleEditing(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setTitleEditing(false)
                }}
              />
            ) : readOnly ? (
              <span className="notebook-title-button read-only">{notebook.title}</span>
            ) : (
              <button className="notebook-title-button" type="button" onClick={() => setTitleEditing(true)}>
                {notebook.title}
              </button>
            )}
            {readOnly && (
              <span className="saved-state">
                <Globe2 size={12} /> Read only
              </span>
            )}
          </div>
        </div>
        <div className="workspace-actions">
          {readOnly ? (
            <>
              {onCopy && (
                <button
                  className="outline-button copy-notebook-button"
                  type="button"
                  disabled={copying}
                  onClick={() => {
                    setCopying(true)
                    void onCopy()
                      .catch((caught) =>
                        showToast(caught instanceof Error ? caught.message : 'The notebook could not be copied.'),
                      )
                      .finally(() => setCopying(false))
                  }}
                >
                  <Copy size={16} />
                  <span>{copying ? 'Copying…' : 'Create a copy'}</span>
                </button>
              )}
              <span className="shared-access-chip">
                <Globe2 size={15} />
                <span>
                  <strong>Shared notebook</strong>
                  <small>{chatOnly ? 'Chat only' : 'Full view'}</small>
                </span>
              </span>
            </>
          ) : (
            <>
              <button
                className="outline-button share-trigger-button"
                type="button"
                aria-label="Share notebook"
                onClick={() => setShareDialogOpen(true)}
              >
                <Share2 size={16} />
                <span>Share</span>
              </button>
              <button
                className={`ai-status-chip ${aiStatus?.configured ? 'ready' : 'setup'}`}
                type="button"
                onClick={onOpenSettings}
                title={aiStatus?.configured ? `Groq · ${aiStatus.primaryModel}` : 'Configure Groq'}
              >
                <Sparkles size={14} />
                {aiStatus?.configured ? 'Groq AI' : 'Set up AI'}
              </button>
              <button
                className="outline-button settings-trigger-button"
                type="button"
                aria-label="Open settings"
                onClick={onOpenSettings}
              >
                <Settings size={16} />
                <span>Settings</span>
              </button>
              <AccountButton account={account} onClick={onOpenAccount} />
            </>
          )}
        </div>
      </header>

      {!chatOnly && (
        <nav className="mobile-workspace-tabs" aria-label="Notebook sections">
          {(['sources', 'chat', 'studio'] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              className={mobileTab === tab ? 'active' : ''}
              onClick={() => setMobileTab(tab)}
            >
              {tab === 'sources' ? `Sources (${notebook.sources.length})` : tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      )}

      <div className={`workspace-shell ${chatOnly ? 'chat-only' : ''}`}>
        {!chatOnly && !sourcesVisible && (
          <button
            className="collapsed-panel-button sources-collapsed-button"
            type="button"
            onClick={() => setSourcesVisible(true)}
          >
            <PanelLeftOpen size={18} /> Sources
          </button>
        )}
        {!chatVisible && (
          <button
            className="collapsed-panel-button chat-collapsed-button"
            type="button"
            onClick={() => setChatVisible(true)}
          >
            <Menu size={18} /> Chat
          </button>
        )}
        {!chatOnly && !studioVisible && (
          <button
            className="collapsed-panel-button studio-collapsed-button"
            type="button"
            onClick={() => setStudioVisible(true)}
          >
            <PanelRightOpen size={18} /> Studio
          </button>
        )}
        <div className="workspace-grid" style={{ gridTemplateColumns: gridColumns }}>
          {!chatOnly && sourcesVisible && (
            <div className={mobileTab === 'sources' ? 'mobile-active-panel' : 'mobile-hidden-panel'}>
              <SourcePanel
                sources={notebook.sources}
                readOnly={readOnly}
                onAdd={openSourceDialog}
                onResearch={openResearchDialog}
                onToggle={toggleSource}
                onToggleAll={(selected) =>
                  update((current) => ({
                    ...current,
                    sources: current.sources.map((source) => ({ ...source, selected })),
                  }))
                }
                onOpen={(source) => openSourceDetail(source)}
                onDelete={(id) =>
                  update((current) => ({ ...current, sources: current.sources.filter((source) => source.id !== id) }))
                }
                onOrganize={organizeSourceLabels}
                onSetLabel={setSourceLabel}
                onRenameLabel={renameSourceLabel}
                onDeleteLabel={deleteSourceLabel}
                onCollapse={() => setSourcesVisible(false)}
              />
            </div>
          )}
          {chatVisible && (
            <div className={mobileTab === 'chat' ? 'mobile-active-panel' : 'mobile-hidden-panel'}>
              <ChatPanel
                messages={notebook.messages}
                sources={notebook.sources}
                config={notebook.chatConfig}
                busy={chatBusy}
                streamingAnswer={streamingAnswer}
                readOnly={readOnly}
                canOpenSources={!chatOnly}
                onSend={sendMessage}
                onAddSource={openSourceDialog}
                onConfigure={() => setChatConfigOpen(true)}
                onClear={() => update((current) => ({ ...current, messages: [] }))}
                onSave={saveMessageToNote}
                onOpenSource={openSourceDetail}
                onCollapse={() => setChatVisible(false)}
              />
            </div>
          )}
          {!chatOnly && studioVisible && (
            <div className={mobileTab === 'studio' ? 'mobile-active-panel' : 'mobile-hidden-panel'}>
              <StudioPanel
                artifacts={notebook.artifacts}
                notes={notebook.notes}
                readOnly={readOnly}
                sourceCount={notebook.sources.length}
                settings={settings}
                onGenerate={generateArtifact}
                onCustomize={(type) => (notebook.sources.length ? setArtifactConfigType(type) : openSourceDialog())}
                onOpenArtifact={setArtifactViewer}
                onViewPrompt={setPromptArtifact}
                onDeleteArtifact={(id) =>
                  update((current) => ({
                    ...current,
                    artifacts: current.artifacts.filter((artifact) => artifact.id !== id),
                  }))
                }
                onAddNote={() => openNote(null)}
                onOpenNote={openNote}
                onDeleteNote={(id) =>
                  update((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }))
                }
                onAddSource={openSourceDialog}
                onCollapse={() => setStudioVisible(false)}
              />
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <AddSourceDialog
          key={addSourceOpen ? `${sourceResearchMode}-${sourceResearchQuery || 'blank'}` : 'closed'}
          open={addSourceOpen}
          language={settings.outputLanguage}
          initialQuery={sourceResearchQuery}
          initialResearchMode={sourceResearchMode}
          onClose={() => {
            setAddSourceOpen(false)
            setSourceResearchQuery('')
            setSourceResearchMode('fast')
          }}
          onAdd={addSources}
        />
      )}

      <Suspense fallback={null}>
        {!chatOnly && sourceDetail && (
          <SourceDetailDialog
            source={sourceDetail.source}
            citation={sourceDetail.citation}
            onClose={() => setSourceDetail(null)}
            onToggle={toggleSource}
          />
        )}
        {!readOnly && chatConfigOpen && (
          <ChatConfigDialog
            key={`${notebook.chatConfig.style}-${notebook.chatConfig.length}`}
            open
            config={notebook.chatConfig}
            onClose={() => setChatConfigOpen(false)}
            onSave={(chatConfig) => update((current) => ({ ...current, chatConfig }))}
          />
        )}
        {!readOnly && artifactConfigType && (
          <ArtifactConfigDialog
            key={artifactConfigType}
            type={artifactConfigType}
            settings={settings}
            onClose={() => setArtifactConfigType(null)}
            onGenerate={generateArtifact}
          />
        )}
        {!chatOnly && artifactViewer && (
          <ArtifactViewer
            artifact={artifactViewer}
            sources={notebook.sources}
            onClose={() => setArtifactViewer(null)}
          />
        )}
        {!readOnly && promptArtifact && (
          <ArtifactPromptDialog artifact={promptArtifact} onClose={() => setPromptArtifact(null)} />
        )}
        {!chatOnly && noteEditorOpen && (
          <NoteEditorDialog
            key={activeNote?.id ?? 'new'}
            open
            note={activeNote}
            readOnly={readOnly}
            onClose={() => setNoteEditorOpen(false)}
            onSave={saveNote}
            onConvert={(note) =>
              addSources([
                makeSource({ title: note.title, kind: 'text', origin: 'Converted note', content: note.body }),
              ])
            }
          />
        )}
        {!readOnly && shareDialogOpen && (
          <ShareDialog
            key={notebook.id}
            open
            notebookId={notebook.id}
            notebookTitle={notebook.title}
            onClose={() => setShareDialogOpen(false)}
          />
        )}
      </Suspense>

      {toast && (
        <div className="toast" role="status">
          <Sparkles size={16} />
          {toast}
        </div>
      )}
    </main>
  )
}
