import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog } from '../../src/components/ShareDialog'

const shareToken = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  flushNotebook: vi.fn(),
  getNotebookSharing: vi.fn(),
  setNotebookSharing: vi.fn(),
}))

vi.mock('../../src/lib/repository', () => ({
  repository: {
    flushNotebook: mocks.flushNotebook,
    getNotebookSharing: mocks.getNotebookSharing,
    setNotebookSharing: mocks.setNotebookSharing,
  },
}))

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.flushNotebook.mockResolvedValue(undefined)
    mocks.getNotebookSharing.mockResolvedValue({ access: 'private', token: null })
    mocks.setNotebookSharing.mockResolvedValue({ access: 'chat', token: shareToken })
  })

  it('publishes a chat-only link and copies the exact public route', async () => {
    const user = userEvent.setup()
    render(<ShareDialog open notebookId="notebook-1" notebookTitle="Transit research" onClose={vi.fn()} />)

    expect(await screen.findByRole('radio', { name: /Restricted/i })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: /Chat only/i }))
    await user.click(screen.getByRole('button', { name: 'Apply access' }))

    expect(mocks.setNotebookSharing).toHaveBeenCalledWith('notebook-1', 'chat')
    const link = await screen.findByLabelText('Public notebook link')
    expect(link).toHaveValue(`${window.location.origin}${window.location.pathname}#/shared/${shareToken}`)

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  })

  it('warns that revoking an active link creates a new token next time', async () => {
    mocks.getNotebookSharing.mockResolvedValue({ access: 'full', token: shareToken })
    const user = userEvent.setup()
    render(<ShareDialog open notebookId="notebook-1" notebookTitle="Transit research" onClose={vi.fn()} />)

    await screen.findByLabelText('Public notebook link')
    await user.click(screen.getByRole('radio', { name: /Restricted/i }))

    expect(screen.getByText('The current link will stop working.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Turn off sharing' }))
    expect(mocks.setNotebookSharing).toHaveBeenCalledWith('notebook-1', 'private')
  })
})
