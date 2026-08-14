import { useState } from 'react'
import { Check, Copy, MessageSquareQuote, ShieldCheck } from 'lucide-react'
import { artifactDefinitions } from '../data/artifacts'
import { artifactGenerationPrompt } from '../lib/artifact-export'
import type { Artifact } from '../types'
import { ArtifactIcon } from './ProductIcon'
import { Modal } from './Modal'

interface ArtifactPromptDialogProps {
  artifact: Artifact | null
  onClose: () => void
}

export function ArtifactPromptDialog({ artifact, onClose }: ArtifactPromptDialogProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  if (!artifact) return null
  const definition = artifactDefinitions.find((item) => item.type === artifact.type)
  const prompt = artifactGenerationPrompt(artifact)

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyError('')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyError('The prompt could not be copied. Select the text manually.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="View custom prompt"
      description={`Generation instructions for “${artifact.title}”`}
      className="artifact-prompt-dialog"
    >
      <div className="artifact-prompt-identity">
        <span className={`tint-${definition?.tint ?? 'violet'}`}><ArtifactIcon type={artifact.type} size={20} /></span>
        <div><strong>{definition?.label ?? artifact.type}</strong><small>{artifact.config.format || definition?.defaultFormat} · {artifact.config.language}{artifact.model ? ` · ${artifact.model}` : ''}</small></div>
      </div>

      <div className="artifact-prompt-block">
        <div><MessageSquareQuote size={17} /><strong>Prompt used</strong></div>
        <pre>{prompt}</pre>
        <button className="secondary-button compact" type="button" onClick={() => { void copyPrompt() }}>
          {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      {copyError && <div className="form-error" role="alert">{copyError}</div>}

      <div className="artifact-prompt-note">
        <ShieldCheck size={17} />
        <span><strong>Source-grounded generation</strong><small>Selected source evidence is sent separately and treated as data, never as instructions.</small></span>
      </div>
      <div className="modal-actions artifact-prompt-actions">
        <button className="primary-button" type="button" onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}
