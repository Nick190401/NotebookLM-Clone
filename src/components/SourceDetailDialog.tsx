import { Check, ExternalLink, Quote, Sparkles } from 'lucide-react'
import type { Source } from '../types'
import { Modal } from './Modal'
import { SourceIcon } from './ProductIcon'

interface SourceDetailDialogProps {
  source: Source | null
  onClose: () => void
  onToggle: (id: string) => void
}

export function SourceDetailDialog({ source, onClose, onToggle }: SourceDetailDialogProps) {
  if (!source) return null
  const paragraphs = source.content.split(/\n+/).filter(Boolean)

  return (
    <Modal open title="Source guide" description={source.title} onClose={onClose} wide className="source-detail-modal">
      <div className="source-detail-hero">
        <span className={`source-kind-icon source-${source.kind}`}><SourceIcon kind={source.kind} size={22} /></span>
        <div>
          <h3>{source.title}</h3>
          <p>{source.origin}</p>
        </div>
        <button
          className={`include-source-button ${source.selected ? 'selected' : ''}`}
          type="button"
          onClick={() => onToggle(source.id)}
        >
          {source.selected && <Check size={15} />}
          {source.selected ? 'Included in chat' : 'Include in chat'}
        </button>
      </div>
      <div className="source-guide-grid">
        <aside className="source-guide-sidebar">
          <div className="guide-card summary-card">
            <span><Sparkles size={17} /> Auto summary</span>
            <p>{source.summary}</p>
          </div>
          <div className="guide-card">
            <span>Key topics</span>
            <div className="topic-list">
              {source.topics.length > 0 ? source.topics.map((topic) => <button className="chip" type="button" key={topic}>{topic}</button>) : <small>Topics appear as the source is analyzed.</small>}
            </div>
          </div>
          {source.origin.startsWith('http') && (
            <a className="source-origin-link" href={source.origin} target="_blank" rel="noreferrer">
              Open original <ExternalLink size={15} />
            </a>
          )}
        </aside>
        <article className="source-content-view">
          <div className="source-content-heading"><Quote size={18} /><span>Source text</span></div>
          {paragraphs.map((paragraph, index) => <p key={`${source.id}-${index}`}>{paragraph}</p>)}
        </article>
      </div>
    </Modal>
  )
}
