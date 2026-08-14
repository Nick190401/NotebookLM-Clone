import { describe, expect, it } from 'vitest'
import { locateCitation } from '../../src/lib/citation'

describe('citation location', () => {
  it('finds an exact excerpt without changing the original offsets', () => {
    const content = 'Opening context. Reliable service improved public trust. Closing context.'

    expect(locateCitation(content, 'Reliable service improved public trust.')).toEqual({ start: 17, end: 56 })
  })

  it('matches citation whitespace while preserving the source range', () => {
    const content = 'First paragraph.\n\nTimetable coordination\nreduced missed connections.'
    const location = locateCitation(content, 'Timetable coordination reduced missed connections.')

    expect(location && content.slice(location.start, location.end)).toBe('Timetable coordination\nreduced missed connections.')
  })

  it('does not highlight an unsupported excerpt', () => {
    expect(locateCitation('Grounded source text.', 'Invented evidence.')).toBeNull()
  })
})
