export interface CitationLocation {
  start: number
  end: number
}

interface NormalizedText {
  value: string
  starts: number[]
  ends: number[]
}

function normalizeWithOffsets(value: string): NormalizedText {
  const characters: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let whitespaceStart = -1

  const appendWhitespace = (end: number) => {
    if (whitespaceStart < 0 || characters.length === 0) return
    characters.push(' ')
    starts.push(whitespaceStart)
    ends.push(end)
  }

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (/\s/.test(character)) {
      if (whitespaceStart < 0) whitespaceStart = index
      continue
    }

    appendWhitespace(index)
    whitespaceStart = -1
    characters.push(character)
    starts.push(index)
    ends.push(index + 1)
  }

  return { value: characters.join(''), starts, ends }
}

export function locateCitation(content: string, excerpt: string): CitationLocation | null {
  const cleanExcerpt = excerpt.trim()
  if (!content || !cleanExcerpt) return null

  const exactStart = content.toLocaleLowerCase().indexOf(cleanExcerpt.toLocaleLowerCase())
  if (exactStart >= 0) return { start: exactStart, end: exactStart + cleanExcerpt.length }

  const normalizedContent = normalizeWithOffsets(content)
  const normalizedExcerpt = normalizeWithOffsets(cleanExcerpt).value
  const normalizedStart = normalizedContent.value.toLocaleLowerCase().indexOf(normalizedExcerpt.toLocaleLowerCase())
  if (normalizedStart < 0 || normalizedExcerpt.length === 0) return null

  const normalizedEnd = normalizedStart + normalizedExcerpt.length - 1
  return {
    start: normalizedContent.starts[normalizedStart],
    end: normalizedContent.ends[normalizedEnd],
  }
}
