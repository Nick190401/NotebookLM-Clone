import { GROQ_MODELS, groqFetch } from './groq.ts'

const EXPANSION_TIMEOUT_MS = 6_000
const MAX_TERMS = 12

/**
 * Lexical ranking cannot connect "Kosten" to "teuer", so one fast model call derives
 * related surface forms, scored below the literal query terms during retrieval.
 * Any failure resolves to no expansion: retrieval must never break because of this.
 */
export async function expandQuery(query: string, language: 'English' | 'Deutsch'): Promise<string[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []

  try {
    const response = await groqFetch('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(EXPANSION_TIMEOUT_MS),
      body: JSON.stringify({
        model: GROQ_MODELS.fast,
        temperature: 0,
        max_completion_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: `Return JSON {"terms":[...]} with up to ${MAX_TERMS} single words or short noun phrases that documents answering this question would plausibly use: synonyms, inflections, domain terms, and the ${language === 'Deutsch' ? 'German and English' : 'English and German'} equivalents. No explanations.\n\nQUESTION: ${trimmed}`,
          },
        ],
      }),
    })
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = body.choices?.[0]?.message?.content
    if (!content) return []
    const parsed = JSON.parse(content) as { terms?: unknown }
    if (!Array.isArray(parsed.terms)) return []
    return parsed.terms
      .filter((term): term is string => typeof term === 'string')
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && term.length <= 60)
      .slice(0, MAX_TERMS)
  } catch {
    return []
  }
}
