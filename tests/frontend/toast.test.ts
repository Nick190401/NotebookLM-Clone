import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '../../src/lib/toast'

describe('toast timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives a replacing toast its own full duration instead of the previous timer', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.showToast('Sources organized by topic')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    act(() => {
      result.current.showToast('Label removed')
    })

    // The first toast's timer would have fired by now and cleared the second one.
    act(() => {
      vi.advanceTimersByTime(1_800)
    })
    expect(result.current.toast).toBe('Label removed')

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.toast).toBe('')
  })
})
