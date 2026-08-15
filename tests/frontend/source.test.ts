import { describe, expect, it } from 'vitest'
import { makeSource, normalizeSourceLabel, organizeSources, suggestedSourceLabel } from '../../src/lib/source'

describe('source organization', () => {
  it('suggests readable topic labels while preserving manual labels', () => {
    const unlabeled = {
      ...makeSource({
        title: 'Rail plan',
        kind: 'text',
        origin: 'Test',
        content: 'public-transport public-transport public-transport',
      }),
      topics: ['public-transport'],
    }
    const manual = {
      ...makeSource({ title: 'Budget', kind: 'pdf', origin: 'Test', content: 'finance finance finance' }),
      label: 'My research',
    }

    expect(suggestedSourceLabel(unlabeled)).toBe('Public Transport')
    expect(organizeSources([unlabeled, manual])).toEqual([{ ...unlabeled, label: 'Public Transport' }, manual])
  })

  it('normalizes manual labels and falls back when no topic is available', () => {
    const source = { ...makeSource({ title: 'Untitled', kind: 'text', origin: 'Test', content: 'short' }), topics: [] }
    expect(normalizeSourceLabel('  Market   research  ')).toBe('Market research')
    expect(suggestedSourceLabel(source)).toBe('Other')
  })
})
