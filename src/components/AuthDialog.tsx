import { useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, LockKeyhole, LogIn, LogOut, Mail, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { AccountIdentity } from '../lib/repository'
import { Modal } from './Modal'

type GuestMode = 'upgrade' | 'sign-in' | 'reset'
type AccountPrompt = 'confirmed' | 'recovery' | null

interface AuthDialogProps {
  open: boolean
  account: AccountIdentity
  notebookCount: number
  prompt: AccountPrompt
  onClose: () => void
  onBeginUpgrade: (email: string) => Promise<void>
  onSignIn: (email: string, password: string) => Promise<void>
  onSetPassword: (password: string) => Promise<void>
  onSendPasswordReset: (email: string) => Promise<void>
  onSignOut: () => Promise<void>
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'The account request could not be completed.'
}

export function AuthDialog({
  open, account, notebookCount, prompt, onClose, onBeginUpgrade, onSignIn, onSetPassword, onSendPasswordReset, onSignOut,
}: AuthDialogProps) {
  const [guestMode, setGuestMode] = useState<GuestMode>(() => prompt === 'recovery' ? 'sign-in' : 'upgrade')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [switchConfirmed, setSwitchConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const resetFeedback = () => {
    setError('')
    setSuccess('')
  }

  const close = () => {
    resetFeedback()
    setGuestMode('upgrade')
    setEmail('')
    setPassword('')
    setPasswordConfirmation('')
    setSwitchConfirmed(false)
    onClose()
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    resetFeedback()
    try {
      await action()
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  const submitUpgrade = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address) return setError('Enter the email address you want to use for this workspace.')
    void run(async () => {
      await onBeginUpgrade(address)
      setSuccess(`Confirmation sent to ${address}. Open the link in this browser to keep this workspace attached.`)
    })
  }

  const submitSignIn = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address || !password) return setError('Enter your email and password.')
    if (notebookCount > 0 && !switchConfirmed) return setError('Confirm that you understand the guest notebooks will not move to the other account.')
    void run(async () => {
      await onSignIn(address, password)
      close()
    })
  }

  const submitReset = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address) return setError('Enter the email address of your account.')
    void run(async () => {
      await onSendPasswordReset(address)
      setSuccess(`Password reset instructions sent to ${address}.`)
    })
  }

  const submitPassword = (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters for your password.')
    if (password !== passwordConfirmation) return setError('The passwords do not match.')
    void run(async () => {
      await onSetPassword(password)
      setPassword('')
      setPasswordConfirmation('')
      setSuccess('Your password has been updated.')
    })
  }

  if (!account.isAnonymous) {
    return (
      <Modal open={open} onClose={close} title="Your account" description="Manage the permanent account protecting this workspace." className="auth-modal">
        <div className="account-identity-card">
          <span><ShieldCheck size={22} /></span>
          <div><strong>{account.email || 'Permanent account'}</strong><small>Notebooks sync to this Supabase identity</small></div>
          <em>Protected</em>
        </div>
        {prompt && (
          <div className="auth-callout success">
            <CheckCircle2 size={19} />
            <div><strong>{prompt === 'confirmed' ? 'Email confirmed' : 'Recovery link accepted'}</strong><span>{prompt === 'confirmed' ? 'Choose a password so you can sign in again on any device.' : 'Choose a new password to finish recovering your account.'}</span></div>
          </div>
        )}
        <form className="auth-form" onSubmit={submitPassword}>
          <div className="auth-section-heading"><KeyRound size={18} /><div><h3>Account password</h3><p>Set or replace the password used for email sign-in.</p></div></div>
          <input className="visually-hidden" type="email" value={account.email ?? ''} autoComplete="username" tabIndex={-1} readOnly aria-hidden="true" />
          <label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
          <label>Confirm password<input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
          <button className="primary-button" type="submit" disabled={busy}><LockKeyhole size={17} />{busy ? 'Updating…' : 'Update password'}</button>
        </form>
        {error && <div className="auth-feedback error" role="alert"><TriangleAlert size={17} /><span>{error}</span></div>}
        {success && <div className="auth-feedback success" role="status"><CheckCircle2 size={17} /><span>{success}</span></div>}
        <div className="account-signout-row"><div><strong>Sign out on this device</strong><span>A fresh guest workspace will open afterward.</span></div><button className="secondary-button" type="button" disabled={busy} onClick={() => { void run(async () => { await onSignOut(); close() }) }}><LogOut size={16} /> Sign out</button></div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={guestMode === 'reset' ? 'Reset password' : guestMode === 'upgrade' ? 'Save this workspace' : 'Sign in'}
      description={guestMode === 'reset' ? 'We email you a link to choose a new password. No password needed on this step.' : 'Connect your NotebookLM workspace to a permanent Supabase account.'}
      className="auth-modal"
    >
      {prompt && (
        <div className="auth-callout warning" role="alert">
          <TriangleAlert size={19} />
          <div><strong>Account link could not be applied</strong><span>This link may be expired or already used. Request a new confirmation or password reset email.</span></div>
        </div>
      )}
      {guestMode !== 'reset' && (
        <div className="auth-mode-switch" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={guestMode === 'upgrade'} className={guestMode === 'upgrade' ? 'active' : ''} onClick={() => { setGuestMode('upgrade'); resetFeedback() }}>Create account</button>
          <button type="button" role="tab" aria-selected={guestMode === 'sign-in'} className={guestMode === 'sign-in' ? 'active' : ''} onClick={() => { setGuestMode('sign-in'); resetFeedback() }}>Sign in</button>
        </div>
      )}

      {guestMode === 'reset' ? (
        <>
          <div className="auth-back-row">
            <button className="text-button" type="button" onClick={() => { setGuestMode('sign-in'); resetFeedback() }}><ArrowLeft size={16} /> Back to sign in</button>
          </div>
          <div className="auth-copy"><h3>Send a recovery link</h3><p>Enter the email address of your account. The link in that email lets you set a new password.</p></div>
          <form className="auth-form" onSubmit={submitReset}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" autoFocus required /></label>
            <button className="primary-button" type="submit" disabled={busy}><Mail size={17} />{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
        </>
      ) : guestMode === 'upgrade' ? (
        <>
          <div className="workspace-continuity">
            <span className="continuity-count" aria-label={`${notebookCount} guest notebook${notebookCount === 1 ? '' : 's'}`}><strong>{notebookCount}</strong><small>guest notebook{notebookCount === 1 ? '' : 's'}</small></span>
            <span className="continuity-line" aria-hidden="true"><i /><ShieldCheck size={20} /><i /></span>
            <span className="continuity-account"><Mail size={20} /><small>your account</small></span>
          </div>
          <div className="auth-copy"><h3>Keep the same workspace</h3><p>We attach a verified email to this guest identity, so your notebooks stay exactly where they are.</p></div>
          <form className="auth-form compact" onSubmit={submitUpgrade}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label>
            <button className="primary-button" type="submit" disabled={busy}><Mail size={17} />{busy ? 'Sending…' : 'Send confirmation email'}</button>
          </form>
        </>
      ) : (
        <>
          {notebookCount > 0 && <div className="auth-callout warning"><TriangleAlert size={19} /><div><strong>Guest notebooks stay behind</strong><span>Signing in switches this browser to another workspace. These {notebookCount} notebook{notebookCount === 1 ? '' : 's'} will not be moved.</span></div></div>}
          <form className="auth-form" onSubmit={submitSignIn}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            {notebookCount > 0 && <label className="auth-confirm"><input type="checkbox" checked={switchConfirmed} onChange={(event) => setSwitchConfirmed(event.target.checked)} /><span>I understand this switches away from the current guest notebooks.</span></label>}
            <div className="auth-submit-row"><button className="text-button" type="button" disabled={busy} onClick={() => { setGuestMode('reset'); resetFeedback() }}>Forgot password?</button><button className="primary-button" type="submit" disabled={busy}><LogIn size={17} />{busy ? 'Signing in…' : 'Sign in'}</button></div>
          </form>
        </>
      )}
      {error && <div className="auth-feedback error" role="alert"><TriangleAlert size={17} /><span>{error}</span></div>}
      {success && <div className="auth-feedback success" role="status"><CheckCircle2 size={17} /><span>{success}</span></div>}
      <div className="guest-note"><ShieldCheck size={16} /><span>Guest access remains available. Create an account only when you want this workspace on another device.</span></div>
    </Modal>
  )
}
