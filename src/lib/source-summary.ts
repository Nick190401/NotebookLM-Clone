import type { Source } from '../types'

export function sourceSummary(sources: Source[]) {
  const selected = sources.filter((source) => source.selected)
  if (selected.length === 0) return 'No sources selected.'
  const topics = Array.from(new Set(selected.flatMap((source) => source.topics))).slice(0, 5)
  const topicText = topics.length ? ` around ${topics.join(', ')}` : ''
  return `This notebook brings together ${selected.length} source${selected.length === 1 ? '' : 's'}${topicText}. Use the suggested questions below or ask anything about the material.`
}
