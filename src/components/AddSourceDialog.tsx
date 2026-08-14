import { useRef, useState, type DragEvent } from 'react'
import { CirclePlay, FileText, Globe2, HardDrive, Link2, LoaderCircle, Search, Type, UploadCloud } from 'lucide-react'
import { discoverSources, importSourceUrl, uploadSource, type DiscoveredSource } from '../lib/api'
import { makeSource } from '../lib/source'
import type { AppSettings, Source } from '../types'
import { Modal } from './Modal'

type SourceTab = 'upload' | 'website' | 'youtube' | 'paste' | 'discover'

interface AddSourceDialogProps {
  open: boolean
  language: AppSettings['outputLanguage']
  initialQuery?: string
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

export function AddSourceDialog({ open, language, initialQuery = '', onClose, onAdd }: AddSourceDialogProps) {
  const [tab, setTab] = useState<SourceTab>(initialQuery ? 'discover' : 'upload')
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [query, setQuery] = useState(initialQuery)
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

  const importFiles = (files: File[]) => void run(async () => {
    if (!files.length) throw new Error('Choose at least one source file.')
    const imported = await Promise.all(files.map(uploadSource))
    finish(imported.map(makeSource))
  })

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    importFiles(Array.from(event.dataTransfer.files))
  }

  const addUrl = () => void run(async () => {
    const parsed = new URL(url)
    const imported = await importSourceUrl(parsed.toString())
    finish([makeSource({ ...imported, title: title.trim() || imported.title })])
  })

  const runDiscovery = () => void run(async () => {
    if (!query.trim()) throw new Error('Enter a topic or research question first.')
    const results = await discoverSources(query, language)
    setDiscoverResults(results)
    setSelectedResults(new Set(results.map((item) => item.id)))
  })

  const importDiscovery = () => void run(async () => {
    const selected = discoverResults.filter((item) => selectedResults.has(item.id))
    const imported = await Promise.all(selected.map((item) => importSourceUrl(item.url)))
    finish(imported.map(makeSource))
  })

  return (
    <Modal open={open} onClose={onClose} title="Add sources" description="Sources are extracted in an authenticated Supabase Edge Function and used only for grounded AI requests." className="add-source-modal" wide>
      <div className="source-tabs" role="tablist" aria-label="Source type">
        {tabs.map((item) => {
          const Icon = item.icon
          return <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} disabled={busy} onClick={() => { setTab(item.id); setError('') }}><Icon size={17} />{item.label}</button>
        })}
      </div>

      <div className="source-tab-content" aria-busy={busy}>
        {tab === 'upload' && (
          <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
            <span className="drop-icon">{busy ? <LoaderCircle className="spin" size={29} /> : <UploadCloud size={29} />}</span>
            <h3>{busy ? 'Extracting source…' : 'Upload a source'}</h3>
            <p>PDFs and documents are parsed, audio is transcribed, and images are read with vision AI.</p>
            <button className="primary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Choose files</button>
            <input ref={inputRef} className="visually-hidden" type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.png,.jpg,.jpeg,.webp,audio/*" onChange={(event) => importFiles(Array.from(event.target.files ?? []))} />
            <small>PDF, DOCX, text, images, or audio · up to 25 MB each</small>
            <div className="drive-callout"><HardDrive size={19} /><span><strong>Google Drive files</strong><small>Export the file from Drive, then upload it here. Private Drive access requires a separate Google OAuth setup.</small></span></div>
          </div>
        )}

        {(tab === 'website' || tab === 'youtube') && (
          <form className="url-source-form" onSubmit={(event) => { event.preventDefault(); addUrl() }}>
            <span className="form-illustration">{busy ? <LoaderCircle className="spin" size={31} /> : tab === 'youtube' ? <CirclePlay size={31} /> : <Link2 size={31} />}</span>
            <h3>{tab === 'youtube' ? 'Add a YouTube video' : 'Add a website'}</h3>
            <p>{tab === 'youtube' ? 'The public transcript is imported; videos without captions cannot be added.' : 'The readable page content is downloaded and stripped of navigation and scripts.'}</p>
            <label>Source URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" type="url" required autoFocus /></label>
            <label>Display title <span>optional</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Use the detected title" /></label>
            <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Importing…' : 'Add source'}</button></div>
          </form>
        )}

        {tab === 'paste' && (
          <form className="paste-source-form" onSubmit={(event) => { event.preventDefault(); if (!text.trim()) { setError('Paste some source text first.'); return }; finish([makeSource({ title: title || 'Copied text', kind: 'text', origin: 'Pasted text', content: text })]) }}>
            <label>Source title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give your source a useful name" /></label>
            <label>Pasted text<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste an article, transcript, meeting notes, or any text…" rows={10} autoFocus /></label>
            <div className="paste-meta"><span>{text.trim() ? text.trim().split(/\s+/).length : 0} words</span><span>Stored in Supabase; sent to Groq only when used</span></div>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Add source</button></div>
          </form>
        )}

        {tab === 'discover' && (
          <div className="discover-view">
            <div className="discover-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); runDiscovery() } }} placeholder="Research a topic or ask a question" autoFocus /><button className="primary-button compact" type="button" disabled={busy} onClick={runDiscovery}>{busy ? 'Searching…' : 'Search'}</button></div>
            <div className="research-modes" aria-label="Research mode"><button className="chip selected" type="button"><Globe2 size={15} /> Live web</button><button className="chip selected" type="button">✦ Groq Compound</button></div>
            {discoverResults.length === 0 ? <div className="discover-empty">{busy ? <LoaderCircle className="spin" size={35} /> : <Search size={35} />}<h3>Find credible sources</h3><p>AI-assisted live web results can be reviewed before their full content is imported.</p></div> : (
              <div className="discover-results">
                <div className="result-heading"><strong>Suggested sources</strong><span>{selectedResults.size} selected</span></div>
                {discoverResults.map((source) => <label className="discover-result" key={source.id}><input type="checkbox" checked={selectedResults.has(source.id)} onChange={() => setSelectedResults((current) => { const next = new Set(current); if (next.has(source.id)) next.delete(source.id); else next.add(source.id); return next })} /><span><strong>{source.title}</strong><small>{source.summary}</small><em>{source.url}</em></span></label>)}
                <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setDiscoverResults([])}>New search</button><button className="primary-button" type="button" disabled={busy || selectedResults.size === 0} onClick={importDiscovery}>{busy ? 'Importing…' : `Import ${selectedResults.size} source${selectedResults.size === 1 ? '' : 's'}`}</button></div>
              </div>
            )}
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
