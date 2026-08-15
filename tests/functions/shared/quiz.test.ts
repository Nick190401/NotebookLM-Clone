import type { ArtifactContent } from '../../../supabase/functions/_shared/domain.ts'
import { shuffleQuizOptions } from '../../../supabase/functions/_shared/ai.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function quiz(questionCount: number): ArtifactContent {
  return {
    summary: '', sections: [], cards: [], nodes: [], slides: [], columns: [], rows: [], metrics: [], transcript: [], narration: '',
    questions: Array.from({ length: questionCount }, (_, index) => ({
      question: `Question ${index}`,
      options: [`correct-${index}`, `wrong-a-${index}`, `wrong-b-${index}`, `wrong-c-${index}`],
      correctIndex: 0,
      explanation: '',
      sourceId: 'source-1',
    })),
  }
}

Deno.test('shuffling keeps the correct answer pointing at the same option', () => {
  const shuffled = shuffleQuizOptions(quiz(25))
  shuffled.questions.forEach((question, index) => {
    assert(question.options[question.correctIndex] === `correct-${index}`, `question ${index} lost its answer`)
    assert(question.options.length === 4, `question ${index} lost options`)
    assert(new Set(question.options).size === 4, `question ${index} duplicated an option`)
  })
})

Deno.test('the correct answer no longer sits in the first slot every time', () => {
  const shuffled = shuffleQuizOptions(quiz(60))
  const alwaysFirst = shuffled.questions.every((question) => question.correctIndex === 0)
  assert(!alwaysFirst, 'every correct answer is still at position 0')
  const positions = new Set(shuffled.questions.map((question) => question.correctIndex))
  assert(positions.size > 1, 'correct answers only ever land on one position')
})

Deno.test('a question with an out-of-range answer index is left untouched', () => {
  const broken = quiz(1)
  broken.questions[0].correctIndex = 9
  const shuffled = shuffleQuizOptions(broken)
  assert(shuffled.questions[0].correctIndex === 9, 'invalid question was rewritten')
  assert(shuffled.questions[0].options[0] === 'correct-0', 'invalid question was reordered')
})
