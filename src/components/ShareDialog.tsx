import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Globe2, LoaderCircle, LockKeyhole, MessageSquareText, ShieldCheck } from 'lucide-react'
import { repository } from '../lib/repository'
import type { NotebookShareAccess, NotebookShareDetails } from '../types'
import { Modal } from './Modal'

interface ShareDialogProps {
  open: boolean
  notebookId: string
  notebookTitle: string
  onClose: () => void
}

const shareOptions: Array<{
  access: NotebookShareAccess
  title: string
  description: string
  icon: typeof LockKeyhole
}> = [
  {
    access: 'private',
    title: 'Restricted',
    description: 'Only you can open this notebook.',
    icon: LockKeyhole,
  },
  {
    access: 'full',
    title: 'Full notebook',
    description: 'Visitors can explore sources, chat, notes, and Studio outputs.',
    icon: Globe2,
  },
  {
    access: 'chat',
    title: 'Chat only',
    description: 'Visitors can ask grounded questions without viewing source content or outputs.',
    icon: MessageSquareText,
  },
]

export function ShareDialog({ open, notebookId, notebookTitle, onClose }: ShareDialogProps) {
  const [details, setDetails] = useState<NotebookShareDetails | null>(null)
  const [draftAccess, setDraftAccess] = useState<NotebookShareAccess>('private')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void repository.flushNotebook(notebookId).then(() => repository.getNotebookSharing(notebookId)).then((next) => {
      if (cancelled) return
      setDetails(next)
      setDraftAccess(next.access)
    }).catch((caught) => {
      if (cancelled) return
      setError(caught instanceof Error ? caught.message : 'Sharing settings could not be loaded.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [notebookId, open])

  const publicLink = useMemo(() => {
    if (!details?.token || details.access === 'private') return ''
    return `${window.location.origin}${window.location.pathname}#/shared/${details.token}`
  }, [details])

  const applySharing = async () => {
    setSaving(true)
    setError('')
    setCopied(false)
    try {
      const next = await repository.setNotebookSharing(notebookId, draftAccess)
      setDetails(next)
      setDraftAccess(next.access)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sharing settings could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async () => {
    if (!publicLink) return
    try {
      await navigator.clipboard.writeText(publicLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('The link could not be copied. Select and copy it manually.')
    }
  }

  const changed = details !== null && draftAccess !== details.access
  const applyLabel = draftAccess !== 'private'
    ? 'Apply access'
    : details?.access === 'full' || details?.access === 'chat' ? 'Turn off sharing' : 'Restricted'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share “${notebookTitle}”`}
      description="Choose exactly what anyone with the link can access."
      className="share-dialog"
    >
      {loading ? (
        <div className="share-loading" role="status"><LoaderCircle className="spin" size={22} /> Loading sharing settings…</div>
      ) : (
        <>
          <div className="share-visibility-map" aria-hidden="true">
            <span className={draftAccess === 'full' ? 'active' : ''}>Sources</span>
            <span className={draftAccess === 'full' || draftAccess === 'chat' ? 'active chat' : ''}>Chat</span>
            <span className={draftAccess === 'full' ? 'active' : ''}>Studio</span>
            <i className={draftAccess === 'private' ? 'private' : ''}>{draftAccess === 'private' ? <LockKeyhole size={15} /> : <Globe2 size={15} />}</i>
          </div>

          <div className="share-options" role="radiogroup" aria-label="Public notebook access">
            {shareOptions.map((option) => {
              const Icon = option.icon
              const selected = draftAccess === option.access
              return (
                <button
                  className={selected ? 'selected' : ''}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  key={option.access}
                  onClick={() => setDraftAccess(option.access)}
                >
                  <span className="share-option-icon"><Icon size={18} /></span>
                  <span><strong>{option.title}</strong><small>{option.description}</small></span>
                  <span className="radio-dot" />
                </button>
              )
            })}
          </div>

          {publicLink && details?.access === draftAccess && (
            <div className="share-link-section">
              <div><Globe2 size={16} /><span><strong>Anyone with this link</strong><small>No sign-up required. The owner’s chat history stays private.</small></span></div>
              <div className="share-link-field">
                <input aria-label="Public notebook link" value={publicLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                <button className="secondary-button" type="button" onClick={() => { void copyLink() }}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </div>
          )}

          {draftAccess === 'private' && details !== null && details.access !== 'private' && (
            <div className="share-revoke-warning"><ShieldCheck size={17} /><span><strong>The current link will stop working.</strong><small>Turning sharing on again creates a new link.</small></span></div>
          )}

          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions share-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Close</button>
            <button className="primary-button" type="button" disabled={!details || !changed || saving} onClick={() => { void applySharing() }}>
              {saving && <LoaderCircle className="spin" size={16} />}
              {applyLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
