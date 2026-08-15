import { describe, expect, it } from 'vitest'
import { artifactExport, artifactGenerationPrompt } from '../../src/lib/artifact-export'
import { makeSource } from '../../src/lib/source'
import type { Artifact, ArtifactContent } from '../../src/types'

const emptyContent: ArtifactContent = {
  summary: 'Grounded summary',
  sections: [],
  cards: [],
  questions: [],
  nodes: [],
  slides: [],
  columns: [],
  rows: [],
  metrics: [],
  transcript: [],
  narration: '',
}

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: 'artifact-one',
    type: 'report',
    title: 'Transit briefing',
    status: 'ready',
    createdAt: 1,
    config: { focus: 'Service reliability', language: 'English', format: 'Briefing document' },
    content: emptyContent,
    ...overrides,
  }
}

describe('artifact provenance and exports', () => {
  it('reconstructs the persisted custom generation instructions', () => {
    const prompt = artifactGenerationPrompt(
      artifact({
        type: 'quiz',
        config: {
          focus: 'Operational risks',
          language: 'Deutsch',
          format: 'Multiple choice',
          difficulty: 'Hard',
          amount: 'More',
        },
      }),
    )
    expect(prompt).toContain('Format: Multiple choice.')
    expect(prompt).toContain('Focus: Operational risks.')
    expect(prompt).toContain('Difficulty: Hard.')
    expect(prompt).toContain('Target item count: 10–14.')
  })

  it('exports narrative outputs as source-attributed Markdown', () => {
    const source = {
      ...makeSource({ title: 'Transit study', kind: 'pdf', origin: 'Test', content: 'Reliable service.' }),
      id: 'source-one',
    }
    const exported = artifactExport(
      artifact({
        content: {
          ...emptyContent,
          sections: [{ heading: 'Finding', body: 'Frequency improved trust.', sourceIds: ['source-one'] }],
        },
      }),
      [source],
    )

    expect(exported.extension).toBe('md')
    expect(exported.content).toContain('## Finding')
    expect(exported.content).toContain('_Sources: Transit study_')
  })

  it('exports data tables as escaped CSV with source provenance', () => {
    const source = {
      ...makeSource({ title: 'Survey, 2026', kind: 'text', origin: 'Test', content: 'Survey evidence.' }),
      id: 'source-one',
    }
    const exported = artifactExport(
      artifact({
        type: 'datatable',
        title: 'Evidence table',
        content: {
          ...emptyContent,
          columns: ['Claim', 'Result'],
          rows: [{ cells: ['Trust', 'High "confidence"'], sourceIds: ['source-one'] }],
        },
      }),
      [source],
    )

    expect(exported.extension).toBe('csv')
    expect(exported.content).toBe('"Claim","Result","Sources"\r\n"Trust","High ""confidence""","Survey, 2026"')
  })
})
