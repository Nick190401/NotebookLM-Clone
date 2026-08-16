import type { Source } from '../../../supabase/functions/_shared/domain.ts'
import { bestExcerpt, formatContext, retrieveContext } from '../../../supabase/functions/_shared/retrieval.ts'

function source(id: string, content: string, selected = true, title = `Source ${id}`): Source {
  return { id, title, kind: 'text', origin: 'test', content, summary: '', topics: [], selected, createdAt: 1 }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('retrieval excludes unselected sources and ranks query matches', () => {
  const { chunks } = retrieveContext(
    [
      source('selected', 'Transit reliability and timetable coordination improve public trust.'),
      source('unselected', 'Transit reliability appears here too.', false),
    ],
    'transit reliability',
  )
  assert(chunks.length > 0, 'expected at least one result')
  assert(
    chunks.every((chunk) => chunk.sourceId === 'selected'),
    'unselected source leaked into retrieval',
  )
})

Deno.test('every selected source contributes a passage before depth is added', () => {
  const sources = Array.from({ length: 18 }, (_, index) =>
    source(`source-${index}`, `Battery research note ${index}. Electrolyte stability matters here. `.repeat(40)),
  )
  const { chunks, usedSourceIds, omittedSourceIds } = retrieveContext(sources, 'battery electrolyte')
  assert(usedSourceIds.length === 18, `only ${usedSourceIds.length} of 18 sources reached the context`)
  assert(omittedSourceIds.length === 0, 'a selected source was silently dropped')
  assert(chunks.length >= 18, 'context lost passages')
})

Deno.test('a source that cannot fit is reported instead of vanishing', () => {
  const sources = Array.from({ length: 6 }, (_, index) =>
    source(`source-${index}`, `Evidence body ${index}. `.repeat(120)),
  )
  const { usedSourceIds, omittedSourceIds } = retrieveContext(sources, 'evidence', { maxChars: 1_500 })
  assert(usedSourceIds.length >= 1, 'no source was retrieved')
  assert(usedSourceIds.length + omittedSourceIds.length === 6, 'coverage accounting lost a source')
  assert(omittedSourceIds.length > 0, 'expected the tight budget to omit sources')
})

Deno.test('BM25 ranks the rare discriminating term above a repeated common one', () => {
  const { chunks } = retrieveContext(
    [
      source('common', 'Energy energy energy energy energy. '.repeat(20)),
      source('rare', 'The electrolyzer reached 17 megawatt of installed capacity.'),
    ],
    'electrolyzer megawatt',
  )
  assert(chunks[0].sourceId === 'rare', 'BM25 did not prefer the discriminating passage')
})

Deno.test('a query term does not score on a longer word that merely contains it', () => {
  const { chunks } = retrieveContext(
    [
      source('substring', 'The automobile industry expanded steadily. '.repeat(20)),
      source('exact', 'The auto arrived on time.'),
    ],
    'auto',
  )
  const substringScore = chunks
    .filter((chunk) => chunk.sourceId === 'substring')
    .reduce((highest, chunk) => Math.max(highest, chunk.score), 0)
  assert(substringScore === 0, `"automobile" scored ${substringScore} for the query term "auto"`)
  assert(chunks[0].sourceId === 'exact', 'the exact token match did not rank first')
})

Deno.test('the phrase bonus needs adjacent tokens, not a substring spanning a word boundary', () => {
  const { chunks } = retrieveContext(
    [source('spanning', 'Every start working day begins here.'), source('adjacent', 'The art work was catalogued.')],
    'art work',
  )
  const spanning = chunks.find((chunk) => chunk.sourceId === 'spanning')
  assert(spanning?.score === 0, `"start working" earned a phrase bonus for the query "art work"`)
  assert(chunks[0].sourceId === 'adjacent', 'the genuinely adjacent phrase did not rank first')
})

Deno.test('expanded terms rank a synonym passage the literal query never matches', () => {
  const sources = [
    source('unrelated', 'Timetable coordination reduced missed connections. '.repeat(30)),
    source('synonym', 'Der Betrieb ist teuer und verursacht hohe Ausgaben pro Kilometer.'),
  ]
  const withoutExpansion = retrieveContext(sources, 'Kosten')
  const withExpansion = retrieveContext(sources, 'Kosten', { expandedTerms: ['teuer', 'Ausgaben'] })
  assert(
    withoutExpansion.chunks.every((chunk) => chunk.score === 0),
    'test premise broken: the literal query already matched a passage',
  )
  assert(withExpansion.chunks[0]?.sourceId === 'synonym', 'query expansion did not rank the synonym passage first')
})

Deno.test('a title match lifts a source that matches the query by name', () => {
  const { chunks } = retrieveContext(
    [
      source('body', 'Generic filler about unrelated matters. '.repeat(20)),
      source('titled', 'Generic filler about unrelated matters.', true, 'Offshore wind auction results'),
    ],
    'offshore wind auction',
  )
  assert(chunks[0].sourceId === 'titled', 'title relevance was ignored')
})

Deno.test('overlapping chunks keep a fact readable across a paragraph cut', () => {
  const body = `${'Filler sentence about the programme. '.repeat(30)}The rebate equals 240 euro per household. ${'Trailing detail follows here. '.repeat(30)}`
  const { chunks } = retrieveContext([source('long', body)], 'rebate euro household')
  assert(
    chunks.some((chunk) => chunk.text.includes('240 euro per household')),
    'the fact was lost between chunks',
  )
})

Deno.test('the context budget is respected and passages are numbered for citation', () => {
  const { chunks } = retrieveContext([source('bounded', 'Evidence sentence. '.repeat(300))], 'evidence', {
    maxChars: 1_500,
  })
  assert(chunks.reduce((total, chunk) => total + chunk.text.length, 0) <= 1_500, 'context budget exceeded')
  const context = formatContext(chunks)
  assert(
    context.startsWith('[1] Source bounded (sourceId: bounded)'),
    `unexpected context header: ${context.slice(0, 60)}`,
  )
  assert(!context.includes(`[${chunks.length + 1}]`), 'context numbered a passage that does not exist')
})

Deno.test('redundant passages do not consume the depth budget twice', () => {
  const repeated = 'Identical evidence paragraph about solar capacity growth in coastal regions.\n\n'
  const { chunks } = retrieveContext([source('dupe', repeated.repeat(12))], 'solar capacity growth')
  assert(chunks.length <= 2, `near-duplicate passages were not collapsed (${chunks.length} kept)`)
})

Deno.test('the excerpt picks the sentence that matches the answer statement', () => {
  const chunk = {
    sourceId: 'a',
    title: 'Source a',
    text: 'Wind capacity grew steadily. The average turbine output was 17 megawatt per unit. Maintenance costs fell.',
    score: 1,
  }
  const excerpt = bestExcerpt(chunk, 'The average turbine output reached 17 megawatt.')
  assert(excerpt.includes('17 megawatt'), `excerpt missed the cited sentence: ${excerpt}`)
})
