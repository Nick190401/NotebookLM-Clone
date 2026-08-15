import { useRef, useState, type DragEvent } from 'react'
import {
  BrainCircuit,
  CirclePlay,
  ExternalLink,
  FileSearch,
  FileText,
  Globe2,
  HardDrive,
  Link2,
  LoaderCircle,
  Search,
  Sparkles,
  Type,
  UploadCloud,
  Zap,
} from 'lucide-react'
import {
  discoverSources,
  importSourceUrl,
  runDeepResearch,
  uploadSource,
  type DeepResearchResult,
  type DiscoveredSource,
} from '../lib/api'
import { makeSource } from '../lib/source'
import type { AppSettings, Source } from '../types'
import { Modal } from './Modal'

type SourceTab = 'upload' | 'website' | 'youtube' | 'paste' | 'discover'
export type ResearchMode = 'fast' | 'deep'

interface AddSourceDialogProps {
  open: boolean
  language: AppSettings['outputLanguage']
  initialQuery?: string
  initialResearchMode?: ResearchMode
  onClose: () => void
  onAdd: (sources: Source[]) => void
}

const tabs: { id: SourceTab; label: string; icon: typeof FileText }[] = [
  { id: 'upload', label: 'Upload', icon: UploadCloud },
  { id: 'website', label: 'Website', icon: Globe2 },
  { id: 'youtube', label: 'YouTube', icon: CirclePlay },
  { id: 'paste', label: 'Copied text', icon: Type },
  { id: 'discover', label: 'Discover', icon: Search },
]

function renderResearchReport(report: string) {
  return report.split(/\n{2,}/).map((block, index) => {
    const heading = block.match(/^#{1,3}\s+(.+)$/)
    if (heading) return <h3 key={index}>{heading[1]}</h3>
    const lines = block.split('\n')
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return (
        <ul key={index}>
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{line.replace(/^[-*]\s+/, '')}</li>
          ))}
        </ul>
      )
    }
    return <p key={index}>{block.replace(/\*\*/g, '')}</p>
  })
}

