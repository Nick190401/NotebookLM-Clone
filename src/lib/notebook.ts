import type { AppData, Notebook } from '../types'
import { createId } from './id'

export const defaultSettings: AppData['settings'] = {
  theme: 'system',
  outputLanguage: 'English',
}

export function createEmptyAppData(): AppData {
  return {
    notebooks: [],
    settings: { ...defaultSettings },
  }
}

export function createBlankNotebook(title = 'Untitled notebook'): Notebook {
  const timestamp = Date.now()
  return {
    id: createId('notebook'),
    title,
    emoji: '📓',
    sources: [],
    messages: [],
    artifacts: [],
    notes: [],
    chatConfig: { style: 'Default', length: 'Default', instructions: '' },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/**
 * Duplicates a notebook with fresh ids, rewriting every artifact reference onto the new
 * source and node ids. Messages and notes are deliberately dropped: a copy starts empty.
 */
export function copyNotebook(source: Notebook): Notebook {
  const timestamp = Date.now()
  const sourceIds = new Map(source.sources.map((item) => [item.id, createId('source')]))
  const nodeIds = new Map(
    source.artifacts.flatMap((artifact) => artifact.content?.nodes ?? []).map((node) => [node.id, createId('node')]),
  )
  const mappedSourceId = (id: string) => sourceIds.get(id) ?? id

  return {
    ...source,
    id: createId('notebook'),
    title: `${source.title} (copy)`,
    sources: source.sources.map((item) => ({
      ...item,
      id: mappedSourceId(item.id),
      createdAt: timestamp,
    })),
    messages: [],
    artifacts: source.artifacts
      .filter((artifact) => artifact.status === 'ready')
      .map((artifact) => ({
        ...artifact,
        id: createId('artifact'),
        createdAt: timestamp,
        content: artifact.content
          ? {
              ...artifact.content,
              sections: artifact.content.sections.map((section) => ({
                ...section,
                sourceIds: section.sourceIds.map(mappedSourceId),
              })),
              cards: artifact.content.cards.map((card) => ({ ...card, sourceId: mappedSourceId(card.sourceId) })),
              questions: artifact.content.questions.map((question) => ({
                ...question,
                sourceId: mappedSourceId(question.sourceId),
              })),
              nodes: artifact.content.nodes.map((node) => ({
                ...node,
                id: nodeIds.get(node.id) ?? node.id,
                parentId: nodeIds.get(node.parentId) ?? node.parentId,
                sourceId: mappedSourceId(node.sourceId),
              })),
              slides: artifact.content.slides.map((slide) => ({
                ...slide,
                sourceIds: slide.sourceIds.map(mappedSourceId),
              })),
              rows: artifact.content.rows.map((row) => ({ ...row, sourceIds: row.sourceIds.map(mappedSourceId) })),
              metrics: artifact.content.metrics.map((metric) => ({
                ...metric,
                sourceId: mappedSourceId(metric.sourceId),
              })),
              transcript: artifact.content.transcript.map((line) => ({
                ...line,
                sourceIds: line.sourceIds.map(mappedSourceId),
              })),
            }
          : undefined,
      })),
    notes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
