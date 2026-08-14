import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyAppData } from '../../src/lib/notebook'
import App from '../../src/App'

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  beginAccountUpgrade: vi.fn(),
  signIn: vi.fn(),
  setPassword: vi.fn(),
  sendPasswordReset: vi.fn(),
  signOut: vi.fn(),
  loadWorkspace: vi.fn(),
  saveNotebook: vi.fn(),
  flushNotebook: vi.fn(),
  saveSettings: vi.fn(),
  deleteNotebook: vi.fn(),
  clearWorkspace: vi.fn(),
  getAiStatus: vi.fn(),
  askAi: vi.fn(),
  createArtifact: vi.fn(),
}))

vi.mock('../../src/lib/repository', () => ({ repository: {
  ensureSession: mocks.ensureSession,
  beginAccountUpgrade: mocks.beginAccountUpgrade,
  signIn: mocks.signIn,
  setPassword: mocks.setPassword,
  sendPasswordReset: mocks.sendPasswordReset,
  signOut: mocks.signOut,
  loadWorkspace: mocks.loadWorkspace,
  saveNotebook: mocks.saveNotebook,
  flushNotebook: mocks.flushNotebook,
  saveSettings: mocks.saveSettings,
  deleteNotebook: mocks.deleteNotebook,
  clearWorkspace: mocks.clearWorkspace,
} }))

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    getAiStatus: mocks.getAiStatus,
    askAi: mocks.askAi,
    createArtifact: mocks.createArtifact,
  }
})

async function createNotebookWithTextSource(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New notebook' }))
  await user.click(screen.getByRole('tab', { name: 'Copied text' }))
  await user.type(screen.getByLabelText('Source title'), 'Transit reliability research')
  await user.type(screen.getByLabelText('Pasted text'), 'Reliable ten-minute service improved public trust. Timetable coordination reduced missed connections by 24 percent.')
  await user.click(screen.getByRole('button', { name: 'Add source' }))
}

