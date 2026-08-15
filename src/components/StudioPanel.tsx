import { useState } from 'react'
import {
  FilePlus2,
  MessageSquareQuote,
  MoreVertical,
  PanelRightClose,
  PenLine,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react'
import { artifactDefinitions, defaultArtifactConfig } from '../data/artifacts'
import type { AppSettings, Artifact, ArtifactConfig, ArtifactType, Note } from '../types'
import { ArtifactIcon } from './ProductIcon'

interface StudioPanelProps {
  artifacts: Artifact[]
  notes: Note[]
  readOnly?: boolean
  sourceCount: number
  settings: AppSettings
  onGenerate: (type: ArtifactType, config: ArtifactConfig) => void
  onCustomize: (type: ArtifactType) => void
  onOpenArtifact: (artifact: Artifact) => void
  onViewPrompt: (artifact: Artifact) => void
  onDeleteArtifact: (id: string) => void
  onAddNote: () => void
  onOpenNote: (note: Note) => void
  onDeleteNote: (id: string) => void
  onAddSource: () => void
  onCollapse: () => void
}

export function StudioPanel({
  artifacts,
  notes,
  readOnly = false,
  sourceCount,
  settings,
  onGenerate,
  onCustomize,
  onOpenArtifact,
  onViewPrompt,
  onDeleteArtifact,
  onAddNote,
  onOpenNote,
  onDeleteNote,
  onAddSource,
  onCollapse,
}: StudioPanelProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null)

  return (
    <section className="workspace-panel studio-panel" aria-labelledby="studio-heading">
      <header className="panel-header">
        <h2 id="studio-heading">Studio</h2>
        <button
          className="icon-button desktop-only"
          type="button"
          onClick={onCollapse}
          aria-label="Collapse studio panel"
        >
          <PanelRightClose size={19} />
        </button>
      </header>
      <div className="panel-scroll studio-scroll">
        {!readOnly && (
          <div className="studio-tool-grid">
            {artifactDefinitions.map((definition) => (
              <div className={`studio-tool tint-${definition.tint}`} key={definition.type}>
                <button
                  className="studio-tool-main"
                  type="button"
                  onClick={() =>
                    sourceCount > 0
                      ? onGenerate(definition.type, defaultArtifactConfig(definition.type, settings.outputLanguage))
                      : onAddSource()
                  }
                >
                  <ArtifactIcon type={definition.type} size={19} />
                  <strong>{definition.label}</strong>
                </button>
                {definition.editable && (
                  <button
                    className="studio-edit-button"
                    type="button"
                    onClick={() => onCustomize(definition.type)}
                    aria-label={`Customize ${definition.label}`}
                  >
                    <PenLine size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!readOnly && (artifacts.length > 0 || notes.length > 0) && <div className="studio-divider" />}

        {artifacts.length > 0 && (
          <section className="studio-section" aria-labelledby="outputs-title">
            <div className="studio-section-heading">
              <h3 id="outputs-title">Studio outputs</h3>
              <span>{artifacts.length}</span>
            </div>
            <div className="studio-output-list">
              {artifacts
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((artifact) => {
                  const definition = artifactDefinitions.find((item) => item.type === artifact.type)
                  return (
                    <article className="studio-output" key={artifact.id}>
                      <button
                        className="studio-output-main"
                        type="button"
                        onClick={() => artifact.status === 'ready' && onOpenArtifact(artifact)}
                        title={artifact.error}
                      >
                        <span className={`output-icon tint-${definition?.tint ?? 'violet'}`}>
                          {artifact.status === 'generating' ? (
                            <span className="spinner" />
                          ) : artifact.status === 'error' ? (
                            <XCircle size={18} />
                          ) : (
                            <ArtifactIcon type={artifact.type} size={18} />
                          )}
                        </span>
                        <span>
                          <strong>{artifact.title}</strong>
                          <small>
                            {artifact.status === 'generating'
                              ? 'Generating with Groq…'
                              : artifact.status === 'error'
                                ? artifact.error
                                : definition?.shortLabel}
                          </small>
                        </span>
                      </button>
                      {!readOnly && (
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => setMenuFor(menuFor === artifact.id ? null : artifact.id)}
                          aria-label={`More options for ${artifact.title}`}
                        >
                          <MoreVertical size={16} />
                        </button>
                      )}
                      {!readOnly && menuFor === artifact.id && (
                        <div className="context-menu studio-context-menu">
                          <button
                            type="button"
                            onClick={() => {
                              onViewPrompt(artifact)
                              setMenuFor(null)
                            }}
                          >
                            <MessageSquareQuote size={15} /> View custom prompt
                          </button>
                          <button
                            className="danger-menu-item"
                            type="button"
                            onClick={() => {
                              onDeleteArtifact(artifact.id)
                              setMenuFor(null)
                            }}
                          >
                            <Trash2 size={15} /> Delete output
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
            </div>
          </section>
        )}

        <section className="studio-section notes-section" aria-labelledby="notes-title">
          <div className="studio-section-heading">
            <h3 id="notes-title">Notes</h3>
            <span>{notes.length}</span>
          </div>
          {notes.length === 0 ? (
            <div className="studio-empty">
              <FilePlus2 size={28} />
              <strong>{readOnly ? 'No shared notes yet' : 'Studio output will be saved here'}</strong>
              <p>
                {readOnly
                  ? 'The notebook owner has not shared any notes.'
                  : 'Generate a guide, save a chat answer, or write your own note.'}
              </p>
            </div>
          ) : (
            <div className="note-list">
              {notes
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((note) => (
                  <article className="note-row" key={note.id}>
                    <button className="note-open-button" type="button" onClick={() => onOpenNote(note)}>
                      <span>
                        <PenLine size={16} />
                      </span>
                      <span>
                        <strong>{note.title}</strong>
                        <small>
                          {note.body.slice(0, 75)}
                          {note.body.length > 75 ? '…' : ''}
                        </small>
                      </span>
                    </button>
                    {!readOnly && (
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => setMenuFor(menuFor === note.id ? null : note.id)}
                        aria-label={`More options for ${note.title}`}
                      >
                        <MoreVertical size={16} />
                      </button>
                    )}
                    {!readOnly && menuFor === note.id && (
                      <div className="context-menu studio-context-menu">
                        <button
                          className="danger-menu-item"
                          type="button"
                          onClick={() => {
                            onDeleteNote(note.id)
                            setMenuFor(null)
                          }}
                        >
                          <Trash2 size={15} /> Delete note
                        </button>
                      </div>
                    )}
                  </article>
                ))}
            </div>
          )}
        </section>
      </div>
      {!readOnly && (
        <div className="studio-add-note-wrap">
          <button className="dark-button" type="button" onClick={onAddNote}>
            <Plus size={18} /> Add note
          </button>
        </div>
      )}
    </section>
  )
}
