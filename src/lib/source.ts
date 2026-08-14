import type { Source, SourceKind } from '../types'
import { createId } from './id'

const COMMON_WORDS = new Set([
  'about', 'also', 'and', 'are', 'been', 'but', 'can', 'could', 'from', 'have', 'into',
  'more', 'most', 'not', 'only', 'other', 'over', 'such', 'than', 'that', 'the', 'their',
  'there', 'these', 'they', 'this', 'through', 'use', 'using', 'was', 'were', 'which',
  'will', 'with', 'would', 'your',
])

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
  const firstTwo = clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')
  return firstTwo.length <= 220 ? firstTwo : `${firstTwo.slice(0, 219).trim()}…`
}

export function makeSource(input: {
  title: string
  kind: SourceKind
  origin: string
  content: string
}): Source {
  return {
    id: createId('source'),
    title: input.title.trim() || 'Untitled source',
    kind: input.kind,
    origin: input.origin,
    content: input.content.trim(),
    summary: summarizeContent(input.content),
    topics: inferTopics(input.content),
    selected: true,
    createdAt: Date.now(),
  }
}
