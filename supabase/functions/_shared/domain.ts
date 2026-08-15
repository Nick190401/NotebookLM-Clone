export type SourceKind = 'pdf' | 'web' | 'youtube' | 'text' | 'audio' | 'image'

export interface Source {
  id: string
  title: string
  kind: SourceKind
  origin: string
  content: string
  summary: string
  topics: string[]
  selected: boolean
  createdAt: number
}

export type ArtifactType =
  'audio' | 'video' | 'mindmap' | 'report' | 'flashcards' | 'quiz' | 'infographic' | 'slides' | 'datatable'

export interface ArtifactConfig {
  focus: string
  language: string
  format?: string
  difficulty?: 'Easy' | 'Medium' | 'Hard'
  amount?: 'Fewer' | 'Standard' | 'More'
}

export interface ChatConfig {
  style: 'Default' | 'Learning Guide' | 'Custom'
  length: 'Shorter' | 'Default' | 'Longer'
  instructions: string
}

export interface ArtifactContent {
  summary: string
  sections: { heading: string; body: string; sourceIds: string[] }[]
  cards: { front: string; back: string; sourceId: string }[]
  questions: { question: string; options: string[]; correctIndex: number; explanation: string; sourceId: string }[]
  nodes: { id: string; label: string; parentId: string; sourceId: string }[]
  slides: { title: string; body: string; metric: string; sourceIds: string[] }[]
  columns: string[]
  rows: { cells: string[]; sourceIds: string[] }[]
  metrics: { value: string; label: string; context: string; sourceId: string }[]
  transcript: { speaker: string; text: string; sourceIds: string[] }[]
  narration: string
}

export interface SourceRow {
  id: string
  title: string
  kind: SourceKind
  origin: string
  content: string
  summary: string
  topics: string[]
  selected: boolean
  created_at: string
}

export function sourceFromRow(row: SourceRow): Source {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    origin: row.origin,
    content: row.content,
    summary: row.summary,
    topics: row.topics,
    selected: row.selected,
    createdAt: new Date(row.created_at).getTime(),
  }
}
