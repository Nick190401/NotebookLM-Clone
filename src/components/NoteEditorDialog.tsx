import { useState } from 'react'
import { FileInput, LockKeyhole, Save } from 'lucide-react'
import type { Note } from '../types'
import { Modal } from './Modal'

interface NoteEditorDialogProps {
  open: boolean
  note: Note | null
  readOnly?: boolean
  onClose: () => void
  onSave: (title: string, body: string) => void
  onConvert: (note: Note) => void
}

export function NoteEditorDialog({ open, note, readOnly = false, onClose, onSave, onConvert }: NoteEditorDialogProps) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const locked = readOnly || Boolean(note?.locked)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={note ? 'Note' : 'Add note'}
      description={
        readOnly
          ? 'This shared note is read only.'
          : note?.locked
            ? 'Saved chat responses preserve their original format.'
            : 'Capture an idea or connect insights from your sources.'
      }
      wide
      className="note-editor-modal"
    >
      {locked && (
        <div className="locked-note-banner">
          <LockKeyhole size={16} /> {readOnly ? 'Shared note' : 'Saved response'} · read only
        </div>
      )}
      <div className="note-editor-fields">
        <input
          className="note-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Note title"
          disabled={locked}
          autoFocus={!locked}
        />
        <textarea
          className="note-body-input"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Start writing…"
          disabled={locked}
          rows={15}
        />
      </div>
      <div className="modal-actions note-actions">
        {note && !locked && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              onConvert(note)
              onClose()
            }}
          >
            <FileInput size={16} /> Convert to source
          </button>
        )}
        <span />
        <button className="secondary-button" type="button" onClick={onClose}>
          {locked ? 'Close' : 'Cancel'}
        </button>
        {!locked && (
          <button
            className="primary-button"
            type="button"
            disabled={!body.trim()}
            onClick={() => {
              onSave(title.trim() || 'Untitled note', body.trim())
              onClose()
            }}
          >
            <Save size={16} /> Save note
          </button>
        )}
      </div>
    </Modal>
  )
}
