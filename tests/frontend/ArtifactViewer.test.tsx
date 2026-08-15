import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactViewer } from '../../src/components/ArtifactViewer'
import type { Artifact, ArtifactContent, ArtifactType, Source } from '../../src/types'

const source: Source = {
  id: 'source-a',
  title: 'Transit reliability research',
  kind: 'text',
  origin: 'test',
  content: 'Reliability rose by 24 percent after the signal upgrade.',
  summary: '',
  topics: [],
  label: '',
  selected: true,
  createdAt: 1,
}

const emptyContent: ArtifactContent = {
  summary: '',
  sections: [],
  cards: [],
  questions: [],
  nodes: [],
  slides: [],
  columns: [],
  rows: [],
  metrics: [],
  transcript: [],
  narration: '',
}

function artifact(type: ArtifactType, content?: Partial<ArtifactContent>): Artifact {
  return {
    id: 'artifact-one',
    type,
    title: 'Transit briefing',
    status: 'ready',
    createdAt: 1,
    config: { focus: '', language: 'English' },
    content: content ? { ...emptyContent, ...content } : undefined,
  }
}

describe('Studio output viewer', () => {
  it('offers a recoverable state instead of a blank output when the model returned nothing', () => {
    render(<ArtifactViewer artifact={artifact('report')} sources={[source]} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Output unavailable' })).toBeInTheDocument()
  })

  it('falls back to the same state when a typed output arrives without its items', () => {
    render(<ArtifactViewer artifact={artifact('quiz', {})} sources={[source]} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Output unavailable' })).toBeInTheDocument()
  })

  it('marks a wrong quiz answer and explains it from the cited source', async () => {
    const user = userEvent.setup()
    render(
      <ArtifactViewer
        artifact={artifact('quiz', {
          questions: [
            {
              question: 'What drove the reliability gain?',
              options: ['Signal upgrade', 'Fewer services'],
              correctIndex: 0,
              explanation: 'The upgrade preceded the measured gain.',
              sourceId: 'source-a',
            },
          ],
        })}
        sources={[source]}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Fewer services/ }))
    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByText('The upgrade preceded the measured gain.')).toBeInTheDocument()
    expect(screen.getByText(source.title)).toBeInTheDocument()
  })

  it('shows a placeholder for table cells the model left out', () => {
    render(
      <ArtifactViewer
        artifact={artifact('datatable', {
          columns: ['Metric', 'Value'],
          rows: [{ cells: ['Reliability'], sourceIds: ['source-a'] }],
        })}
        sources={[source]}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('cell', { name: 'Reliability' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument()
  })
})
