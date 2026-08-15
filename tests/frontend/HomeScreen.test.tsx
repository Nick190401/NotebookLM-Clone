import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../../src/components/HomeScreen'
import { createBlankNotebook } from '../../src/lib/notebook'

function renderHome() {
  const older = { ...createBlankNotebook('Zebra research'), id: 'older', updatedAt: 1 }
  const newer = { ...createBlankNotebook('Alpha project'), id: 'newer', updatedAt: 2 }
  const onDuplicate = vi.fn()
  render(
    <HomeScreen
      notebooks={[older, newer]}
      onCreate={vi.fn()}
      onOpen={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={onDuplicate}
      onOpenSettings={vi.fn()}
      account={{ id: 'guest', email: null, isAnonymous: true }}
      onOpenAccount={vi.fn()}
    />,
  )
  return { onDuplicate }
}

describe('HomeScreen', () => {
  it('filters notebooks by title and exposes grid and list views', async () => {
    const user = userEvent.setup()
    renderHome()

    await user.type(screen.getByPlaceholderText('Search notebooks'), 'alpha')
    expect(screen.getByRole('button', { name: 'Open notebook Alpha project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open notebook Zebra research' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('creates a private copy from the notebook menu', async () => {
    const user = userEvent.setup()
    const { onDuplicate } = renderHome()

    await user.click(screen.getByRole('button', { name: 'More options for Alpha project' }))
    await user.click(screen.getByRole('button', { name: 'Create a copy' }))
    expect(onDuplicate).toHaveBeenCalledWith('newer')
  })
})
