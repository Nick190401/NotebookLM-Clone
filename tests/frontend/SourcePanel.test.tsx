import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SourcePanel } from '../../src/components/SourcePanel'
import { makeSource } from '../../src/lib/source'

describe('SourcePanel', () => {
  const props = () => ({
    onAdd: vi.fn(),
    onResearch: vi.fn(),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onOrganize: vi.fn(),
    onSetLabel: vi.fn(),
    onRenameLabel: vi.fn(),
    onDeleteLabel: vi.fn(),
    onCollapse: vi.fn(),
  })

  it('filters sources by title and inferred topic without changing selection', async () => {
    const user = userEvent.setup()
    const transit = makeSource({ title: 'Transit plan', kind: 'text', origin: 'Test', content: 'Railway railway railway reliability improves connections.' })
    const climate = makeSource({ title: 'Climate report', kind: 'pdf', origin: 'Test', content: 'Emissions emissions emissions require mitigation.' })
    render(<SourcePanel
      sources={[transit, climate]}
      {...props()}
    />)

    await user.type(screen.getByPlaceholderText('Filter sources'), 'railway')
    expect(screen.getByRole('button', { name: 'Open source Transit plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open source Climate report' })).not.toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('offers automatic topic organization once five sources are present', async () => {
    const user = userEvent.setup()
    const callbacks = props()
    const sources = Array.from({ length: 5 }, (_, index) => makeSource({
      title: `Source ${index + 1}`,
      kind: 'text',
      origin: 'Test',
      content: `Mobility mobility mobility evidence ${index}`,
    }))
    render(<SourcePanel sources={sources} {...callbacks} />)

    expect(screen.getByText('5 sources without a label')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Organize' }))
    expect(callbacks.onOrganize).toHaveBeenCalledOnce()
  })

  it('picks the research mode from a dropdown and researches with it', async () => {
    const user = userEvent.setup()
    const callbacks = props()
    render(<SourcePanel sources={[]} {...callbacks} />)

    await user.click(screen.getByRole('button', { name: 'Research mode: Fast research' }))
    const deep = screen.getByRole('menuitemradio', { name: /Deep research/ })
    expect(screen.getByRole('menuitemradio', { name: /Fast research/ })).toHaveAttribute('aria-checked', 'true')

    await user.click(deep)
    expect(screen.queryByRole('menu', { name: 'Research mode' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Search the web for sources'), 'transit reliability')
    await user.click(screen.getByRole('button', { name: 'Research topic' }))
    expect(callbacks.onResearch).toHaveBeenCalledWith('transit reliability', 'deep')
  })

  it('closes the research mode dropdown when clicking outside', async () => {
    const user = userEvent.setup()
    render(<SourcePanel sources={[]} {...props()} />)

    await user.click(screen.getByRole('button', { name: 'Research mode: Fast research' }))
    expect(screen.getByRole('menu', { name: 'Research mode' })).toBeInTheDocument()

    await user.click(screen.getByRole('heading', { name: 'Sources' }))
    expect(screen.queryByRole('menu', { name: 'Research mode' })).not.toBeInTheDocument()
  })

  it('renames and deletes groups and moves a source to a new label', async () => {
    const user = userEvent.setup()
    const callbacks = props()
    const source = { ...makeSource({ title: 'Transit plan', kind: 'text', origin: 'Test', content: 'Reliable public transport.' }), label: 'Mobility' }
    render(<SourcePanel sources={[source]} {...callbacks} />)

    await user.click(screen.getByRole('button', { name: 'Manage label Mobility' }))
    await user.click(screen.getByRole('button', { name: 'Rename label' }))
    await user.clear(screen.getByLabelText('Label name'))
    await user.type(screen.getByLabelText('Label name'), 'Public transport')
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(callbacks.onRenameLabel).toHaveBeenCalledWith('Mobility', 'Public transport')

    await user.click(screen.getByRole('button', { name: 'More options for Transit plan' }))
    await user.click(screen.getByRole('button', { name: 'Move to label' }))
    await user.clear(screen.getByLabelText('Label name'))
    await user.type(screen.getByLabelText('Label name'), 'Policy')
    await user.click(screen.getByRole('button', { name: 'Apply label' }))
    expect(callbacks.onSetLabel).toHaveBeenCalledWith(source.id, 'Policy')

    await user.click(screen.getByRole('button', { name: 'Manage label Mobility' }))
    await user.click(screen.getByRole('button', { name: 'Delete label' }))
    expect(callbacks.onDeleteLabel).toHaveBeenCalledWith('Mobility')
  })
})
