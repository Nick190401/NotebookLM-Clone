import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuthDialog } from '../../src/components/AuthDialog'

const guest = { id: 'guest-user', email: null, isAnonymous: true }
const account = { id: 'account-user', email: 'person@example.com', isAnonymous: false }

function props(overrides: Partial<ComponentProps<typeof AuthDialog>> = {}) {
  return {
    open: true,
    account: guest,
    notebookCount: 2,
    prompt: null,
    onClose: vi.fn(),
    onBeginUpgrade: vi.fn().mockResolvedValue(undefined),
    onSignIn: vi.fn().mockResolvedValue(undefined),
    onSetPassword: vi.fn().mockResolvedValue(undefined),
    onSendPasswordReset: vi.fn().mockResolvedValue(undefined),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('Account dialog', () => {
  it('upgrades the current guest identity and explains that notebooks stay attached', async () => {
    const user = userEvent.setup()
    const onBeginUpgrade = vi.fn().mockResolvedValue(undefined)
    render(<AuthDialog {...props({ onBeginUpgrade })} />)

    expect(screen.getByLabelText('2 guest notebooks')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))

    expect(onBeginUpgrade).toHaveBeenCalledWith('person@example.com')
    expect(await screen.findByText(/Confirmation sent to person@example.com/)).toBeInTheDocument()
  })

  it('requires explicit confirmation before leaving guest notebooks for another account', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn().mockResolvedValue(undefined)
    render(<AuthDialog {...props({ onSignIn })} />)

    await user.click(screen.getByRole('tab', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'valid-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/guest notebooks will not move/i)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledWith('person@example.com', 'valid-password')
  })

  it('finishes a confirmed account with a matching password', async () => {
    const user = userEvent.setup()
    const onSetPassword = vi.fn().mockResolvedValue(undefined)
    render(<AuthDialog {...props({ account, notebookCount: 2, prompt: 'confirmed', onSetPassword })} />)

    expect(screen.getByText('Email confirmed')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New password'), 'secure-password')
    await user.type(screen.getByLabelText('Confirm password'), 'secure-password')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    expect(onSetPassword).toHaveBeenCalledWith('secure-password')
    expect(await screen.findByText('Your password has been updated.')).toBeInTheDocument()
  })

  it('requests password recovery from the sign-in flow', async () => {
    const user = userEvent.setup()
    const onSendPasswordReset = vi.fn().mockResolvedValue(undefined)
    render(<AuthDialog {...props({ onSendPasswordReset })} />)

    await user.click(screen.getByRole('tab', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))

    expect(onSendPasswordReset).toHaveBeenCalledWith('person@example.com')
    expect(await screen.findByText('Password reset instructions sent to person@example.com.')).toBeInTheDocument()
  })
})
