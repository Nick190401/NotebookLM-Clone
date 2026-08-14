import {
  AudioLines,
  BarChart3,
  CirclePlay,
  FileChartColumn,
  FileSpreadsheet,
  FileText,
  Globe2,
  Image,
  Headphones,
  Images,
  Lightbulb,
  Network,
  NotebookTabs,
  Presentation,
  TextQuote,
  Video,
  type LucideIcon,
} from 'lucide-react'
import type { ArtifactType, SourceKind } from '../types'

const sourceIcons: Record<SourceKind, LucideIcon> = {
  pdf: FileText,
  web: Globe2,
  youtube: CirclePlay,
  text: TextQuote,
  audio: AudioLines,
  image: Image,
}

const artifactIcons: Record<ArtifactType, LucideIcon> = {
  audio: Headphones,
  video: Video,
  mindmap: Network,
  report: FileChartColumn,
  flashcards: NotebookTabs,
  quiz: Lightbulb,
  infographic: BarChart3,
  slides: Presentation,
  datatable: FileSpreadsheet,
}

export function SourceIcon({ kind, size = 18 }: { kind: SourceKind; size?: number }) {
  const Icon = sourceIcons[kind]
  return <Icon size={size} aria-hidden="true" />
}

export function ArtifactIcon({ type, size = 20 }: { type: ArtifactType; size?: number }) {
  const Icon = artifactIcons[type] ?? Images
  return <Icon size={size} aria-hidden="true" />
}
