import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  Check,
  Copy,
  MessageSquarePlus,
  MoreVertical,
  PanelTopClose,
  Save,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react'
import type { ChatConfig, ChatMessage, Citation, Source } from '../types'
import { sourceSummary } from '../lib/source-summary'

interface ChatPanelProps {
  messages: ChatMessage[]
  sources: Source[]
  config: ChatConfig
  busy: boolean
  /** Partial answer text while the model is still writing; null when idle. */
  streamingAnswer?: string | null
  readOnly?: boolean
  canOpenSources?: boolean
  onSend: (message: string) => void
  onAddSource: () => void
  onConfigure: () => void
  onClear: () => void
  onSave: (messageId: string) => void
  onOpenSource: (source: Source, citation?: Citation) => void
  onCollapse: () => void
}

const suggestions = [
  'Summarize the most important ideas',
  'Where do the sources disagree?',
  'What are the practical risks?',
]

/**
 * The preview is anchored to its chip, so a citation near either edge of the
 * column would otherwise be clipped by the neighbouring panels. The offset is
 * derived from the chip and the preview's untransformed width rather than its
 * current rectangle, because that rectangle is mid-transition whenever the
 * pointer arrives from another citation.
 */
function clampPreview(event: { currentTarget: HTMLElement }) {
  const preview = event.currentTarget.querySelector<HTMLElement>('.citation-preview')
  const column = event.currentTarget.closest<HTMLElement>('.message-stream')
  if (!preview || !column) return
  const bounds = column.getBoundingClientRect()
  const chip = event.currentTarget.getBoundingClientRect()
  const centered = chip.left + chip.width / 2 - preview.offsetWidth / 2
  const earliest = bounds.left + 12
  const latest = bounds.right - 12 - preview.offsetWidth
  const placed = Math.max(earliest, Math.min(centered, latest))
  preview.style.setProperty('--citation-shift', `${placed - centered}px`)
}

/** The model writes Markdown emphasis; bold is the only form it uses often. */
function boldSegments(text: string) {
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
    )
}

function renderMessage(
  content: string,
  citations: Citation[],
  onCitation: (citation: Citation) => void,
  canOpenSources: boolean,
  messageId: string,
) {
  const pieces = content.split(/(\[\d+\])/g)
  const output: ReactNode[] = []
  pieces.forEach((piece, index) => {
    const match = piece.match(/^\[(\d+)\]$/)
    if (match) {
      const citation = citations.find((item) => item.label === Number(match[1]))
      if (citation) {
        const previewId = `citation-preview-${messageId}-${citation.label}-${index}`
        output.push(
          canOpenSources ? (
            <button
              className="citation-chip"
              type="button"
              key={`citation-${index}`}
              aria-label={`Citation ${citation.label}`}
              aria-describedby={previewId}
              onMouseEnter={clampPreview}
              onFocus={clampPreview}
              onClick={() => onCitation(citation)}
            >
              <span aria-hidden="true">{citation.label}</span>
              <span id={previewId} className="citation-preview" role="tooltip">
                <strong>Source evidence</strong>
                <span>{citation.excerpt}</span>
                <small>Select to view in context</small>
              </span>
            </button>
          ) : (
            <span className="citation-chip static" key={`citation-${index}`} title={citation.excerpt}>
              {citation.label}
            </span>
          ),
        )
      }
    } else {
      piece.split('\n').forEach((line, lineIndex, lines) => {
        output.push(<span key={`text-${index}-${lineIndex}`}>{boldSegments(line)}</span>)
        if (lineIndex < lines.length - 1) output.push(<br key={`br-${index}-${lineIndex}`} />)
      })
    }
  })
  return output
}

