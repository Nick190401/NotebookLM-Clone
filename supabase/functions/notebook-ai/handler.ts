import {
  answerQuestion,
  type AnswerEvent,
  deepResearchWebSources,
  discoverWebSources,
  generateArtifact,
  getAiStatus,
  streamGroundedAnswer,
} from '../_shared/ai.ts'
import { sourceFromRow, type SourceRow } from '../_shared/domain.ts'
import { synthesizeSpeech } from '../_shared/groq.ts'
import {
  authenticatedContext,
  type AuthContext,
  errorResponse,
  HttpError,
  jsonResponse,
  supabaseRpc,
  supabaseServiceRpc,
} from '../_shared/http.ts'
import { assertWithinBurstLimit, consumeQuota } from '../_shared/quota.ts'
import { notebookAiRequestSchema } from '../_shared/schemas.ts'

async function notebookSources(context: AuthContext, notebookId: string, requestedIds: string[], shareToken?: string) {
  const sourceIds = [...new Set(requestedIds)]
  const data = shareToken
    ? await supabaseServiceRpc<SourceRow[]>(context, 'load_shared_ai_sources', {
        requested_share_token: shareToken,
        requested_notebook_id: notebookId,
        requested_source_ids: sourceIds,
      })
    : await supabaseRpc<SourceRow[]>(context, 'load_ai_sources', {
        requested_notebook_id: notebookId,
        requested_source_ids: sourceIds,
      })
  if (data.length !== sourceIds.length) {
    throw new HttpError('One or more selected sources no longer exist in this notebook.', 'SOURCE_NOT_FOUND', 404)
  }
  return data.map(sourceFromRow).map((source) => ({ ...source, selected: true }))
}

function sseFrame(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`
}

async function* replay(buffered: AnswerEvent[], rest: AsyncGenerator<AnswerEvent>) {
  for (const event of buffered) yield event
  yield* rest
}

/**
 * Holds the response back until the provider has actually produced output, so a
 * rate limit or auth failure still surfaces as its real HTTP status instead of a
 * 200 with an error frame. Everything after that point streams.
 */
async function openEventStream(events: AsyncGenerator<AnswerEvent>) {
  const buffered: AnswerEvent[] = []
  for (;;) {
    const next = await events.next()
    if (next.done) break
    buffered.push(next.value)
    if (next.value.type === 'delta' || next.value.type === 'done') break
  }
  return streamResponse(replay(buffered, events))
}

/**
 * Once the stream is open the status is already committed, so a late failure is
 * delivered as a terminal `error` event instead.
 */
function streamResponse(events: AsyncGenerator<AnswerEvent>) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(sseFrame(event)))
        }
      } catch (error) {
        const detail =
          error instanceof HttpError
            ? { code: error.code, message: error.message }
            : { code: 'INTERNAL_ERROR', message: 'The AI stream ended unexpectedly.' }
        console.error('Chat stream aborted', JSON.stringify(detail))
        controller.enqueue(encoder.encode(sseFrame({ type: 'error', error: detail })))
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  })
}

export async function handleNotebookAiRequest(request: Request) {
  if (request.method !== 'POST')
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, 405)

  try {
    assertWithinBurstLimit(request)
    const context = await authenticatedContext(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new HttpError('A valid JSON body is required.', 'INVALID_REQUEST', 400)
    }
    const parsed = notebookAiRequestSchema.safeParse(body)
    if (!parsed.success)
      throw new HttpError(parsed.error.issues[0]?.message || 'Invalid request.', 'INVALID_REQUEST', 400)

    if (parsed.data.action === 'status') return jsonResponse(await getAiStatus())
    if (parsed.data.action === 'discover') {
      await consumeQuota(context, 'discover')
      return jsonResponse({ results: await discoverWebSources(parsed.data.query, parsed.data.language) })
    }
    if (parsed.data.action === 'research') {
      await consumeQuota(context, 'research')
      return jsonResponse(await deepResearchWebSources(parsed.data.query, parsed.data.language))
    }
    if (parsed.data.action === 'speech') {
      await consumeQuota(context, 'speech')
      const audio = await synthesizeSpeech(parsed.data.text, parsed.data.voice)
      return new Response(audio, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Audio-Type': 'audio/wav',
          'Cache-Control': 'no-store',
        },
      })
    }

    await consumeQuota(context, parsed.data.action === 'chat' ? 'chat' : 'artifact')
    const sources = await notebookSources(
      context,
      parsed.data.notebookId,
      parsed.data.sourceIds,
      parsed.data.action === 'chat' ? parsed.data.shareToken : undefined,
    )
    if (parsed.data.action === 'chat') {
      const chatRequest = {
        message: parsed.data.message,
        sources,
        history: parsed.data.history,
        config: parsed.data.config,
        language: parsed.data.language,
      }
      return parsed.data.stream
        ? await openEventStream(streamGroundedAnswer(chatRequest))
        : jsonResponse(await answerQuestion(chatRequest))
    }

    return jsonResponse(await generateArtifact(parsed.data.type, sources, parsed.data.config))
  } catch (error) {
    return errorResponse(error)
  }
}
