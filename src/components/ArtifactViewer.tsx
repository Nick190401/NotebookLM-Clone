import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Expand,
  FileText,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'
import { artifactDefinitions } from '../data/artifacts'
import { createSpeech } from '../lib/api'
import { artifactExportLabel, downloadArtifact } from '../lib/artifact-export'
import type { Artifact, ArtifactContent, Source } from '../types'
import { ArtifactIcon } from './ProductIcon'
import { Modal } from './Modal'

interface ArtifactViewerProps {
  artifact: Artifact | null
  sources: Source[]
  onClose: () => void
}

function selectedSources(sources: Source[]) {
  const selected = sources.filter((source) => source.selected)
  return selected.length > 0 ? selected : sources
}

function sourceName(sources: Source[], id: string) {
  return sources.find((source) => source.id === id)?.title || 'Source'
}

function sourceLabels(ids: string[], sources: Source[]) {
  if (!ids.length) return null
  return <small className="artifact-source-labels">{ids.map((id) => sourceName(sources, id)).join(' · ')}</small>
}

function ViewerToolbar({ artifact, sources }: { artifact: Artifact; sources: Source[] }) {
  return (
    <div className="artifact-viewer-toolbar">
      <span>
        {artifact.config.format || artifact.type} · {artifact.config.language}
        {artifact.model ? ` · ${artifact.model}` : ''}
      </span>
      <div>
        <button className="secondary-button compact" type="button" onClick={() => downloadArtifact(artifact, sources)}>
          <Download size={16} /> {artifactExportLabel(artifact)}
        </button>
      </div>
    </div>
  )
}

