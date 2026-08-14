import { artifactDefinitions } from '../data/artifacts'
import type { Artifact, Source } from '../types'

export interface ArtifactExport {
  content: string
  extension: 'csv' | 'json' | 'md'
  label: string
  mimeType: string
}

function sourceNames(ids: string[], sources: Source[]) {
  return [...new Set(ids.map((id) => sources.find((source) => source.id === id)?.title).filter(Boolean))].join(', ')
}

function markdownSources(ids: string[], sources: Source[]) {
  const names = sourceNames(ids, sources)
  return names ? `\n\n_Sources: ${names}_` : ''
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export function artifactGenerationPrompt(artifact: Artifact) {
  const definition = artifactDefinitions.find((item) => item.type === artifact.type)
  const count = artifact.config.amount === 'Fewer' ? '4–6' : artifact.config.amount === 'More' ? '10–14' : '6–9'
  return [
    `Create a NotebookLM-style ${definition?.shortLabel ?? artifact.type} grounded exclusively in the selected source evidence.`,
    `Format: ${artifact.config.format || definition?.defaultFormat || 'Default'}.`,
    `Output language: ${artifact.config.language}.`,
    `Focus: ${artifact.config.focus.trim() || 'The most important insights'}.`,
    artifact.config.difficulty ? `Difficulty: ${artifact.config.difficulty}.` : '',
    artifact.config.amount ? `Target item count: ${count}.` : '',
  ].filter(Boolean).join('\n')
}

export function artifactExportLabel(artifact: Artifact) {
  if (!artifact.content) return 'Download JSON'
  return artifact.type === 'datatable' ? 'Download CSV' : 'Download Markdown'
}

export function artifactExport(artifact: Artifact, sources: Source[]): ArtifactExport {
  const content = artifact.content
  if (!content) {
    return {
      content: JSON.stringify({ title: artifact.title, type: artifact.type, config: artifact.config, model: artifact.model, content: artifact.content }, null, 2),
      extension: 'json',
      label: artifactExportLabel(artifact),
      mimeType: 'application/json',
    }
  }

  if (artifact.type === 'datatable') {
    const includeSources = content.rows.some((row) => row.sourceIds.length > 0)
    const header = [...content.columns, ...(includeSources ? ['Sources'] : [])]
    const rows = content.rows.map((row) => [
      ...content.columns.map((_, index) => row.cells[index] || ''),
      ...(includeSources ? [sourceNames(row.sourceIds, sources)] : []),
    ])
    return {
      content: [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'),
      extension: 'csv',
      label: artifactExportLabel(artifact),
      mimeType: 'text/csv;charset=utf-8',
    }
  }

  const lines = [`# ${artifact.title}`, '', content.summary]
  switch (artifact.type) {
    case 'audio':
      lines.push('', '## Transcript', ...content.transcript.flatMap((line) => ['', `**${line.speaker}:** ${line.text}${markdownSources(line.sourceIds, sources)}`]))
      break
    case 'video':
    case 'slides':
      content.slides.forEach((slide, index) => lines.push('', `## ${index + 1}. ${slide.title}`, '', slide.body, ...(slide.metric ? ['', `**${slide.metric}**`] : []), markdownSources(slide.sourceIds, sources)))
      break
    case 'mindmap':
      content.nodes.forEach((node) => lines.push('', `${node.parentId ? '-' : '##'} ${node.label}${markdownSources([node.sourceId], sources)}`))
      break
    case 'report':
      content.sections.forEach((section) => lines.push('', `## ${section.heading}`, '', `${section.body}${markdownSources(section.sourceIds, sources)}`))
      break
    case 'flashcards':
      content.cards.forEach((card, index) => lines.push('', `## Card ${index + 1}`, '', `**Question:** ${card.front}`, '', `**Answer:** ${card.back}${markdownSources([card.sourceId], sources)}`))
      break
    case 'quiz':
      content.questions.forEach((question, index) => lines.push(
        '', `## ${index + 1}. ${question.question}`, '',
        ...question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`),
        '', `**Answer:** ${String.fromCharCode(65 + question.correctIndex)}. ${question.options[question.correctIndex] || ''}`,
        '', `${question.explanation}${markdownSources([question.sourceId], sources)}`,
      ))
      break
    case 'infographic':
      lines.push('', '## Key metrics')
      content.metrics.forEach((metric) => lines.push('', `- **${metric.value} — ${metric.label}:** ${metric.context}${markdownSources([metric.sourceId], sources)}`))
      content.sections.forEach((section) => lines.push('', `## ${section.heading}`, '', `${section.body}${markdownSources(section.sourceIds, sources)}`))
      break
  }

  return {
    content: lines.join('\n').trim(),
    extension: 'md',
    label: artifactExportLabel(artifact),
    mimeType: 'text/markdown;charset=utf-8',
  }
}

export function downloadArtifact(artifact: Artifact, sources: Source[]) {
  const exported = artifactExport(artifact, sources)
  const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'notebook-output'}.${exported.extension}`
  anchor.click()
  URL.revokeObjectURL(url)
}
