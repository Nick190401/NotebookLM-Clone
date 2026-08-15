import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '../../src/components/ChatPanel'
import type { Citation, ChatMessage, Source } from '../../src/types'

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

const citation: Citation = { sourceId: 'source-a', label: 1, excerpt: 'Reliability rose by 24 percent' }

function answer(content: string, citations: Citation[]): ChatMessage {
  return { id: 'message-a', role: 'assistant', content, citations, createdAt: 2 }
}

function renderChat(message: ChatMessage, overrides: Partial<ComponentProps<typeof ChatPanel>> = {}) {
  const onOpenSource = vi.fn()
  render(
    <ChatPanel
      messages={[message]}
      sources={[source]}
      config={{ style: 'Default', length: 'Default', instructions: '' }}
      busy={false}
      onSend={vi.fn()}
      onAddSource={vi.fn()}
      onConfigure={vi.fn()}
      onClear={vi.fn()}
      onSave={vi.fn()}
      onOpenSource={onOpenSource}
      onCollapse={vi.fn()}
      {...overrides}
    />,
  )
  return { onOpenSource }
}

describe('grounded answer citations', () => {
  it('opens the cited source with the passage the statement came from', async () => {
    const user = userEvent.setup()
    const { onOpenSource } = renderChat(answer('Reliability rose by 24 percent [1].', [citation]))

    await user.click(screen.getByRole('button', { name: 'Citation 1' }))
    expect(onOpenSource).toHaveBeenCalledWith(source, citation)
  })

  it('drops a citation marker the answer never grounded', () => {
    renderChat(answer('Reliability rose sharply [3].', []))

    expect(screen.queryByText(/\[3\]/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Citation/ })).not.toBeInTheDocument()
  })

  it('renders the Markdown emphasis the model writes instead of its asterisks', () => {
    renderChat(answer('**Scaling approach** — the team keeps a **modular monolith** [1].', [citation]))

    expect(screen.getByText('Scaling approach').tagName).toBe('STRONG')
    expect(screen.getByText('modular monolith').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('keeps citations readable but inert when the reader cannot open sources', () => {
    renderChat(answer('Reliability rose by 24 percent [1].', [citation]), { canOpenSources: false })

    expect(screen.queryByRole('button', { name: 'Citation 1' })).not.toBeInTheDocument()
    expect(screen.getByTitle(citation.excerpt)).toHaveTextContent('1')
  })
})
