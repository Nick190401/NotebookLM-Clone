import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSourceDialog } from '../../src/components/AddSourceDialog'

const mocks = vi.hoisted(() => ({
  discoverSources: vi.fn(),
  runDeepResearch: vi.fn(),
  importSourceUrl: vi.fn(),
  uploadSource: vi.fn(),
}))

vi.mock('../../src/lib/api', () => ({
  discoverSources: mocks.discoverSources,
  runDeepResearch: mocks.runDeepResearch,
  importSourceUrl: mocks.importSourceUrl,
  uploadSource: mocks.uploadSource,
}))

describe('AddSourceDialog research modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runDeepResearch.mockResolvedValue({
      report: '## Executive summary\nReliable service improves public trust.',
      model: 'groq/compound',
      toolCount: 4,
      results: [
        { id: 'research-1', title: 'Primary evidence', url: 'https://research.example/evidence', summary: 'A controlled transit reliability study.' },
        { id: 'research-2', title: 'Authority report', url: 'https://authority.example/report', summary: 'Official network performance figures.' },
      ],
    })
    mocks.importSourceUrl.mockImplementation(async (url: string) => ({
      title: url.includes('research.example') ? 'Primary evidence' : 'Authority report',
      kind: 'web',
      origin: url,
      content: 'Imported full source evidence.',
    }))
  })

  it('creates a reviewable report and imports it with only the selected web sources', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<AddSourceDialog open language="English" initialResearchMode="deep" onClose={onClose} onAdd={onAdd} />)

    expect(screen.getByRole('button', { name: /Deep Research/ })).toHaveAttribute('aria-pressed', 'true')
    await user.type(screen.getByPlaceholderText('Ask a detailed research question'), 'How does service reliability affect public trust?')
    await user.click(screen.getByRole('button', { name: 'Start research' }))

    expect(await screen.findByText(/Reliable service improves public trust/)).toBeInTheDocument()
    expect(screen.getByText('4 research actions')).toBeInTheDocument()
    expect(mocks.runDeepResearch).toHaveBeenCalledWith('How does service reliability affect public trust?', 'English')
    expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(2)

    await user.click(screen.getByLabelText('Select Authority report'))
    await user.click(screen.getByRole('button', { name: 'Import report + 1 source' }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce())
    const sources = onAdd.mock.calls[0][0]
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ title: 'Deep Research: How does service reliability affect public trust?', kind: 'text' })
    expect(sources[0].content).toContain('Verified web sources')
    expect(sources[1]).toMatchObject({ title: 'Primary evidence', kind: 'web' })
    expect(mocks.importSourceUrl).toHaveBeenCalledOnce()
    expect(mocks.importSourceUrl).toHaveBeenCalledWith('https://research.example/evidence')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
