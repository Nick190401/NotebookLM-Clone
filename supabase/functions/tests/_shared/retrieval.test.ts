import type { Source } from '../../_shared/domain.ts'
import { formatContext, retrieveChunks } from '../../_shared/retrieval.ts'

function source(id: string, content: string, selected = true): Source {
  return { id, title: `Source ${id}`, kind: 'text', origin: 'test', content, summary: '', topics: [], selected, createdAt: 1 }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('retrieval excludes unselected sources and ranks query matches', () => {
  const chunks = retrieveChunks([
    source('selected', 'Transit reliability and timetable coordination improve public trust.'),
    source('unselected', 'Transit reliability appears here too.', false),
  ], 'transit reliability')
  assert(chunks.length > 0, 'expected at least one result')
  assert(chunks.every((chunk) => chunk.sourceId === 'selected'), 'unselected source leaked into retrieval')
})

Deno.test('retrieval gives multiple sources a chance before filling remaining context', () => {
  const chunks = retrieveChunks([
    source('a', 'Battery research is important. '.repeat(90)),
    source('b', 'Battery recycling closes material loops.'),
  ], 'battery', 4_000)
  assert(chunks.some((chunk) => chunk.sourceId === 'a'), 'first source missing')
  assert(chunks.some((chunk) => chunk.sourceId === 'b'), 'source diversity missing')
})

Deno.test('retrieval respects the character budget and emits source markers', () => {
  const chunks = retrieveChunks([source('bounded', 'Evidence sentence. '.repeat(300))], 'evidence', 1_500)
  assert(chunks.reduce((total, chunk) => total + chunk.text.length, 0) <= 1_500, 'context budget exceeded')
  const context = formatContext(chunks)
  assert(context.includes('[SOURCE bounded | Source bounded]'), 'source marker missing')
})