export function AddSourceDialog({
  open,
  language,
  initialQuery = '',
  initialResearchMode = 'fast',
  onClose,
  onAdd,
}: AddSourceDialogProps) {
  const [tab, setTab] = useState<SourceTab>(initialQuery || initialResearchMode === 'deep' ? 'discover' : 'upload')
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [query, setQuery] = useState(initialQuery)
  const [researchMode, setResearchMode] = useState<ResearchMode>(initialResearchMode)
  const [deepResearch, setDeepResearch] = useState<DeepResearchResult | null>(null)
  const [discoverResults, setDiscoverResults] = useState<DiscoveredSource[]>([])
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const finish = (sources: Source[]) => {
    onAdd(sources)
    setUrl('')
    setTitle('')
    setText('')
    setQuery('')
    setDeepResearch(null)
    setDiscoverResults([])
    setSelectedResults(new Set())
    setError('')
    onClose()
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The source could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  /** Imports are independent: one failing item must not discard the ones that succeeded. */
  const settleImports = async <T,>(
    items: T[],
    importOne: (item: T) => Promise<Parameters<typeof makeSource>[0]>,
    describe: (item: T) => string,
  ) => {
    const settled = await Promise.allSettled(items.map(importOne))
    const sources = settled.flatMap((result) => (result.status === 'fulfilled' ? [makeSource(result.value)] : []))
    const failures = settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${describe(items[index])}: ${result.reason instanceof Error ? result.reason.message : 'Import failed.'}`]
        : [],
    )
    return { sources, failures }
  }

  const importFiles = (files: File[]) =>
    void run(async () => {
      if (!files.length) throw new Error('Choose at least one source file.')
      const { sources, failures } = await settleImports(files, uploadSource, (file) => file.name)
      if (!sources.length) throw new Error(failures.join(' · ') || 'The source could not be imported.')
      // Partial success adds what worked but keeps the dialog open, so the skipped files stay visible.
      if (failures.length) {
        onAdd(sources)
        setError(`${sources.length} of ${files.length} imported. Skipped — ${failures.join(' · ')}`)
        return
      }
      finish(sources)
    })

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    importFiles(Array.from(event.dataTransfer.files))
  }

  const addUrl = () =>
    void run(async () => {
      const parsed = new URL(url)
      const imported = await importSourceUrl(parsed.toString())
      finish([makeSource({ ...imported, title: title.trim() || imported.title })])
    })

  const runDiscovery = () =>
    void run(async () => {
      const researchQuery = query.trim()
      if (researchQuery.length < 3) throw new Error('Enter a topic or research question first.')
      setDiscoverResults([])
      setDeepResearch(null)
      const research = researchMode === 'deep' ? await runDeepResearch(researchQuery, language) : null
      const results = research?.results ?? (await discoverSources(researchQuery, language))
      setDeepResearch(research)
      setDiscoverResults(results)
      setSelectedResults(new Set(results.map((item) => item.id)))
    })

  const importDiscovery = () =>
    void run(async () => {
      const selected = discoverResults.filter((item) => selectedResults.has(item.id))
      const { sources, failures } = await settleImports(
        selected,
        (item) => importSourceUrl(item.url),
        (item) => item.title,
      )
      if (!deepResearch && !sources.length) throw new Error(failures.join(' · ') || 'No source could be imported.')
      // The report leads the import and carries its own source list, because the cited pages
      // are not always importable on their own.
      if (deepResearch) {
        const appendix = deepResearch.results
          .map((source, index) => `[${index + 1}] ${source.title}\n${source.url}`)
          .join('\n\n')
        sources.unshift(
          makeSource({
            title: `Deep Research: ${query.trim()}`,
            kind: 'text',
            origin: `${deepResearch.model} · ${deepResearch.toolCount} research actions`,
            content: `${deepResearch.report}\n\nVerified web sources\n\n${appendix}`,
          }),
        )
      }
      if (failures.length) {
        onAdd(sources)
        setError(`Imported ${sources.length}. Skipped — ${failures.join(' · ')}`)
        return
      }
      finish(sources)
    })

  const chooseResearchMode = (mode: ResearchMode) => {
    setResearchMode(mode)
    setDiscoverResults([])
    setSelectedResults(new Set())
    setDeepResearch(null)
    setError('')
  }

  const researchImportLabel = deepResearch
    ? selectedResults.size === 0
      ? 'Import report'
      : `Import report + ${selectedResults.size} source${selectedResults.size === 1 ? '' : 's'}`
    : `Import ${selectedResults.size} source${selectedResults.size === 1 ? '' : 's'}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add sources"
      description="Sources are extracted in an authenticated Supabase Edge Function and used only for grounded AI requests."
      className="add-source-modal"
      wide
    >
      <div className="source-tabs" role="tablist" aria-label="Source type">
        {tabs.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'active' : ''}
              disabled={busy}
              onClick={() => {
                setTab(item.id)
                setError('')
              }}
            >
              <Icon size={17} />
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="source-tab-content" aria-busy={busy}>
        {tab === 'upload' && (
          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="drop-icon">
              {busy ? <LoaderCircle className="spin" size={29} /> : <UploadCloud size={29} />}
            </span>
            <h3>{busy ? 'Extracting source…' : 'Upload a source'}</h3>
            <p>PDFs and documents are parsed, audio is transcribed, and images are read with vision AI.</p>
            <button className="primary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
              Choose files
            </button>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.png,.jpg,.jpeg,.webp,audio/*"
              onChange={(event) => importFiles(Array.from(event.target.files ?? []))}
            />
            <small>PDF, DOCX, text, images, or audio · up to 25 MB each</small>
            <div className="drive-callout">
              <HardDrive size={19} />
              <span>
                <strong>Google Drive files</strong>
                <small>
                  Export the file from Drive, then upload it here. Private Drive access requires a separate Google OAuth
                  setup.
                </small>
              </span>
            </div>
          </div>
        )}

        {(tab === 'website' || tab === 'youtube') && (
          <form
            className="url-source-form"
            onSubmit={(event) => {
              event.preventDefault()
              addUrl()
            }}
          >
            <span className="form-illustration">
              {busy ? (
                <LoaderCircle className="spin" size={31} />
              ) : tab === 'youtube' ? (
                <CirclePlay size={31} />
              ) : (
                <Link2 size={31} />
              )}
            </span>
            <h3>{tab === 'youtube' ? 'Add a YouTube video' : 'Add a website'}</h3>
            <p>
              {tab === 'youtube'
                ? 'The public transcript is imported; videos without captions cannot be added.'
                : 'The readable page content is downloaded and stripped of navigation and scripts.'}
            </p>
            <label>
              Source URL
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
                type="url"
                required
                autoFocus
              />
            </label>
            <label>
              Display title <span>optional</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Use the detected title"
              />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Importing…' : 'Add source'}
              </button>
            </div>
          </form>
        )}

        {tab === 'paste' && (
          <form
            className="paste-source-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!text.trim()) {
                setError('Paste some source text first.')
                return
              }
              finish([
                makeSource({ title: title || 'Copied text', kind: 'text', origin: 'Pasted text', content: text }),
              ])
            }}
          >
            <label>
              Source title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Give your source a useful name"
              />
            </label>
            <label>
              Pasted text
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste an article, transcript, meeting notes, or any text…"
                rows={10}
                autoFocus
              />
            </label>
            <div className="paste-meta">
              <span>{text.trim() ? text.trim().split(/\s+/).length : 0} words</span>
              <span>Stored in Supabase; sent to Groq only when used</span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Add source
              </button>
            </div>
          </form>
        )}

        {tab === 'discover' && (
          <div className="discover-view">
            <div className="research-mode-grid" role="group" aria-label="Research mode">
              <button
                className={researchMode === 'fast' ? 'selected' : ''}
                type="button"
                aria-pressed={researchMode === 'fast'}
                disabled={busy}
                onClick={() => chooseResearchMode('fast')}
              >
                <span>
                  <Zap size={17} />
                </span>
                <strong>Fast Research</strong>
                <small>One focused web scan</small>
              </button>
              <button
                className={researchMode === 'deep' ? 'selected' : ''}
                type="button"
                aria-pressed={researchMode === 'deep'}
                disabled={busy}
                onClick={() => chooseResearchMode('deep')}
              >
                <span>
                  <BrainCircuit size={17} />
                </span>
                <strong>Deep Research</strong>
                <small>Multi-step investigation + report</small>
              </button>
            </div>
            <div className="discover-search">
              <Search size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    runDiscovery()
                  }
                }}
                placeholder={
                  researchMode === 'deep' ? 'Ask a detailed research question' : 'Research a topic or ask a question'
                }
                autoFocus
              />
              <button className="primary-button compact" type="button" disabled={busy} onClick={runDiscovery}>
                {busy
                  ? researchMode === 'deep'
                    ? 'Researching…'
                    : 'Searching…'
                  : researchMode === 'deep'
                    ? 'Start research'
                    : 'Search'}
              </button>
            </div>
            <div className="research-capabilities">
              <span>
                <Globe2 size={14} /> Live web
              </span>
              {researchMode === 'deep' && (
                <>
                  <span>
                    <Search size={14} /> Multiple searches
                  </span>
                  <span>
                    <FileSearch size={14} /> Visits sources
                  </span>
                </>
              )}
            </div>
            {discoverResults.length === 0 ? (
              busy && researchMode === 'deep' ? (
                <div className="deep-research-progress">
                  <span className="research-orbit">
                    <LoaderCircle className="spin" size={24} />
                  </span>
                  <h3>Investigating the web</h3>
                  <p>
                    Groq is browsing from multiple angles, cross-checking visited sources, and synthesizing its
                    findings.
                  </p>
                  <div aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  <small>This can take up to two minutes.</small>
                </div>
              ) : (
                <div className="discover-empty">
                  {busy ? (
                    <LoaderCircle className="spin" size={35} />
                  ) : researchMode === 'deep' ? (
                    <BrainCircuit size={35} />
                  ) : (
                    <Search size={35} />
                  )}
                  <h3>{researchMode === 'deep' ? 'Build a research dossier' : 'Find credible sources'}</h3>
                  <p>
                    {researchMode === 'deep'
                      ? 'Ask a focused question to create a detailed report and a reviewable source set.'
                      : 'AI-assisted live web results can be reviewed before their full content is imported.'}
                  </p>
                </div>
              )
            ) : (
              <div className="discover-results">
                {deepResearch && (
                  <article className="research-report-preview">
                    <header>
                      <span>
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <small>Deep Research report</small>
                        <strong>{query.trim()}</strong>
                      </div>
                      <em>{deepResearch.toolCount} research actions</em>
                    </header>
                    <div>{renderResearchReport(deepResearch.report)}</div>
                  </article>
                )}
                <div className="result-heading">
                  <strong>{deepResearch ? 'Sources reviewed' : 'Suggested sources'}</strong>
                  <span>{selectedResults.size} selected</span>
                </div>
                {discoverResults.map((source) => (
                  <div className="discover-result" key={source.id}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${source.title}`}
                      checked={selectedResults.has(source.id)}
                      onChange={() =>
                        setSelectedResults((current) => {
                          const next = new Set(current)
                          if (next.has(source.id)) next.delete(source.id)
                          else next.add(source.id)
                          return next
                        })
                      }
                    />
                    <span>
                      <strong>{source.title}</strong>
                      <small>{source.summary}</small>
                      <span className="discover-result-meta">
                        <em>{source.url}</em>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          Open <ExternalLink size={12} />
                        </a>
                      </span>
                    </span>
                  </div>
                ))}
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDiscoverResults([])
                      setSelectedResults(new Set())
                      setDeepResearch(null)
                    }}
                  >
                    New research
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy || (!deepResearch && selectedResults.size === 0)}
                    onClick={importDiscovery}
                  >
                    {busy ? 'Importing…' : researchImportLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