export function ChatPanel({
  messages,
  sources,
  config,
  busy,
  streamingAnswer = null,
  readOnly = false,
  canOpenSources = true,
  onSend,
  onAddSource,
  onConfigure,
  onClear,
  onSave,
  onOpenSource,
  onCollapse,
}: ChatPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedSources = sources.filter((source) => source.selected)

  // A block body matters here: React treats any non-function return value as a
  // cleanup and throws on it in the production build.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [busy, messages.length, streamingAnswer])

  const submit = (value = prompt) => {
    const clean = value.trim()
    if (!clean || busy) return
    onSend(clean)
    setPrompt('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const openCitation = (citation: Citation) => {
    const source = sources.find((item) => item.id === citation.sourceId)
    if (source) onOpenSource(source, citation)
  }

  return (
    <section className="workspace-panel chat-panel" aria-labelledby="chat-heading">
      <header className="panel-header chat-header">
        <h2 id="chat-heading">Chat</h2>
        <div>
          {!readOnly && (
            <button className="icon-button" type="button" onClick={onConfigure} aria-label="Configure chat">
              <SlidersHorizontal size={18} />
              <span className="desktop-label">{config.style}</span>
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Chat options"
          >
            <MoreVertical size={19} />
          </button>
          <button
            className="icon-button desktop-only"
            type="button"
            onClick={onCollapse}
            aria-label="Collapse chat panel"
          >
            <PanelTopClose size={18} />
          </button>
          {menuOpen && (
            <div className="context-menu chat-context-menu">
              <button
                type="button"
                onClick={() => {
                  onClear()
                  setMenuOpen(false)
                }}
              >
                Clear chat history
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="chat-body" aria-label="Chat conversation">
        {sources.length === 0 ? (
          <div className="chat-empty">
            <span className="upload-orbit">
              <Upload size={25} />
            </span>
            <h3>{readOnly ? 'No sources are available' : 'Add a source to get started'}</h3>
            <p>
              {readOnly
                ? 'The owner must share source access before this notebook can answer questions.'
                : 'Chat answers stay grounded in the material you choose.'}
            </p>
            {!readOnly && (
              <button className="primary-button compact" type="button" onClick={onAddSource}>
                Upload a source
              </button>
            )}
          </div>
        ) : (
          <div className="message-stream" aria-live="polite">
            {messages.length === 0 && (
              <div className="notebook-summary">
                <span className="summary-spark">
                  <Sparkles size={20} />
                </span>
                <h3>Notebook guide</h3>
                <p>{sourceSummary(sources)}</p>
                <div className="suggestion-grid">
                  {suggestions.map((suggestion) => (
                    <button type="button" key={suggestion} onClick={() => submit(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                {message.role === 'assistant' && (
                  <span className="assistant-avatar">
                    <Sparkles size={15} />
                  </span>
                )}
                <div className="message-content-wrap">
                  <div className="message-content">
                    {renderMessage(message.content, message.citations, openCitation, canOpenSources, message.id)}
                  </div>
                  {message.role === 'assistant' && (
                    <div className="message-actions">
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => onSave(message.id)}
                          disabled={message.saved}
                          title="Save to note"
                        >
                          {message.saved ? <Check size={15} /> : <Save size={15} />}{' '}
                          {message.saved ? 'Saved' : 'Save to note'}
                        </button>
                      )}
                      <button
                        type="button"
                        title="Copy answer"
                        onClick={() => {
                          void navigator.clipboard?.writeText(message.content)
                          setCopied(message.id)
                          window.setTimeout(() => setCopied(null), 1400)
                        }}
                      >
                        {copied === message.id ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {streamingAnswer !== null && streamingAnswer.length > 0 && (
              <div className="chat-message assistant" key="streaming-answer">
                <span className="assistant-avatar">
                  <Sparkles size={15} />
                </span>
                <div className="message-content-wrap">
                  <div className="message-content streaming">
                    {boldSegments(streamingAnswer)}
                    <span className="stream-caret" aria-hidden="true" />
                  </div>
                </div>
              </div>
            )}
            {busy && !streamingAnswer && (
              <div className="chat-message assistant thinking-message">
                <span className="assistant-avatar">
                  <Sparkles size={15} />
                </span>
                <div>
                  <span />
                  <span />
                  <span />
                  <em>
                    Reading {selectedSources.length} source{selectedSources.length === 1 ? '' : 's'}
                  </em>
                </div>
              </div>
            )}
            {messages.length > 0 && !busy && (
              <div className="followup-suggestions">
                {suggestions.slice(0, 2).map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => submit(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="chat-composer-wrap">
        <div className={`chat-composer ${sources.length === 0 ? 'disabled' : ''} ${readOnly ? 'read-only' : ''}`}>
          {!readOnly && (
            <button className="composer-add" type="button" onClick={onAddSource} aria-label="Add a source">
              <MessageSquarePlus size={18} />
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            rows={1}
            disabled={sources.length === 0}
            placeholder={sources.length === 0 ? 'Upload a source to get started' : 'Ask about your sources…'}
            onChange={(event) => {
              setPrompt(event.target.value)
              event.target.style.height = 'auto'
              event.target.style.height = `${Math.min(event.target.scrollHeight, 132)}px`
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <div className="composer-meta">
            <span>
              {selectedSources.length} source{selectedSources.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              disabled={!prompt.trim() || busy || sources.length === 0}
              onClick={() => submit()}
              aria-label="Send message"
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </div>
        <small>NotebookLM can make mistakes. Check important information against your sources.</small>
      </div>
    </section>
  )
}