describe('NotebookLM clone with Supabase persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    mocks.ensureSession.mockResolvedValue({ id: 'anonymous-user', email: null, isAnonymous: true })
    mocks.beginAccountUpgrade.mockResolvedValue({ id: 'anonymous-user', email: null, isAnonymous: true })
    mocks.signIn.mockResolvedValue({ id: 'account-user', email: 'person@example.com', isAnonymous: false })
    mocks.setPassword.mockResolvedValue({ id: 'account-user', email: 'person@example.com', isAnonymous: false })
    mocks.sendPasswordReset.mockResolvedValue(undefined)
    mocks.signOut.mockResolvedValue(undefined)
    mocks.loadWorkspace.mockResolvedValue(createEmptyAppData())
    mocks.saveNotebook.mockResolvedValue(undefined)
    mocks.flushNotebook.mockResolvedValue(undefined)
    mocks.saveSettings.mockResolvedValue(undefined)
    mocks.deleteNotebook.mockResolvedValue(undefined)
    mocks.clearWorkspace.mockResolvedValue(undefined)
    mocks.getAiStatus.mockResolvedValue({ configured: true, provider: 'Groq', primaryModel: 'openai/gpt-oss-120b', fallbackModel: 'openai/gpt-oss-20b', fastModel: 'llama-3.1-8b-instant' })
    mocks.askAi.mockImplementation(async (request: { sourceIds: string[] }) => ({
      content: 'Public trust improves when service is reliable and connections are coordinated. [1]',
      citations: [{ sourceId: request.sourceIds[0], label: 1, excerpt: 'Reliable ten-minute service improved public trust.' }],
      model: 'openai/gpt-oss-120b',
    }))
  })

  it('loads an empty Supabase workspace and creates the complete three-panel experience', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome to NotebookLM' })).toBeInTheDocument()
    expect(mocks.ensureSession).toHaveBeenCalledOnce()
    expect(mocks.loadWorkspace).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'New notebook' }))

    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Studio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Audio Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data Table' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Groq AI/i })).toBeInTheDocument()
    expect(mocks.saveNotebook).toHaveBeenCalled()
  })

  it('flushes the Supabase snapshot before grounded chat and sends only notebook/source IDs', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Welcome to NotebookLM' })
    await createNotebookWithTextSource(user)

    const prompt = screen.getByPlaceholderText('Ask about your sources…')
    await user.type(prompt, 'What improves public trust?')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText(/Public trust improves/i)).toBeInTheDocument()
    expect(mocks.flushNotebook).toHaveBeenCalledOnce()
    expect(mocks.askAi).toHaveBeenCalledWith(expect.objectContaining({
      notebookId: expect.stringMatching(/^notebook-/),
      sourceIds: [expect.stringMatching(/^source-/)],
      message: 'What improves public trust?',
      language: 'English',
    }))
    expect(mocks.askAi.mock.calls[0][0]).not.toHaveProperty('sources')

    const messageStream = screen.getByLabelText('Chat conversation')
    const saveButtons = within(messageStream).getAllByRole('button', { name: /Save to note/i })
    await user.click(saveButtons.at(-1)!)
    expect(screen.getByText('Saved chat response')).toBeInTheDocument()
  })

  it('opens the data-preserving account flow from the guest profile button', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Welcome to NotebookLM' })
    await user.click(screen.getByRole('button', { name: 'Open guest account' }))

    expect(screen.getByRole('heading', { name: 'Save this workspace' })).toBeInTheDocument()
    expect(screen.getByText('Keep the same workspace')).toBeInTheDocument()
    expect(screen.getByLabelText('0 guest notebooks')).toBeInTheDocument()
  })

  it('switches to an existing account workspace after successful sign-in', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Welcome to NotebookLM' })
    await user.click(screen.getByRole('button', { name: 'Open guest account' }))
    await user.click(screen.getByRole('tab', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'valid-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mocks.signIn).toHaveBeenCalledWith('person@example.com', 'valid-password')
    expect(mocks.loadWorkspace).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('button', { name: 'Open account for person@example.com' })).toBeInTheDocument()
  })

  it('never exposes guest data after authentication switches but the account workspace fails to load', async () => {
    const user = userEvent.setup()
    mocks.loadWorkspace
      .mockResolvedValueOnce(createEmptyAppData())
      .mockRejectedValueOnce(new Error('Account workspace unavailable'))
    render(<App />)

    await screen.findByRole('heading', { name: 'Welcome to NotebookLM' })
    await user.click(screen.getByRole('button', { name: 'Open guest account' }))
    await user.click(screen.getByRole('tab', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'valid-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Supabase setup needed' })).toBeInTheDocument()
    expect(screen.getByText('Account workspace unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome to NotebookLM' })).not.toBeInTheDocument()
  })

  it('shows a retryable error when the initial Supabase session cannot be opened', async () => {
    const user = userEvent.setup()
    mocks.ensureSession.mockRejectedValueOnce(new Error('Session unavailable'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Supabase setup needed' })).toBeInTheDocument()
    expect(screen.getByText('Session unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Welcome to NotebookLM' })).toBeInTheDocument()
    expect(mocks.ensureSession).toHaveBeenCalledTimes(2)
  })

  it('opens a verified recovery callback and removes its URL credentials after the session resolves', async () => {
    window.history.replaceState(null, '', '/?account=recovery#access_token=secret-token')
    mocks.ensureSession.mockResolvedValue({ id: 'account-user', email: 'person@example.com', isAnonymous: false })
    render(<App />)

    expect(await screen.findByText('Recovery link accepted')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
  })

  it('signs a permanent account out and opens a fresh guest workspace', async () => {
    const user = userEvent.setup()
    mocks.ensureSession
      .mockResolvedValueOnce({ id: 'account-user', email: 'person@example.com', isAnonymous: false })
      .mockResolvedValueOnce({ id: 'fresh-guest', email: null, isAnonymous: true })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open account for person@example.com' }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(mocks.ensureSession).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('button', { name: 'Open guest account' })).toBeInTheDocument()
  })
})
