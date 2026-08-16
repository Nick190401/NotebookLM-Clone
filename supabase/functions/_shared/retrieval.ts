import type { Source } from './domain.ts'

export interface SourceChunk {
  sourceId: string
  title: string
  text: string
  score: number
}

export interface RetrievedContext {
  /** Ordered chunks. The reference number handed to the model is `index + 1`. */
  chunks: SourceChunk[]
  usedSourceIds: string[]
  omittedSourceIds: string[]
}

export interface RetrievalOptions {
  maxChars?: number
  maxChunks?: number
  /** Related terms from query expansion; scored below the literal query terms. */
  expandedTerms?: string[]
}

const STOP_WORDS = new Set([
  'aber',
  'about',
  'after',
  'alle',
  'also',
  'and',
  'are',
  'auch',
  'auf',
  'aus',
  'bei',
  'das',
  'dass',
  'dem',
  'den',
  'der',
  'des',
  'die',
  'durch',
  'ein',
  'eine',
  'einer',
  'eines',
  'from',
  'für',
  'hat',
  'have',
  'how',
  'ich',
  'ist',
  'its',
  'mit',
  'nach',
  'nicht',
  'oder',
  'sich',
  'sind',
  'that',
  'the',
  'their',
  'these',
  'this',
  'über',
  'und',
  'von',
  'was',
  'werden',
  'what',
  'which',
  'wie',
  'with',
  'you',
  'zum',
  'zur',
])

const TOKEN_PATTERN = /[\p{L}\p{N}]{2,}/gu
const CHUNK_TARGET_CHARS = 900
const CHUNK_MAX_CHARS = 1_200
const CHUNK_OVERLAP_CHARS = 150
const BM25_K1 = 1.5
const BM25_B = 0.75
const EXPANDED_TERM_WEIGHT = 0.45
const TITLE_MATCH_WEIGHT = 0.8
const PHRASE_BONUS = 1.6
const REDUNDANCY_THRESHOLD = 0.72

function tokenize(value: string) {
  return (value.toLocaleLowerCase().match(TOKEN_PATTERN) ?? []).filter((token) => !STOP_WORDS.has(token))
}

function uniqueTokens(value: string) {
  return [...new Set(tokenize(value))]
}

function overlapTail(text: string) {
  if (text.length <= CHUNK_OVERLAP_CHARS) return text
  const tail = text.slice(-CHUNK_OVERLAP_CHARS)
  const boundary = tail.search(/\s/)
  return boundary >= 0 ? tail.slice(boundary + 1) : tail
}

function splitSource(source: Source): SourceChunk[] {
  const normalized = source.content
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const chunks: SourceChunk[] = []
  const push = (text: string) => {
    const clean = text.trim()
    if (clean) chunks.push({ sourceId: source.id, title: source.title, text: clean, score: 0 })
  }

  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_MAX_CHARS) {
      if (current) push(current)
      current = ''
      for (let start = 0; start < paragraph.length; start += CHUNK_TARGET_CHARS) {
        push(paragraph.slice(start, start + CHUNK_MAX_CHARS))
      }
      continue
    }
    const candidate = current ? `${current} ${paragraph}` : paragraph
    if (candidate.length > CHUNK_TARGET_CHARS && current) {
      push(current)
      // The carried tail keeps a fact that straddles the cut readable in both chunks.
      current = `${overlapTail(current)} ${paragraph}`.trim()
      continue
    }
    current = candidate
  }
  if (current) push(current)
  return chunks
}

interface ScoredChunk extends SourceChunk {
  frequencies: Map<string, number>
  bigrams: Set<string>
  length: number
}

/** Term counts and adjacent pairs come from one tokenizer pass, so scoring never rescans the text. */
function toScoredChunk(chunk: SourceChunk): ScoredChunk {
  const tokens = tokenize(chunk.text)
  const frequencies = new Map<string, number>()
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  const bigrams = new Set<string>()
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    bigrams.add(`${tokens[index]} ${tokens[index + 1]}`)
  }
  return { ...chunk, frequencies, bigrams, length: tokens.length }
}

function bm25Scores(chunks: ScoredChunk[], terms: { term: string; weight: number }[]) {
  const totalChunks = chunks.length
  const averageLength = chunks.reduce((total, chunk) => total + chunk.length, 0) / Math.max(1, totalChunks)

  for (const { term, weight } of terms) {
    const documentFrequency = chunks.reduce((count, chunk) => count + (chunk.frequencies.has(term) ? 1 : 0), 0)
    if (documentFrequency === 0) continue
    const idf = Math.log(1 + (totalChunks - documentFrequency + 0.5) / (documentFrequency + 0.5))

    for (const chunk of chunks) {
      const frequency = chunk.frequencies.get(term) ?? 0
      if (frequency > 0) {
        const denominator = frequency + BM25_K1 * (1 - BM25_B + (BM25_B * chunk.length) / Math.max(1, averageLength))
        chunk.score += weight * idf * ((frequency * (BM25_K1 + 1)) / denominator)
      }
      // Titles match on substrings on purpose: a title says "Auctions" where the query says "auction".
      if (chunk.title.toLocaleLowerCase().includes(term)) {
        chunk.score += weight * idf * TITLE_MATCH_WEIGHT
      }
    }
  }
}

