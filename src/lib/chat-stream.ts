import { useEffect, useRef, useState } from 'react'
import { streamAskAi } from './api'
import { createId } from './id'
import type { AppSettings, ChatMessage, Citation, Notebook } from '../types'

interface ChatStreamOptions {
  notebook: Notebook
  language: AppSettings['outputLanguage']
  shareToken?: string
  onFlush: () => Promise<void>
  update: (recipe: (current: Notebook) => Notebook) => void
  showToast: (message: string) => void
}

export function useChatStream({ notebook, language, shareToken, onFlush, update, showToast }: ChatStreamOptions) {
  const [chatBusy, setChatBusy] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState<string | null>(null)
  const streamRef = useRef<AbortController | null>(null)

  // Leaving the notebook must not keep a half-written answer streaming.
  useEffect(() => () => streamRef.current?.abort(), [])

  const sendMessage = async (content: string) => {
    const selectedSources = notebook.sources.filter((source) => source.selected)
    if (!selectedSources.length) {
      showToast('Select at least one source')
      return
    }
    const userMessage: ChatMessage = {
      id: createId('message'),
      role: 'user',
      content,
      citations: [],
      createdAt: Date.now(),
    }
    update((current) => ({ ...current, messages: [...current.messages, userMessage] }))
    setChatBusy(true)
    setStreamingAnswer('')

    const controller = new AbortController()
    streamRef.current?.abort()
    streamRef.current = controller

    let answer = ''
    let citations: Citation[] = []
    try {
      // The Edge Function grounds on the stored snapshot, so pending writes must land first.
      await onFlush()
      // Only the finished message is persisted; the partial answer stays in component
      // state, so a streamed reply costs one snapshot write instead of one per token.
      for await (const event of streamAskAi(
        {
          notebookId: notebook.id,
          sourceIds: selectedSources.map((source) => source.id),
          message: content,
          history: notebook.messages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          config: notebook.chatConfig,
          language,
          shareToken,
        },
        controller.signal,
      )) {
        if (event.type === 'delta') {
          answer += event.text
          setStreamingAnswer(answer)
        }
        if (event.type === 'done') citations = event.citations
        if (event.type === 'context' && event.omittedSourceIds.length) {
          showToast(
            `${event.omittedSourceIds.length} source${event.omittedSourceIds.length === 1 ? '' : 's'} did not fit the answer context`,
          )
        }
      }
      if (!answer.trim()) throw new Error('The AI returned an empty answer.')
      update((current) => ({
        ...current,
        messages: [
          ...current.messages,
          { id: createId('message'), role: 'assistant', content: answer.trim(), citations, createdAt: Date.now() },
        ],
      }))
    } catch (caught) {
      if (controller.signal.aborted) return
      // A mid-answer failure keeps whatever streamed so far, marked as interrupted.
      const message = caught instanceof Error ? caught.message : 'The AI request failed.'
      const partial = answer.trim()
      update((current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: createId('message'),
            role: 'assistant',
            content: partial ? `${partial}\n\n(Interrupted: ${message})` : `AI request failed: ${message}`,
            citations: partial ? citations : [],
            createdAt: Date.now(),
          },
        ],
      }))
      showToast(message)
    } finally {
      if (streamRef.current === controller) streamRef.current = null
      setStreamingAnswer(null)
      setChatBusy(false)
    }
  }

  return { chatBusy, streamingAnswer, sendMessage }
}
