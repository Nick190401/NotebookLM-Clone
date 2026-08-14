import type { ArtifactConfig, ArtifactType } from '../types'

export interface ArtifactDefinition {
  type: ArtifactType
  label: string
  shortLabel: string
  description: string
  tint: string
  defaultFormat: string
  editable: boolean
}

export const artifactDefinitions: ArtifactDefinition[] = [
  {
    type: 'audio',
    label: 'Audio Overview',
    shortLabel: 'Audio',
    description: 'A lively conversation grounded in your sources',
    tint: 'violet',
    defaultFormat: 'Deep Dive',
    editable: true,
  },
  {
    type: 'video',
    label: 'Video Overview',
    shortLabel: 'Video',
    description: 'A narrated visual explanation of the material',
    tint: 'green',
    defaultFormat: 'Explainer',
    editable: true,
  },
  {
    type: 'mindmap',
    label: 'Mind Map',
    shortLabel: 'Mind Map',
    description: 'Explore topics and their relationships',
    tint: 'magenta',
    defaultFormat: 'Expanded',
    editable: false,
  },
  {
    type: 'report',
    label: 'Reports',
    shortLabel: 'Report',
    description: 'Briefings, study guides, FAQs, and more',
    tint: 'gold',
    defaultFormat: 'Briefing document',
    editable: true,
  },
  {
    type: 'flashcards',
    label: 'Flashcards',
    shortLabel: 'Flashcards',
    description: 'Review the most important concepts',
    tint: 'coral',
    defaultFormat: 'Standard deck',
    editable: true,
  },
  {
    type: 'quiz',
    label: 'Quiz',
    shortLabel: 'Quiz',
    description: 'Test your understanding with explanations',
    tint: 'cyan',
    defaultFormat: 'Multiple choice',
    editable: true,
  },
  {
    type: 'infographic',
    label: 'Infographic',
    shortLabel: 'Infographic',
    description: 'Turn evidence into a visual narrative',
    tint: 'plum',
    defaultFormat: 'Portrait',
    editable: true,
  },
  {
    type: 'slides',
    label: 'Slide Deck',
    shortLabel: 'Slides',
    description: 'A presentation structured from your sources',
    tint: 'olive',
    defaultFormat: 'Detailed deck',
    editable: true,
  },
  {
    type: 'datatable',
    label: 'Data Table',
    shortLabel: 'Table',
    description: 'Compare evidence in rows and columns',
    tint: 'indigo',
    defaultFormat: 'Comparison table',
    editable: true,
  },
]

export function defaultArtifactConfig(type: ArtifactType, language: string): ArtifactConfig {
  const definition = artifactDefinitions.find((item) => item.type === type)
  return {
    focus: '',
    language,
    format: definition?.defaultFormat,
    difficulty: type === 'quiz' || type === 'flashcards' ? 'Medium' : undefined,
    amount: type === 'quiz' || type === 'flashcards' ? 'Standard' : undefined,
  }
}

export function artifactTitle(type: ArtifactType) {
  const titles: Record<ArtifactType, string> = {
    audio: 'Source deep dive',
    video: 'Visual source overview',
    mindmap: 'Key ideas and connections',
    report: 'Source briefing',
    flashcards: 'Core concepts',
    quiz: 'Knowledge check',
    infographic: 'Evidence at a glance',
    slides: 'Research presentation',
    datatable: 'Source comparison',
  }
  return titles[type]
}
