import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactPromptDialog } from '../../src/components/ArtifactPromptDialog'
import { StudioPanel } from '../../src/components/StudioPanel'
import type { Artifact } from '../../src/types'

const output: Artifact = {
  id: 'artifact-one',
  type: 'report',
  title: 'Transit briefing',
  status: 'ready',
  createdAt: 1,
  model: 'test-model',
  config: { focus: 'Service reliability', language: 'English', format: 'Briefing document' },
}

describe('Studio provenance', () => {
  it('exposes the persisted custom prompt from an output menu', async () => {
    const user = userEvent.setup()
    const onViewPrompt = vi.fn()
    render(
      <StudioPanel
        artifacts={[output]}
        notes={[]}
        sourceCount={1}
        settings={{ theme: 'system', outputLanguage: 'English' }}
        onGenerate={vi.fn()}
        onCustomize={vi.fn()}
        onOpenArtifact={vi.fn()}
        onViewPrompt={onViewPrompt}
        onDeleteArtifact={vi.fn()}
        onAddNote={vi.fn()}
        onOpenNote={vi.fn()}
        onDeleteNote={vi.fn()}
        onAddSource={vi.fn()}
        onCollapse={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'More options for Transit briefing' }))
    await user.click(screen.getByRole('button', { name: 'View custom prompt' }))
    expect(onViewPrompt).toHaveBeenCalledWith(output)
  })

  it('renders an inspectable generation prompt with format, focus, and model', () => {
    render(<ArtifactPromptDialog artifact={output} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'View custom prompt' })).toBeInTheDocument()
    expect(screen.getByText(/Format: Briefing document/)).toBeInTheDocument()
    expect(screen.getByText(/Focus: Service reliability/)).toBeInTheDocument()
    expect(screen.getByText(/test-model/)).toBeInTheDocument()
  })
})
