import { describe, expect, it } from 'vitest'
import { copyNotebook, createBlankNotebook } from '../../src/lib/notebook'
import { makeSource } from '../../src/lib/source'
import type { Artifact, ArtifactContent } from '../../src/types'

function artifactContent(sourceId: string): ArtifactContent {
  return {
    summary: 'A grounded output.',
    sections: [{ heading: 'Finding', body: 'Evidence', sourceIds: [sourceId] }],
    cards: [{ front: 'Question', back: 'Answer', sourceId }],
    questions: [{ question: 'Question', options: ['A'], correctIndex: 0, explanation: 'Evidence', sourceId }],
    nodes: [{ id: 'root-node', label: 'Root', parentId: '', sourceId }, { id: 'child-node', label: 'Child', parentId: 'root-node', sourceId }],
    slides: [{ title: 'Slide', body: 'Evidence', metric: '1', sourceIds: [sourceId] }],
    columns: ['Finding'],
    rows: [{ cells: ['Evidence'], sourceIds: [sourceId] }],
    metrics: [{ value: '1', label: 'Finding', context: 'Evidence', sourceId }],
    transcript: [{ speaker: 'Host', text: 'Evidence', sourceIds: [sourceId] }],
    narration: 'Evidence',
  }
}

describe('copyNotebook', () => {
  it('copies sources and ready Studio outputs with fresh internal references', () => {
    const source = makeSource({ title: 'Evidence', kind: 'text', origin: 'Test', content: 'Reliable evidence supports the finding.' })
    const readyArtifact: Artifact = {
      id: 'ready-artifact',
      type: 'report',
      title: 'Briefing document',
      status: 'ready',
      config: { focus: '', language: 'English' },
      content: artifactContent(source.id),
      createdAt: 1,
    }
    const notebook = {
      ...createBlankNotebook('Research notebook'),
      sources: [source],
      messages: [{ id: 'private-message', role: 'user' as const, content: 'Private question', citations: [], createdAt: 1 }],
      notes: [{ id: 'private-note', title: 'Private note', body: 'Personal thought', createdAt: 1 }],
      artifacts: [readyArtifact, { ...readyArtifact, id: 'pending-artifact', status: 'generating' as const }],
    }

    const copy = copyNotebook(notebook)
    const copiedSourceId = copy.sources[0].id
    const copiedContent = copy.artifacts[0].content!

    expect(copy.id).not.toBe(notebook.id)
    expect(copy.title).toBe('Research notebook (copy)')
    expect(copiedSourceId).not.toBe(source.id)
    expect(copy.messages).toEqual([])
    expect(copy.notes).toEqual([])
    expect(copy.artifacts).toHaveLength(1)
    expect(copiedContent.sections[0].sourceIds).toEqual([copiedSourceId])
    expect(copiedContent.cards[0].sourceId).toBe(copiedSourceId)
    expect(copiedContent.nodes[0].id).not.toBe('root-node')
    expect(copiedContent.nodes[1].parentId).toBe(copiedContent.nodes[0].id)
    expect(notebook.sources[0].id).toBe(source.id)
  })
})
