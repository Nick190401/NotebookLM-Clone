import type { AccountIdentity } from '../lib/repository'

interface AccountButtonProps {
  account: AccountIdentity
  onClick: () => void
}

export function AccountButton({ account, onClick }: AccountButtonProps) {
  const initial = account.isAnonymous ? 'G' : account.email?.trim().charAt(0).toUpperCase() || 'N'
  const label = account.isAnonymous ? 'Open guest account' : `Open account for ${account.email || 'NotebookLM user'}`

  return (
    <button className={`avatar-button ${account.isAnonymous ? 'guest' : ''}`} type="button" onClick={onClick} aria-label={label} title={label}>
      {initial}
    </button>
  )
}
