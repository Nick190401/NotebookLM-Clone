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

export interface Citation {
  sourceId: string
  label: number
  excerpt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  createdAt: number
  saved?: boolean
}

export type ArtifactType =
  | 'audio'
  | 'video'
  | 'mindmap'
  | 'report'
  | 'flashcards'
  | 'quiz'
  | 'infographic'
  | 'slides'
  | 'datatable'

export interface ArtifactConfig {
  focus: string
  language: string
  format?: string
  difficulty?: 'Easy' | 'Medium' | 'Hard'
  amount?: 'Fewer' | 'Standard' | 'More'
}

export interface ArtifactSection {
  heading: string
  body: string
  sourceIds: string[]
}

export interface ArtifactCard {
  front: string
  back: string
  sourceId: string
}

export interface ArtifactQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceId: string
}

export interface ArtifactNode {
  id: string
  label: string
  parentId: string
  sourceId: string
}

export interface ArtifactSlide {
  title: string
  body: string
  metric: string
  sourceIds: string[]
}

export interface ArtifactRow {
  cells: string[]
  sourceIds: string[]
}

export interface ArtifactMetric {
  value: string
  label: string
  context: string
  sourceId: string
}

export interface ArtifactTranscriptLine {
  speaker: string
  text: string
  sourceIds: string[]
}

export interface ArtifactContent {
  summary: string
  sections: ArtifactSection[]
  cards: ArtifactCard[]
  questions: ArtifactQuestion[]
  nodes: ArtifactNode[]
  slides: ArtifactSlide[]
  columns: string[]
  rows: ArtifactRow[]
  metrics: ArtifactMetric[]
  transcript: ArtifactTranscriptLine[]
  narration: string
}

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  status: 'generating' | 'ready' | 'error'
  createdAt: number
  config: ArtifactConfig
  content?: ArtifactContent
  error?: string
  model?: string
}

export interface Note {
  id: string
  title: string
  body: string
  createdAt: number
  locked?: boolean
}

export interface ChatConfig {
  style: 'Default' | 'Learning Guide' | 'Custom'
  length: 'Shorter' | 'Default' | 'Longer'
  instructions: string
}

export type NotebookShareAccess = 'private' | 'full' | 'chat'

export interface NotebookShareDetails {
  access: NotebookShareAccess
  token: string | null
}

export interface SharedNotebook {
  access: Exclude<NotebookShareAccess, 'private'>
  notebook: Notebook
}

export interface Notebook {
  id: string
  title: string
  emoji: string
  sources: Source[]
  messages: ChatMessage[]
  artifacts: Artifact[]
  notes: Note[]
  chatConfig: ChatConfig
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  outputLanguage: 'English' | 'Deutsch'
}

export interface AppData {
  notebooks: Notebook[]
  settings: AppSettings
}

export interface GroundedAnswer {
  content: string
  citations: Citation[]
  model?: string
}

export interface AiStatus {
  configured: boolean
  provider: 'Groq'
  primaryModel: string
  fallbackModel: string
  fastModel: string
}
