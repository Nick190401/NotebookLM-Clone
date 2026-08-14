import type { Source } from './domain.ts'

export interface SourceChunk {
  sourceId: string
  title: string
  text: string
  score: number
}

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'aus', 'bei', 'das', 'dem', 'den', 'der', 'des', 'die',
  'ein', 'eine', 'einer', 'eines', 'for', 'from', 'für', 'hat', 'have', 'how', 'ich', 'ist', 'mit',
  'nicht', 'oder', 'sich', 'sind', 'the', 'this', 'und', 'von', 'was', 'what', 'wie', 'with', 'you',
  'zum', 'zur',
])

function terms(value: string) {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
    .filter((term) => !STOP_WORDS.has(term))
}

function splitSource(source: Source): SourceChunk[] {
  const normalized = source.content.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
  if (!normalized) return []
  const paragraphs = normalized.split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/).filter(Boolean)
  const chunks: SourceChunk[] = []
  let current = ''
  const flush = () => {
    const text = current.trim()
    if (text) chunks.push({ sourceId: source.id, title: source.title, text, score: 0 })
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (paragraph.length > 1_200) {
      flush()
      for (let start = 0; start < paragraph.length; start += 1_050) {
        chunks.push({ sourceId: source.id, title: source.title, text: paragraph.slice(start, start + 1_200).trim(), score: 0 })
      }
    } else if (`${current} ${paragraph}`.length > 1_200) {
      flush()
      current = paragraph
    } else {
      current += `${current ? ' ' : ''}${paragraph}`
    }
  }
  flush()
  return chunks
}

export function retrieveChunks(sources: Source[], query: string, maxChars = 12_000) {
  const queryTerms = terms(query)
  const chunks = sources.filter((source) => source.selected && source.content.trim()).flatMap(splitSource)
  for (const chunk of chunks) {
    const haystack = `${chunk.title} ${chunk.text}`.toLocaleLowerCase()
    chunk.score = queryTerms.reduce((score, term) => {
      const matches = haystack.split(term).length - 1
      return score + Math.min(matches, 5) * (chunk.title.toLocaleLowerCase().includes(term) ? 4 : 1)
    }, 0)
  }
  chunks.sort((a, b) => b.score - a.score)
  const picked: SourceChunk[] = []
  const seen = new Set<string>()
  let usedChars = 0
  for (const chunk of chunks) {
    if (!seen.has(chunk.sourceId) && usedChars + chunk.text.length <= maxChars) {
      picked.push(chunk)
      seen.add(chunk.sourceId)
      usedChars += chunk.text.length
    }
  }
  for (const chunk of chunks) {
    if (picked.includes(chunk) || usedChars + chunk.text.length > maxChars) continue
    picked.push(chunk)
    usedChars += chunk.text.length
    if (picked.length >= 10) break
  }
  return picked
}

export function formatContext(chunks: SourceChunk[]) {
  return chunks.map((chunk) => `[SOURCE ${chunk.sourceId} | ${chunk.title}]\n${chunk.text}`).join('\n\n')
}
