import { useState } from 'react'
import type { ChatConfig } from '../types'
import { Modal } from './Modal'

interface ChatConfigDialogProps {
  open: boolean
  config: ChatConfig
  onClose: () => void
  onSave: (config: ChatConfig) => void
}

export function ChatConfigDialog({ open, config, onClose, onSave }: ChatConfigDialogProps) {
  const [draft, setDraft] = useState(config)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configure chat"
      description="Shape how answers are structured without changing their source grounding."
    >
      <div className="config-section">
        <h3>Conversation style</h3>
        <div className="option-cards">
          {(
            [
              ['Default', 'Balanced research and brainstorming'],
              ['Learning Guide', 'Step-by-step explanations that teach'],
              ['Custom', 'Follow your own response instructions'],
            ] as const
          ).map(([value, description]) => (
            <button
              className={draft.style === value ? 'selected' : ''}
              type="button"
              key={value}
              onClick={() => setDraft({ ...draft, style: value })}
            >
              <span className="radio-dot" />
              <span>
                <strong>{value}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      {draft.style === 'Custom' && (
        <label className="config-label">
          Custom instructions
          <textarea
            rows={4}
            value={draft.instructions}
            onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            placeholder="For example: Start with a one-sentence answer, then explain trade-offs."
          />
        </label>
      )}

      <div className="config-section">
        <h3>Response length</h3>
        <div className="segmented-control">
          {(['Shorter', 'Default', 'Longer'] as const).map((length) => (
            <button
              className={draft.length === length ? 'active' : ''}
              type="button"
              key={length}
              onClick={() => setDraft({ ...draft, length })}
            >
              {length}
            </button>
          ))}
        </div>
      </div>

      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            onSave(draft)
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}
