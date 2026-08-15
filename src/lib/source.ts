import type { Source, SourceKind } from '../types'
import { createId } from './id'

// Stop words for topic inference: generic English plus the reporting and statistics
// vocabulary that is frequent in uploaded documents but says nothing about the subject.
const COMMON_WORDS = new Set([
  'about',
  'also',
  'and',
  'are',
  'been',
  'but',
  'can',
  'could',
  'from',
  'have',
  'into',
  'more',
  'most',
  'not',
  'only',
  'other',
  'over',
  'such',
  'than',
  'that',
  'the',
  'their',
  'there',
  'these',
  'they',
  'this',
  'through',
  'use',
  'using',
  'was',
  'were',
  'which',
  'will',
  'with',
  'would',
  'your',
  'percent',
  'percentage',
  'million',
  'billion',
  'thousand',
  'number',
  'numbers',
  'total',
  'average',
  'median',
  'value',
  'values',
  'rate',
  'rates',
  'share',
  'across',
  'between',
  'during',
  'after',
  'before',
  'under',
  'above',
  'while',
  'however',
  'therefore',
  'because',
  'according',
  'reported',
  'reports',
  'remains',
  'reached',
  'include',
  'includes',
  'including',
  'compared',
  'versus',
  'years',
  'year',
  'month',
  'months',
  'quarter',
  'annual',
  'source',
  'sources',
  'content',
  'image',
  'images',
  'figure',
  'table',
  'chart',
  'text',
  'document',
  'page',
  'section',
  'overview',
  'summary',
  'study',
  'data',
  'based',
  'each',
  'per',
])

/** Below this many sources, grouping labels add clutter rather than structure. */
export const SOURCE_LABEL_THRESHOLD = 5

export function normalizeSourceLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 80)
}

export function suggestedSourceLabel(source: Pick<Source, 'topics'>) {
  const topic = normalizeSourceLabel(source.topics[0] ?? '')
  if (!topic) return 'Other'
  return topic
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export function organizeSources(sources: Source[]) {
  return sources.map((source) => (source.label ? source : { ...source, label: suggestedSourceLabel(source) }))
}

export function sourceKindLabel(source: Pick<Source, 'kind' | 'origin'>) {
  if (source.kind !== 'text') return source.kind.toUpperCase()
  const extension = source.origin.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension ? extension.toUpperCase() : 'TEXT'
}

export function inferTopics(content: string) {
  const counts = new Map<string, number>()
  content
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4 && !COMMON_WORDS.has(word))
    .forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1))
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word)
}

export function summarizeContent(content: string) {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) return 'A source ready to explore in this notebook.'
  const firstTwo = clean
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(' ')
  return firstTwo.length <= 220 ? firstTwo : `${firstTwo.slice(0, 219).trim()}…`
}

export function makeSource(input: { title: string; kind: SourceKind; origin: string; content: string }): Source {
  return {
    id: createId('source'),
    title: input.title.trim() || 'Untitled source',
    kind: input.kind,
    origin: input.origin,
    content: input.content.trim(),
    summary: summarizeContent(input.content),
    topics: inferTopics(input.content),
    label: '',
    selected: true,
    createdAt: Date.now(),
  }
}
