import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Check, ExternalLink, LocateFixed, Quote, Sparkles } from 'lucide-react'
import { locateCitation, type CitationLocation } from '../lib/citation'
import type { Citation, Source } from '../types'
import { Modal } from './Modal'
import { SourceIcon } from './ProductIcon'

interface SourceDetailDialogProps {
  source: Source | null
  citation?: Citation
  onClose: () => void
  onToggle: (id: string) => void
}

interface SourceParagraph {
  text: string
  start: number
  end: number
}

function sourceParagraphs(content: string): SourceParagraph[] {
  return Array.from(content.matchAll(/[^\r\n]+/g), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function highlightedParagraph(paragraph: SourceParagraph, location: CitationLocation): ReactNode {
  const highlightStart = Math.max(location.start, paragraph.start)
  const highlightEnd = Math.min(location.end, paragraph.end)
  if (highlightStart >= highlightEnd) return paragraph.text

  const localStart = highlightStart - paragraph.start
  const localEnd = highlightEnd - paragraph.start
  return <>{paragraph.text.slice(0, localStart)}<mark className="citation-highlight">{paragraph.text.slice(localStart, localEnd)}</mark>{paragraph.text.slice(localEnd)}</>
}

export function SourceDetailDialog({ source, citation, onClose, onToggle }: SourceDetailDialogProps) {
  const contentRef = useRef<HTMLElement>(null)
  const location = useMemo(() => source && citation ? locateCitation(source.content, citation.excerpt) : null, [citation, source])
  const paragraphs = useMemo(() => source ? sourceParagraphs(source.content) : [], [source])

  useEffect(() => {
    if (!location) return
    contentRef.current?.querySelector<HTMLElement>('.citation-highlight')?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [location])

  if (!source) return null

  return (
    <Modal open title={citation ? 'Citation evidence' : 'Source guide'} description={source.title} onClose={onClose} wide className="source-detail-modal">
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
          {citation && (
            <div className="guide-card citation-evidence-card">
              <span><LocateFixed size={17} /> Citation {citation.label}</span>
              <blockquote>{citation.excerpt}</blockquote>
              <small>{location ? 'Highlighted in the source text' : 'Quoted passage could not be matched verbatim'}</small>
            </div>
          )}
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
        <article ref={contentRef} className="source-content-view" aria-label="Source text">
          <div className="source-content-heading"><Quote size={18} /><span>Source text</span>{citation && <small className={location ? 'located' : 'unmatched'}>{location ? `Citation ${citation.label} highlighted` : 'Citation shown at left'}</small>}</div>
          {paragraphs.map((paragraph, index) => <p key={`${source.id}-${paragraph.start}-${index}`}>{location ? highlightedParagraph(paragraph, location) : paragraph.text}</p>)}
        </article>
      </div>
    </Modal>
  )
}
