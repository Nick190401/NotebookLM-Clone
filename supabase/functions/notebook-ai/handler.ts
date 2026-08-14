import { answerQuestion, discoverWebSources, generateArtifact, getAiStatus } from '../_shared/ai.ts'
import { sourceFromRow, type SourceRow } from '../_shared/domain.ts'
import { synthesizeSpeech } from '../_shared/groq.ts'
import { authenticatedContext, type AuthContext, corsHeaders, errorResponse, HttpError, jsonResponse, optionsResponse, supabaseRpc } from '../_shared/http.ts'
import { notebookAiRequestSchema } from '../_shared/schemas.ts'

async function notebookSources(
  context: AuthContext,
  notebookId: string,
  requestedIds: string[],
) {
  const sourceIds = [...new Set(requestedIds)]
  const data = await supabaseRpc<SourceRow[]>(context, 'load_ai_sources', {
    requested_notebook_id: notebookId,
    requested_source_ids: sourceIds,
  })
  if (data.length !== sourceIds.length) {
    throw new HttpError('One or more selected sources no longer exist in this notebook.', 'SOURCE_NOT_FOUND', 404)
  }
  return data.map(sourceFromRow).map((source) => ({ ...source, selected: true }))
}

export async function handleNotebookAiRequest(request: Request) {
  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, 405)

  try {
    const context = await authenticatedContext(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new HttpError('A valid JSON body is required.', 'INVALID_REQUEST', 400)
    }
    const parsed = notebookAiRequestSchema.safeParse(body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || 'Invalid request.', 'INVALID_REQUEST', 400)

    if (parsed.data.action === 'status') return jsonResponse(await getAiStatus())
    if (parsed.data.action === 'discover') {
      return jsonResponse({ results: await discoverWebSources(parsed.data.query, parsed.data.language) })
    }
    if (parsed.data.action === 'speech') {
      const audio = await synthesizeSpeech(parsed.data.text, parsed.data.voice)
      return new Response(audio, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/octet-stream', 'X-Audio-Type': 'audio/wav', 'Cache-Control': 'no-store' } })
    }

    const sources = await notebookSources(context, parsed.data.notebookId, parsed.data.sourceIds)
    if (parsed.data.action === 'chat') {
      return jsonResponse(await answerQuestion({
        message: parsed.data.message,
        sources,
        history: parsed.data.history,
        config: parsed.data.config,
        language: parsed.data.language,
      }))
    }

    return jsonResponse(await generateArtifact(parsed.data.type, sources, parsed.data.config))
  } catch (error) {
    return errorResponse(error)
  }
}
