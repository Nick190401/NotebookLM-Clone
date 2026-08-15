import { CircleCheck, Download, KeyRound, Laptop, Moon, RotateCcw, Sun, TriangleAlert } from 'lucide-react'
import type { AiStatus, AppData, AppSettings } from '../types'
import { Modal } from './Modal'

interface SettingsDialogProps {
  open: boolean
  data: AppData
  settings: AppSettings
  aiStatus: AiStatus | null
  onClose: () => void
  onChange: (settings: AppSettings) => void
  onReset: () => void
}

export function SettingsDialog({ open, data, settings, aiStatus, onClose, onChange, onReset }: SettingsDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      description="Appearance and output preferences for your Supabase workspace."
    >
      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-options">
          {(
            [
              ['system', 'Device', Laptop],
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              type="button"
              key={value}
              className={settings.theme === value ? 'selected' : ''}
              onClick={() => onChange({ ...settings, theme: value })}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section ai-settings">
        <div className={`ai-settings-status ${aiStatus?.configured ? 'ready' : 'setup'}`}>
          {aiStatus?.configured ? (
            <CircleCheck size={20} />
          ) : aiStatus ? (
            <KeyRound size={20} />
          ) : (
            <TriangleAlert size={20} />
          )}
          <div>
            <h3>
              {aiStatus?.configured ? 'Groq AI connected' : aiStatus ? 'AI setup required' : 'AI function unavailable'}
            </h3>
            <p>
              {aiStatus?.configured
                ? `${aiStatus.primaryModel} · automatic fallback enabled`
                : aiStatus
                  ? 'Add GROQ_API_KEY as a Supabase Edge Function secret, then redeploy the functions.'
                  : 'Check your Supabase configuration and Edge Function deployment.'}
            </p>
          </div>
        </div>
        {!aiStatus?.configured && aiStatus && <code>supabase secrets set GROQ_API_KEY=gsk_…</code>}
      </div>
      <div className="settings-section">
        <label className="config-label">
          Output language
          <select
            value={settings.outputLanguage}
            onChange={(event) =>
              onChange({ ...settings, outputLanguage: event.target.value as AppSettings['outputLanguage'] })
            }
          >
            <option>English</option>
            <option>Deutsch</option>
          </select>
        </label>
        <p>New Studio outputs use this language by default.</p>
      </div>
      <div className="settings-section data-settings">
        <div>
          <h3>Supabase notebook data</h3>
          <p>
            Notebooks are protected by Row Level Security. Relevant source excerpts reach Groq only through
            authenticated Edge Functions when you use AI features.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = 'notebooklm-clone-export.json'
            anchor.click()
            URL.revokeObjectURL(url)
          }}
        >
          <Download size={16} /> Export
        </button>
      </div>
      <div className="settings-danger">
        <div>
          <strong>Clear workspace</strong>
          <small>Delete every notebook in your Supabase workspace and restore default settings.</small>
        </div>
        <button
          type="button"
          onClick={() => {
            onReset()
            onClose()
          }}
        >
          <RotateCcw size={16} /> Clear all
        </button>
      </div>
    </Modal>
  )
}