function applyPhraseBonus(chunks: ScoredChunk[], queryTerms: string[]) {
  const phrases: string[] = []
  for (let index = 0; index + 1 < queryTerms.length; index += 1) {
    phrases.push(`${queryTerms[index]} ${queryTerms[index + 1]}`)
  }
  if (!phrases.length) return
  for (const chunk of chunks) {
    for (const phrase of phrases) {
      if (chunk.bigrams.has(phrase)) chunk.score += PHRASE_BONUS
    }
  }
}

function jaccard(left: Map<string, number>, right: Map<string, number>) {
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const term of left.keys()) {
    if (right.has(term)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

export function retrieveContext(sources: Source[], query: string, options: RetrievalOptions = {}): RetrievedContext {
  const maxChars = options.maxChars ?? 18_000
  const maxChunks = options.maxChunks ?? 24
  const selected = sources.filter((source) => source.selected && source.content.trim())

  const chunks: ScoredChunk[] = selected.flatMap(splitSource).map(toScoredChunk)
  if (!chunks.length) return { chunks: [], usedSourceIds: [], omittedSourceIds: selected.map((source) => source.id) }

  const queryTerms = uniqueTokens(query)
  const expanded = [...new Set((options.expandedTerms ?? []).flatMap(uniqueTokens))].filter(
    (term) => !queryTerms.includes(term),
  )

  bm25Scores(chunks, [
    ...queryTerms.map((term) => ({ term, weight: 1 })),
    ...expanded.map((term) => ({ term, weight: EXPANDED_TERM_WEIGHT })),
  ])
  applyPhraseBonus(chunks, tokenize(query))

  const ranked = [...chunks].sort((left, right) => right.score - left.score || left.text.length - right.text.length)
  const picked: ScoredChunk[] = []
  const pickedIds = new Set<string>()
  let usedChars = 0

  const take = (chunk: ScoredChunk) => {
    picked.push(chunk)
    pickedIds.add(chunk.sourceId)
    usedChars += chunk.text.length
  }

  // Best passage per source first, so no source is dropped just because another dominates.
  for (const chunk of ranked) {
    if (pickedIds.has(chunk.sourceId)) continue
    if (usedChars + chunk.text.length > maxChars || picked.length >= maxChunks) break
    take(chunk)
  }

  // Remaining budget buys depth, skipping passages that mostly repeat existing context.
  for (const chunk of ranked) {
    if (picked.includes(chunk) || chunk.score <= 0) continue
    if (usedChars + chunk.text.length > maxChars || picked.length >= maxChunks) break
    if (picked.some((existing) => jaccard(existing.frequencies, chunk.frequencies) > REDUNDANCY_THRESHOLD)) continue
    take(chunk)
  }

  picked.sort((left, right) => right.score - left.score)
  const usedSourceIds = [...new Set(picked.map((chunk) => chunk.sourceId))]
  return {
    chunks: picked.map(({ sourceId, title, text, score }) => ({ sourceId, title, text, score })),
    usedSourceIds,
    omittedSourceIds: selected.map((source) => source.id).filter((id) => !usedSourceIds.includes(id)),
  }
}

/** Numbering is assigned here, not by the model, so every inline `[n]` resolves. */
export function formatContext(chunks: SourceChunk[]) {
  return chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.title} (sourceId: ${chunk.sourceId})\n${chunk.text}`)
    .join('\n\n')
}

/** Picks the sentence inside a cited passage that best matches the answer text. */
export function bestExcerpt(chunk: SourceChunk, answerContext: string, maxLength = 360) {
  const sentences =
    chunk.text
      .match(/[^.!?]+[.!?]*/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  if (!sentences.length) return chunk.text.slice(0, maxLength)
  const answerTerms = new Set(uniqueTokens(answerContext))
  if (!answerTerms.size) return sentences[0].slice(0, maxLength)

  let best = sentences[0]
  let bestScore = -1
  for (const sentence of sentences) {
    const terms = new Set(uniqueTokens(sentence))
    let shared = 0
    for (const term of terms) {
      if (answerTerms.has(term)) shared += 1
    }
    const score = shared / Math.sqrt(Math.max(1, terms.size))
    if (score > bestScore) {
      bestScore = score
      best = sentence
    }
  }
  return best.slice(0, maxLength)
}
