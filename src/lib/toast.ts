import { useCallback, useEffect, useRef, useState } from 'react'

const TOAST_DURATION_MS = 2200

export function useToast() {
  const [toast, setToast] = useState('')
  // Held so a rapid second toast cancels the pending timer instead of being cleared by it.
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const showToast = useCallback((message: string) => {
    window.clearTimeout(timer.current)
    setToast(message)
    timer.current = window.setTimeout(() => setToast(''), TOAST_DURATION_MS)
  }, [])

  return { toast, showToast }
}
