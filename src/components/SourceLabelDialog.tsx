import { useState } from 'react'
import { FolderInput, Tag, Trash2 } from 'lucide-react'
import { normalizeSourceLabel } from '../lib/source'
import { Modal } from './Modal'

interface SourceLabelDialogProps {
  open: boolean
  mode: 'source' | 'rename'
  subject: string
  currentLabel: string
  labels: string[]
  onClose: () => void
  onSave: (label: string) => void
  onRemove: () => void
}

export function SourceLabelDialog({
  open,
  mode,
  subject,
  currentLabel,
  labels,
  onClose,
  onSave,
  onRemove,
}: SourceLabelDialogProps) {
  const [draft, setDraft] = useState(currentLabel)
  const normalized = normalizeSourceLabel(draft)
  const options = labels.filter((label) => label !== currentLabel)

  const submit = () => {
    if (!normalized) return
    onSave(normalized)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'rename' ? `Rename “${subject}”` : `Organize “${subject}”`}
      description={mode === 'rename'
        ? 'Every source in this group will move to the renamed label.'
        : 'Choose an existing label or type a new one.'}
      className="source-label-dialog"
    >
      <form className="source-label-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label className="field-label" htmlFor="source-label-name">Label name</label>
        <div className="source-label-input">
          <Tag size={17} />
          <input
            id="source-label-name"
            value={draft}
            maxLength={80}
            autoFocus
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. Market research"
          />
        </div>

        {options.length > 0 && <div className="source-label-suggestions">
          <span>Existing labels</span>
          <div>
            {options.map((label) => <button type="button" key={label} onClick={() => setDraft(label)}>{label}</button>)}
          </div>
        </div>}

        <div className="modal-actions source-label-actions">
          {currentLabel && <button className="text-button source-label-remove" type="button" onClick={onRemove}>
            {mode === 'rename' ? <Trash2 size={16} /> : <FolderInput size={16} />}
            {mode === 'rename' ? 'Delete label' : 'Remove label'}
          </button>}
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={!normalized || normalized === currentLabel}>
            {mode === 'rename' ? 'Rename' : 'Apply label'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
