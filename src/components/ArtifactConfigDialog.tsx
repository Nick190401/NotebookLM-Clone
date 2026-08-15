import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { artifactDefinitions, defaultArtifactConfig } from '../data/artifacts'
import type { AppSettings, ArtifactConfig, ArtifactType } from '../types'
import { ArtifactIcon } from './ProductIcon'
import { Modal } from './Modal'

interface ArtifactConfigDialogProps {
  type: ArtifactType | null
  settings: AppSettings
  onClose: () => void
  onGenerate: (type: ArtifactType, config: ArtifactConfig) => void
}

const formats: Partial<Record<ArtifactType, string[]>> = {
  audio: ['Deep Dive', 'The Brief', 'The Critique', 'The Debate'],
  video: ['Explainer', 'Brief', 'Cinematic'],
  report: ['Briefing document', 'Study guide', 'FAQ', 'Timeline'],
  infographic: ['Portrait', 'Landscape', 'Editorial'],
  slides: ['Detailed deck', 'Presenter slides'],
  datatable: ['Comparison table', 'Evidence matrix'],
}

export function ArtifactConfigDialog({ type, settings, onClose, onGenerate }: ArtifactConfigDialogProps) {
  const [draft, setDraft] = useState(() =>
    type
      ? defaultArtifactConfig(type, settings.outputLanguage)
      : defaultArtifactConfig('report', settings.outputLanguage),
  )
  const definition = artifactDefinitions.find((item) => item.type === type)

  if (!type || !definition) return null
  const formatOptions = formats[type] ?? [definition.defaultFormat]
  const isStudyAid = type === 'flashcards' || type === 'quiz'

  return (
    <Modal
      open
      onClose={onClose}
      title={`Customize ${definition.shortLabel}`}
      description={definition.description}
      className="artifact-config-modal"
    >
      <div className={`artifact-config-identity tint-${definition.tint}`}>
        <span>
          <ArtifactIcon type={type} size={23} />
        </span>
        <div>
          <strong>{definition.label}</strong>
          <small>Uses {type === 'audio' ? 'all selected sources' : 'your selected sources'}</small>
        </div>
      </div>

      {!isStudyAid && type !== 'mindmap' && (
        <div className="config-section">
          <h3>Format</h3>
          <div className="format-options">
            {formatOptions.map((format) => (
              <button
                type="button"
                key={format}
                className={draft.format === format ? 'selected' : ''}
                onClick={() => setDraft({ ...draft, format })}
              >
                <span className="radio-dot" />
                {format}
              </button>
            ))}
          </div>
        </div>
      )}

      {isStudyAid && (
        <>
          <div className="config-section">
            <h3>Difficulty</h3>
            <div className="segmented-control">
              {(['Easy', 'Medium', 'Hard'] as const).map((difficulty) => (
                <button
                  type="button"
                  key={difficulty}
                  className={draft.difficulty === difficulty ? 'active' : ''}
                  onClick={() => setDraft({ ...draft, difficulty })}
                >
                  {difficulty}
                </button>
              ))}
            </div>
          </div>
          <div className="config-section">
            <h3>Amount</h3>
            <div className="segmented-control">
              {(['Fewer', 'Standard', 'More'] as const).map((amount) => (
                <button
                  type="button"
                  key={amount}
                  className={draft.amount === amount ? 'active' : ''}
                  onClick={() => setDraft({ ...draft, amount })}
                >
                  {amount}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <label className="config-label">
        Output language
        <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })}>
          <option>English</option>
          <option>Deutsch</option>
          <option>Español</option>
          <option>Français</option>
          <option>日本語</option>
        </select>
      </label>

      <label className="config-label">
        {type === 'audio' || type === 'video'
          ? 'What should the AI hosts focus on?'
          : `What should this ${definition.shortLabel.toLowerCase()} focus on?`}{' '}
        <span>optional</span>
        <textarea
          rows={4}
          value={draft.focus}
          onChange={(event) => setDraft({ ...draft, focus: event.target.value })}
          placeholder="Describe a topic, audience, perspective, or level of expertise…"
        />
      </label>

      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            onGenerate(type, draft)
            onClose()
          }}
        >
          <Sparkles size={17} /> Generate
        </button>
      </div>
    </Modal>
  )
}
