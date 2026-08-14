import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyAppData } from '../../src/lib/notebook'
import App from '../../src/App'

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
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
    window.location.hash = ''
    mocks.ensureSession.mockResolvedValue({ id: 'anonymous-user' })
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
})
