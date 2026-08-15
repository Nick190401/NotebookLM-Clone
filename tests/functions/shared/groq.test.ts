import { concatenateWav, splitSpeechChunks, stripReasoning } from '../../../supabase/functions/_shared/groq.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function wav(dataBytes: number[]) {
  const bytes = new Uint8Array(44 + dataBytes.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + dataBytes.length, true)
  view.setUint32(40, dataBytes.length, true)
  bytes.set(dataBytes, 44)
  return bytes
}

Deno.test('reasoning blocks never reach stored source text', () => {
  assert(stripReasoning('<think>plan the answer</think>Real content.') === 'Real content.', 'closed think block survived')
  assert(stripReasoning('Answer first.<think>trailing reasoning') === 'Answer first.', 'unclosed think block survived')
  assert(stripReasoning('<think>only reasoning, truncated') === '', 'reasoning-only response should be empty')
  assert(stripReasoning('Plain text.') === 'Plain text.', 'plain text was altered')
})

Deno.test('speech chunks stay within the model input limit', () => {
  const narration = 'Alex explains the grid. '.repeat(60)
  const chunks = splitSpeechChunks(narration)
  assert(chunks.length > 1, 'long narration was not split')
  assert(chunks.every((chunk) => chunk.length <= 200), 'a chunk exceeded the 200 character limit')
  assert(chunks.join(' ').includes('Alex explains the grid.'), 'chunking lost narration text')
})

Deno.test('an oversized single sentence is split on word boundaries', () => {
  const chunks = splitSpeechChunks(`${'word '.repeat(120)}end`)
  assert(chunks.every((chunk) => chunk.length <= 200), 'word-level split exceeded the limit')
  assert(chunks.length > 1, 'oversized sentence was not split')
})

Deno.test('concatenated speech keeps one header and sums the payloads', () => {
  const merged = concatenateWav([wav([1, 2, 3, 4]), wav([5, 6])])
  assert(merged.byteLength === 44 + 6, `unexpected length ${merged.byteLength}`)
  const view = new DataView(merged.buffer)
  assert(view.getUint32(40, true) === 6, 'data chunk length was not rewritten')
  assert(view.getUint32(4, true) === 42, 'riff length was not rewritten')
  assert([...merged.subarray(44)].join(',') === '1,2,3,4,5,6', 'payload order changed')
})

Deno.test('concatenation ignores empty responses', () => {
  assert(concatenateWav([]).byteLength === 0, 'empty input produced audio')
  assert(concatenateWav([new Uint8Array(10)]).byteLength === 0, 'header-only input produced audio')
})