function AudioViewer({
  artifact,
  content,
  sources,
}: {
  artifact: Artifact
  content: ArtifactContent
  sources: Source[]
}) {
  const [audioUrl, setAudioUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    },
    [audioUrl],
  )

  const buildAudio = async () => {
    setBusy(true)
    setError('')
    try {
      const script = (
        content.narration || content.transcript.map((line) => `${line.speaker}: ${line.text}`).join('\n')
      ).slice(0, 4_000)
      const blob = await createSpeech(script)
      setAudioUrl(URL.createObjectURL(blob))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Audio generation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="audio-viewer">
      <div className="audio-artwork">
        <div className="sound-orbit orbit-a" />
        <div className="sound-orbit orbit-b" />
        <ArtifactIcon type="audio" size={45} />
        <span>Deep dive</span>
      </div>
      <div className="audio-details">
        <p className="artifact-kicker">
          <Sparkles size={15} /> AI host conversation
        </p>
        <h3>{artifact.title}</h3>
        <p>{content.summary}</p>
        {audioUrl ? (
          <audio className="generated-audio" src={audioUrl} controls autoPlay />
        ) : (
          <button
            className="primary-button audio-generate-button"
            type="button"
            disabled={busy}
            onClick={() => void buildAudio()}
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <Volume2 size={18} />}
            {busy ? 'Creating speech…' : 'Generate playable audio'}
          </button>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="audio-transcript">
        <h4>Transcript</h4>
        {content.transcript.map((line, index) => (
          <p key={`${line.speaker}-${index}`}>
            <strong>{line.speaker}</strong> {line.text}
            {sourceLabels(line.sourceIds, sources)}
          </p>
        ))}
      </div>
    </div>
  )
}

function VideoViewer({ content, sources }: { content: ArtifactContent; sources: Source[] }) {
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const slides = content.slides
  useEffect(() => {
    if (!playing || slides.length < 2) return
    const timer = window.setInterval(() => setCurrent((value) => (value + 1) % slides.length), 4_000)
    return () => window.clearInterval(timer)
  }, [playing, slides.length])
  const slide = slides[current]
  if (!slide) return <EmptyArtifact />
  return (
    <div className="video-viewer">
      <div className="video-stage">
        <div className="video-grid-lines" />
        <p>Chapter {current + 1}</p>
        <h3>{slide.title}</h3>
        <span>{slide.body}</span>
        {slide.metric && <strong>{slide.metric}</strong>}
        {sourceLabels(slide.sourceIds, sources)}
        <div className="video-stage-mark">
          <ArtifactIcon type="video" size={24} />
        </div>
      </div>
      <div className="video-timeline">
        <button type="button" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div>
          {slides.map((_, index) => (
            <button
              type="button"
              aria-label={`Go to chapter ${index + 1}`}
              className={index === current ? 'active' : ''}
              onClick={() => setCurrent(index)}
              key={index}
            />
          ))}
        </div>
        <span>
          {current + 1} / {slides.length}
        </span>
        <Expand size={17} />
      </div>
    </div>
  )
}

/** Radial coordinates in percent of the canvas, so any branch count lays out evenly. */
function branchPosition(index: number, total: number) {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2
  return { x: 50 + 37 * Math.cos(angle), y: 50 + 33 * Math.sin(angle) }
}

function MindMapViewer({ content, sources }: { content: ArtifactContent; sources: Source[] }) {
  const root = content.nodes.find((node) => !node.parentId) ?? content.nodes[0]
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  if (!root) return <EmptyArtifact />

  const branches = content.nodes.filter((node) => node.parentId === root.id)
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="mindmap-viewer">
      <div className={`mindmap-canvas ${branches.length > 6 ? 'dense' : ''}`}>
        <svg className="mindmap-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {branches.map((branch, index) => {
            const { x, y } = branchPosition(index, branches.length)
            return <line key={branch.id} x1="50" y1="50" x2={x} y2={y} />
          })}
        </svg>
        <div className="mindmap-root">
          <Sparkles size={17} />
          <strong>{root.label}</strong>
        </div>
        {branches.map((branch, index) => {
          const { x, y } = branchPosition(index, branches.length)
          const children = content.nodes.filter((node) => node.parentId === branch.id)
          return (
            <div className="mindmap-branch" key={branch.id} style={{ left: `${x}%`, top: `${y}%` }}>
              <button
                type="button"
                className="branch-parent"
                aria-expanded={!collapsed.has(branch.id)}
                onClick={() => toggle(branch.id)}
              >
                {collapsed.has(branch.id) ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                <span>{branch.label}</span>
              </button>
              {!collapsed.has(branch.id) && children.length > 0 && (
                <div className="branch-children">
                  {children.map((node) => (
                    <span title={sourceName(sources, node.sourceId)} key={node.id}>
                      {node.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="viewer-hint">
        {branches.length} branch{branches.length === 1 ? '' : 'es'} · select one to collapse or expand it.
      </p>
    </div>
  )
}

function ReportViewer({
  artifact,
  content,
  sources,
}: {
  artifact: Artifact
  content: ArtifactContent
  sources: Source[]
}) {
  return (
    <article className="report-viewer">
      <div className="report-title-block">
        <p>Source-grounded briefing</p>
        <h2>{artifact.title}</h2>
        <span>{content.summary}</span>
      </div>
      {content.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`}>
          <h3>{section.heading}</h3>
          <p>{section.body}</p>
          {sourceLabels(section.sourceIds, sources)}
        </section>
      ))}
    </article>
  )
}

function FlashcardViewer({ content, sources }: { content: ArtifactContent; sources: Source[] }) {
  const cards = content.cards
  const [current, setCurrent] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [mastered, setMastered] = useState<Set<number>>(new Set())
  const card = cards[current]
  if (!card) return <EmptyArtifact />
  const move = (next: number) => {
    setCurrent((next + cards.length) % cards.length)
    setFlipped(false)
  }
  return (
    <div className="study-viewer">
      <div className="study-progress">
        <span>
          {current + 1} of {cards.length}
        </span>
        <div>
          <i style={{ width: `${((current + 1) / cards.length) * 100}%` }} />
        </div>
        <span>{mastered.size} mastered</span>
      </div>
      <button className={`flashcard ${flipped ? 'flipped' : ''}`} type="button" onClick={() => setFlipped(!flipped)}>
        <span className="flashcard-label">{flipped ? 'Answer' : 'Question'}</span>
        <strong>{flipped ? card.back : card.front}</strong>
        <small>{flipped ? sourceName(sources, card.sourceId) : 'Click to flip'}</small>
      </button>
      <div className="study-controls">
        <button type="button" onClick={() => move(current - 1)}>
          <ArrowLeft size={18} />
        </button>
        <button
          className="missed-button"
          type="button"
          onClick={() => {
            setMastered((value) => {
              const next = new Set(value)
              next.delete(current)
              return next
            })
            move(current + 1)
          }}
        >
          <X size={17} /> Missed it
        </button>
        <button
          className="mastered-button"
          type="button"
          onClick={() => {
            setMastered((value) => new Set(value).add(current))
            move(current + 1)
          }}
        >
          <Check size={17} /> Got it
        </button>
        <button type="button" onClick={() => move(current + 1)}>
          <ArrowRight size={18} />
        </button>
      </div>
      <div className="study-utility">
        <button type="button" onClick={() => move(Math.floor(Math.random() * cards.length))}>
          <Shuffle size={16} /> Shuffle
        </button>
        <button
          type="button"
          onClick={() => {
            setCurrent(0)
            setMastered(new Set())
            setFlipped(false)
          }}
        >
          <RotateCcw size={16} /> Restart
        </button>
      </div>
    </div>
  )
}

function QuizViewer({ content, sources }: { content: ArtifactContent; sources: Source[] }) {
  const questions = content.questions
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const question = questions[current]
  const selected = answers[current]
  if (!question) return <EmptyArtifact />
  return (
    <div className="quiz-viewer">
      <div className="quiz-heading">
        <span>
          Question {current + 1} of {questions.length}
        </span>
        <strong>
          {
            Object.entries(answers).filter(([index, answer]) => questions[Number(index)]?.correctIndex === answer)
              .length
          }{' '}
          correct
        </strong>
      </div>
      <h3>{question.question}</h3>
      <div className="quiz-options">
        {question.options.map((option, index) => (
          <button
            type="button"
            className={selected === index ? (index === question.correctIndex ? 'correct' : 'incorrect') : ''}
            onClick={() => setAnswers({ ...answers, [current]: index })}
            key={`${option}-${index}`}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            {option}
            {selected === index && (index === question.correctIndex ? <Check size={18} /> : <X size={18} />)}
          </button>
        ))}
      </div>
      {selected !== undefined && (
        <div className={`quiz-explanation ${selected === question.correctIndex ? 'success' : ''}`}>
          <strong>{selected === question.correctIndex ? 'Correct' : 'Not quite'}</strong>
          <p>{question.explanation}</p>
          <small>{sourceName(sources, question.sourceId)}</small>
        </div>
      )}
      <div className="quiz-nav">
        <button
          className="secondary-button"
          type="button"
          disabled={current === 0}
          onClick={() => setCurrent(current - 1)}
        >
          <ArrowLeft size={16} /> Previous
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={selected === undefined || current >= questions.length - 1}
          onClick={() => setCurrent(current + 1)}
        >
          Next <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}

function InfographicViewer({ content, sources }: { content: ArtifactContent; sources: Source[] }) {
  return (
    <div className="infographic-viewer">
      <div className="infographic-title">
        <span>THE EVIDENCE MAP</span>
        <h2>{content.summary}</h2>
        <p>A source-grounded visual synthesis</p>
      </div>
      <div className="infographic-flow">
        <span>Evidence</span>
        <i />
        <span>Patterns</span>
        <i />
        <span>Implications</span>
        <i />
        <span>Outcome</span>
      </div>
      <div className="infographic-metrics">
        {content.metrics.map((metric) => (
          <div key={`${metric.value}-${metric.label}`} title={sourceName(sources, metric.sourceId)}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
            <small>{metric.context}</small>
          </div>
        ))}
      </div>
      {content.sections[0] && (
        <div className="infographic-footer">
          <Sparkles size={18} />
          <p>{content.sections[0].body}</p>
        </div>
      )}
    </div>
  )
}

function SlidesViewer({ content }: { content: ArtifactContent }) {
  const slides = content.slides
  const [current, setCurrent] = useState(0)
  if (!slides.length) return <EmptyArtifact />
  return (
    <div className="slides-viewer">
      <aside>
        {slides.map((slide, index) => (
          <button
            type="button"
            className={index === current ? 'active' : ''}
            onClick={() => setCurrent(index)}
            key={`${slide.title}-${index}`}
          >
            <span>{index + 1}</span>
            <i>
              <strong>{slide.title}</strong>
              <small>{slide.body.slice(0, 42)}…</small>
            </i>
          </button>
        ))}
      </aside>
      <div className="slide-stage">
        <div className="slide-number">{String(current + 1).padStart(2, '0')}</div>
        <p>NOTEBOOKLM · RESEARCH DECK</p>
        <h2>{slides[current].title}</h2>
        <span>{slides[current].body}</span>
        {slides[current].metric && <strong>{slides[current].metric}</strong>}
        <div className="slide-accent" />
      </div>
      <div className="slide-controls">
        <button type="button" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
          <ArrowLeft size={18} />
        </button>
        <span>
          {current + 1} / {slides.length}
        </span>
        <button type="button" disabled={current === slides.length - 1} onClick={() => setCurrent(current + 1)}>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

function DataTableViewer({ content, sources }: { content: ArtifactContent; sources: Source[] }) {
  if (!content.columns.length) return <EmptyArtifact />
  return (
    <div className="data-table-viewer">
      <div className="table-summary">
        <span>
          <FileText size={18} />
        </span>
        <div>
          <strong>{content.summary}</strong>
          <small>Generated directly from the selected source evidence.</small>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {content.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, index) => (
              <tr key={index} title={row.sourceIds.map((id) => sourceName(sources, id)).join(' · ')}>
                {content.columns.map((_, cellIndex) => (
                  <td key={cellIndex}>{row.cells[cellIndex] || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyArtifact() {
  return (
    <div className="artifact-empty-state">
      <Sparkles size={28} />
      <h3>Output unavailable</h3>
      <p>The generated response is incomplete and cannot be displayed. Delete this output and generate it again.</p>
    </div>
  )
}

export function ArtifactViewer({ artifact, sources, onClose }: ArtifactViewerProps) {
  const definition = useMemo(() => artifactDefinitions.find((item) => item.type === artifact?.type), [artifact?.type])
  if (!artifact) return null
  const content = artifact.content
  let viewer = <EmptyArtifact />
  if (content) {
    switch (artifact.type) {
      case 'audio':
        viewer = <AudioViewer artifact={artifact} content={content} sources={sources} />
        break
      case 'video':
        viewer = <VideoViewer content={content} sources={sources} />
        break
      case 'mindmap':
        viewer = <MindMapViewer content={content} sources={sources} />
        break
      case 'report':
        viewer = <ReportViewer artifact={artifact} content={content} sources={sources} />
        break
      case 'flashcards':
        viewer = <FlashcardViewer content={content} sources={sources} />
        break
      case 'quiz':
        viewer = <QuizViewer content={content} sources={sources} />
        break
      case 'infographic':
        viewer = <InfographicViewer content={content} sources={sources} />
        break
      case 'slides':
        viewer = <SlidesViewer content={content} />
        break
      case 'datatable':
        viewer = <DataTableViewer content={content} sources={sources} />
        break
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={artifact.title}
      description={`${definition?.label ?? 'Studio output'} · generated from ${selectedSources(sources).length} source${selectedSources(sources).length === 1 ? '' : 's'}`}
      wide
      className={`artifact-viewer-modal viewer-${artifact.type}`}
    >
      <ViewerToolbar artifact={artifact} sources={sources} />
      <div className="artifact-viewer-content">{viewer}</div>
    </Modal>
  )
}
