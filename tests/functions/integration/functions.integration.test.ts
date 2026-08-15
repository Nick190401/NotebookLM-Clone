import { withCors } from '../../../supabase/functions/_shared/http.ts'
import { handleNotebookAiRequest } from '../../../supabase/functions/notebook-ai/handler.ts'
import { handleSourceImportRequest } from '../../../supabase/functions/source-import/handler.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://function.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function withFunctionEnvironment<T>(run: () => Promise<T>) {
  const names = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GROQ_API_KEY',
    'ALLOWED_ORIGINS',
  ] as const
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]))
  const previousFetch = globalThis.fetch
  Deno.env.set('SUPABASE_URL', 'https://project.supabase.co')
  Deno.env.set('SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  Deno.env.set('GROQ_API_KEY', 'groq-test-key')
  Deno.env.delete('ALLOWED_ORIGINS')
  return run().finally(() => {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) Deno.env.delete(name)
      else Deno.env.set(name, value)
    }
    globalThis.fetch = previousFetch
  })
}

const quotaAllowed = () =>
  Response.json({ allowed: true, bucket: 'chat', limit: 60, remaining: 59, retryAfterSeconds: 0 })

/** Mirrors the Groq server-sent event transport the chat path consumes. */
function groqStream(text: string, model = 'openai/gpt-oss-120b') {
  const encoder = new TextEncoder()
  const words = text.split(/(?<=\s)/)
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const word of words) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ model, choices: [{ delta: { content: word } }] })}\n\n`),
          )
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function isExpansionCall(body: Record<string, unknown>) {
  return (body.response_format as { type?: string } | undefined)?.type === 'json_object'
}

const expansionResponse = () =>
  Response.json({ choices: [{ message: { content: JSON.stringify({ terms: ['reliability'] }) } }] })

async function readSse(response: Response) {
  const events: Record<string, unknown>[] = []
  const text = await response.text()
  for (const frame of text.split('\n\n')) {
    const line = frame.split('\n').find((entry) => entry.startsWith('data:'))
    if (!line) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    events.push(JSON.parse(payload) as Record<string, unknown>)
  }
  return events
}

Deno.test('notebook AI status validates auth without exposing the Groq key', () =>
  withFunctionEnvironment(async () => {
    globalThis.fetch = (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
      if (url.endsWith('/openai/v1/models')) return Promise.resolve(Response.json({ data: [] }))
      throw new Error(`Unexpected request: ${url}`)
    }
    const response = await handleNotebookAiRequest(jsonRequest({ action: 'status' }))
    const body = await response.json()
    assert(response.status === 200 && body.configured === true, 'AI status failed')
    assert(!JSON.stringify(body).includes('groq-test-key'), 'Groq key leaked into status response')
  }),
)

Deno.test('notebook AI status reports an unauthorized Groq key as unconfigured', () =>
  withFunctionEnvironment(async () => {
    globalThis.fetch = (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
      if (url.endsWith('/openai/v1/models'))
        return Promise.resolve(Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 }))
      throw new Error(`Unexpected request: ${url}`)
    }
    const response = await handleNotebookAiRequest(jsonRequest({ action: 'status' }))
    const body = await response.json()
    assert(response.status === 200 && body.configured === false, 'Invalid Groq key was reported as configured')
  }),
)

Deno.test('status does not consume the caller quota', () =>
  withFunctionEnvironment(async () => {
    let quotaCalls = 0
    globalThis.fetch = (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
      if (url.endsWith('/rest/v1/rpc/consume_ai_quota')) {
        quotaCalls += 1
        return Promise.resolve(quotaAllowed())
      }
      if (url.endsWith('/openai/v1/models')) return Promise.resolve(Response.json({ data: [] }))
      throw new Error(`Unexpected request: ${url}`)
    }
    await handleNotebookAiRequest(jsonRequest({ action: 'status' }))
    assert(quotaCalls === 0, 'a free status check consumed quota')
  }),
)

Deno.test('an exhausted quota refuses the request before any provider or source access', () =>
  withFunctionEnvironment(async () => {
    let providerCalled = false
    let sourcesLoaded = false
    globalThis.fetch = (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
      if (url.endsWith('/rest/v1/rpc/consume_ai_quota')) {
        return Promise.resolve(
          Response.json({ allowed: false, bucket: 'chat', limit: 60, remaining: 0, retryAfterSeconds: 1200 }),
        )
      }
      if (url.endsWith('/rest/v1/rpc/load_ai_sources')) sourcesLoaded = true
      if (url.includes('api.groq.com')) providerCalled = true
      throw new Error(`Unexpected request: ${url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        message: 'Burn the budget',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    const body = await response.json()
    assert(
      response.status === 429 && body.error?.code === 'QUOTA_EXCEEDED',
      `quota was not enforced (${response.status})`,
    )
    assert(response.headers.get('Retry-After') === '1200', 'retry hint missing')
    assert(!providerCalled, 'the provider was called despite an exhausted quota')
    assert(!sourcesLoaded, 'sources were loaded despite an exhausted quota')
  }),
)

Deno.test('Groq rate-limit text is normalized to a retry header', () =>
  withFunctionEnvironment(async () => {
    globalThis.fetch = (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
      if (url.endsWith('/rest/v1/rpc/consume_ai_quota')) return Promise.resolve(quotaAllowed())
      if (url.endsWith('/chat/completions')) {
        return Promise.resolve(
          Response.json(
            {
              error: { message: 'Rate limit reached. Please try again in 11.018s.' },
            },
            { status: 429 },
          ),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'discover',
        query: 'Current transit reliability',
        language: 'English',
      }),
    )
    assert(response.status === 429, 'Groq rate limit did not retain HTTP 429')
    assert(response.headers.get('Retry-After') === '12', 'Groq text retry hint was not normalized')
  }),
)

Deno.test('grounded chat loads sources through the caller-bound RPC and cites inline', () =>
  withFunctionEnvironment(async () => {
    const calls: string[] = []
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      calls.push(request.url)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
        assert(request.headers.get('Authorization') === 'Bearer user-jwt', 'RPC lost the caller JWT')
        return Response.json([
          {
            id: 'source-a',
            title: 'Evidence',
            kind: 'text',
            origin: 'test',
            content: 'Reliable ten-minute service improved public trust.',
            summary: '',
            topics: [],
            selected: true,
            created_at: '2026-08-14T00:00:00.000Z',
          },
        ])
      }
      if (request.url.endsWith('/chat/completions')) {
        const body = (await request.json()) as Record<string, unknown>
        if (isExpansionCall(body)) return expansionResponse()
        assert(body.stream === true, 'chat did not request a streamed completion')
        return groqStream('Reliability improved public trust. [1]')
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        message: 'What improved trust?',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    const body = await response.json()
    assert(response.status === 200, `chat returned ${response.status}`)
    assert(body.content.includes('[1]'), 'inline citation marker missing from the answer')
    assert(body.citations[0]?.sourceId === 'source-a' && body.citations[0]?.label === 1, 'grounded citation missing')
    assert(body.citations[0]?.excerpt.includes('public trust'), 'citation excerpt was not taken from the passage')
    assert(
      calls.some((url) => url.endsWith('/rest/v1/rpc/load_ai_sources')),
      'source RPC was not used',
    )
  }),
)

Deno.test('a citation number the context never contained is not turned into a source', () =>
  withFunctionEnvironment(async () => {
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
        return Response.json([
          {
            id: 'source-a',
            title: 'Evidence',
            kind: 'text',
            origin: 'test',
            content: 'Only one passage exists here.',
            summary: '',
            topics: [],
            selected: true,
            created_at: '2026-08-14T00:00:00.000Z',
          },
        ])
      }
      if (request.url.endsWith('/chat/completions')) {
        const body = (await request.json()) as Record<string, unknown>
        if (isExpansionCall(body)) return expansionResponse()
        return groqStream('Invented support for the claim. [9]')
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        message: 'What is supported?',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    const body = await response.json()
    assert(body.citations.length === 0, 'a hallucinated passage number produced a citation')
  }),
)

Deno.test('streamed chat emits coverage, deltas and a terminal citation event', () =>
  withFunctionEnvironment(async () => {
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
        return Response.json([
          {
            id: 'source-a',
            title: 'Evidence',
            kind: 'text',
            origin: 'test',
            content: 'Reliable ten-minute service improved public trust.',
            summary: '',
            topics: [],
            selected: true,
            created_at: '2026-08-14T00:00:00.000Z',
          },
        ])
      }
      if (request.url.endsWith('/chat/completions')) {
        const body = (await request.json()) as Record<string, unknown>
        if (isExpansionCall(body)) return expansionResponse()
        return groqStream('Reliability improved public trust. [1]')
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        stream: true,
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        message: 'What improved trust?',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    assert(response.headers.get('Content-Type')?.includes('text/event-stream'), 'stream content type missing')
    const events = await readSse(response)
    const context = events.find((event) => event.type === 'context') as { usedSourceIds?: string[] } | undefined
    const deltas = events.filter((event) => event.type === 'delta') as { text: string }[]
    const done = events.find((event) => event.type === 'done') as { citations?: { label: number }[] } | undefined
    assert(context?.usedSourceIds?.[0] === 'source-a', 'coverage event missing')
    assert(deltas.length > 1, 'the answer was not streamed incrementally')
    assert(
      deltas
        .map((event) => event.text)
        .join('')
        .includes('public trust'),
      'streamed text was lost',
    )
    assert(done?.citations?.[0]?.label === 1, 'terminal citation event missing')
  }),
)

Deno.test('reasoning never reaches the streamed answer', () =>
  withFunctionEnvironment(async () => {
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
        return Response.json([
          {
            id: 'source-a',
            title: 'Evidence',
            kind: 'text',
            origin: 'test',
            content: 'Reliable service improved public trust.',
            summary: '',
            topics: [],
            selected: true,
            created_at: '2026-08-14T00:00:00.000Z',
          },
        ])
      }
      if (request.url.endsWith('/chat/completions')) {
        const body = (await request.json()) as Record<string, unknown>
        if (isExpansionCall(body)) return expansionResponse()
        return groqStream('<think>Plan the answer carefully.</think>Service reliability improved trust. [1]')
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        message: 'What improved trust?',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    const body = await response.json()
    assert(!body.content.includes('Plan the answer'), 'model reasoning leaked into the answer')
    assert(body.content.includes('Service reliability improved trust.'), 'answer text was lost')
  }),
)

Deno.test('artifact generation forwards the selected format into the grounded prompt', () =>
  withFunctionEnvironment(async () => {
    let systemPrompt = ''
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
        return Response.json([
          {
            id: 'source-a',
            title: 'Evidence',
            kind: 'text',
            origin: 'test',
            content: 'A root concept connects two grounded findings.',
            summary: '',
            topics: [],
            selected: true,
            created_at: '2026-08-14T00:00:00.000Z',
          },
        ])
      }
      if (request.url.endsWith('/chat/completions')) {
        const body = (await request.json()) as {
          response_format?: { type?: string }
          messages?: { role?: string; content?: string }[]
        }
        if (isExpansionCall(body as Record<string, unknown>)) return expansionResponse()
        systemPrompt = body.messages?.find((message) => message.role === 'system')?.content ?? ''
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Grounded map',
                  sections: [],
                  cards: [],
                  questions: [],
                  slides: [],
                  columns: [],
                  rows: [],
                  metrics: [],
                  transcript: [],
                  narration: '',
                  nodes: [
                    { id: 'root', label: 'Root', parentId: '', sourceId: 'source-a' },
                    { id: 'one', label: 'Finding one', parentId: 'root', sourceId: 'source-a' },
                    { id: 'two', label: 'Finding two', parentId: 'root', sourceId: 'source-a' },
                  ],
                }),
              },
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }

    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'artifact',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        type: 'mindmap',
        config: { focus: 'Service dependencies', language: 'English', format: 'Radial map' },
      }),
    )
    assert(response.status === 200, `artifact returned ${response.status}`)
    assert(systemPrompt.includes('Format: Radial map.'), 'Selected artifact format was omitted from the Groq prompt')
    assert(
      systemPrompt.includes('Focus: Service dependencies.'),
      'Custom artifact focus was omitted from the Groq prompt',
    )
  }),
)

Deno.test('shared chat loads sources only through the token-bound RPC', () =>
  withFunctionEnvironment(async () => {
    let rpcBody: Record<string, unknown> | undefined
    let rpcKey: string | null = null
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'viewer-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_shared_ai_sources')) {
        rpcKey = request.headers.get('apikey')
        rpcBody = await request.json()
        return Response.json([
          {
            id: 'source-a',
            title: 'Shared evidence',
            kind: 'text',
            origin: 'test',
            content: 'Token-bound evidence supports the shared answer.',
            summary: '',
            topics: [],
            selected: true,
            created_at: '2026-08-14T00:00:00.000Z',
          },
        ])
      }
      if (request.url.endsWith('/chat/completions')) {
        const body = (await request.json()) as Record<string, unknown>
        if (isExpansionCall(body)) return expansionResponse()
        return groqStream('The evidence is token-bound. [1]')
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }

    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        shareToken: '33333333-3333-4333-8333-333333333333',
        message: 'What is protected?',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    assert(response.status === 200, `shared chat returned ${response.status}`)
    assert(rpcBody?.requested_share_token === '33333333-3333-4333-8333-333333333333', 'share token was not forwarded')
    assert(rpcBody?.requested_notebook_id === 'notebook-a', 'shared notebook id was not forwarded')
    assert(rpcKey === 'service-role-test-key', 'unredacted shared source text was read with a browser-reachable key')
  }),
)

Deno.test('deep research returns only deduplicated sources observed by Groq web tools', () =>
  withFunctionEnvironment(async () => {
    const scoutRequests: Record<string, unknown>[] = []
    let synthesisRequest: Record<string, unknown> | undefined
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'researcher-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/chat/completions')) {
        const requestBody = (await request.json()) as Record<string, unknown>
        const tools = requestBody.tools as { type?: string }[] | undefined
        if (!tools?.some((tool) => tool.type === 'browser_search')) {
          synthesisRequest = requestBody
          return Response.json({
            model: 'openai/gpt-oss-120b',
            choices: [
              { message: { content: '## Executive summary\nVerified transit evidence from the supplied sources.' } },
            ],
          })
        }
        scoutRequests.push(requestBody)
        return Response.json({
          model: requestBody.model,
          choices: [
            {
              message: {
                content: 'Verified transit evidence, plus a hallucinated link to https://fake.example.',
                executed_tools: [
                  {
                    type: 'browser_search',
                    browser_results: [
                      {
                        title: 'Primary transit study',
                        url: 'https://research.example/study#findings',
                        content: 'The study measured service reliability.',
                        score: 0.94,
                      },
                      {
                        title: 'Primary transit study duplicate',
                        url: 'https://research.example/study',
                        content: 'Duplicate result.',
                        score: 0.81,
                      },
                      {
                        title: 'Transport authority',
                        url: 'https://authority.example/report',
                        content: 'The authority published network performance.',
                        score: 0.89,
                      },
                      {
                        title: 'Unsafe scheme',
                        url: 'ftp://files.example/report',
                        content: 'Not importable.',
                        score: 1,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }

    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'research',
        query: 'How does service reliability affect public trust?',
        language: 'English',
      }),
    )
    const body = await response.json()
    assert(response.status === 200, `research returned ${response.status}`)
    assert(body.report.includes('Executive summary'), 'research report missing')
    assert(body.results.length === 2, 'tool results were not deduplicated or filtered')
    assert(body.results[0]?.url === 'https://research.example/study', 'URL fragment was not canonicalized')
    assert(
      !JSON.stringify(body.results).includes('fake.example'),
      'model-authored URL escaped the tool evidence boundary',
    )
    assert(body.toolCount === 2, 'research action count missing')
    assert(scoutRequests.length === 2, 'deep research did not investigate two independent angles')
    assert(
      JSON.stringify(scoutRequests.map((request) => request.model)) ===
        JSON.stringify(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']),
      'research scouts did not split model budgets',
    )
    for (const request of scoutRequests) {
      assert(request.max_completion_tokens === 800, 'research scout exceeded the provider-safe output budget')
      assert(request.reasoning_effort === 'low', 'browser research did not use the efficient reasoning budget')
      assert(request.tool_choice === 'required', 'browser research did not require a tool call')
    }
    assert(
      JSON.stringify(synthesisRequest).includes('https://research.example/study'),
      'synthesis did not receive verified sources',
    )
    assert(!JSON.stringify(synthesisRequest).includes('https://fake.example'), 'unverified scout URL reached synthesis')
  }),
)

Deno.test('grounded chat refuses source IDs the RLS RPC cannot return', () =>
  withFunctionEnvironment(async () => {
    let groqCalled = false
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-b' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) return Response.json([])
      if (request.url.includes('api.groq.com')) groqCalled = true
      throw new Error(`Unexpected request: ${request.url}`)
    }
    const response = await handleNotebookAiRequest(
      jsonRequest({
        action: 'chat',
        notebookId: 'notebook-a',
        sourceIds: ['source-a'],
        message: 'Leak source?',
        history: [],
        config: { style: 'Default', length: 'Default', instructions: '' },
        language: 'English',
      }),
    )
    assert(response.status === 404, 'missing RLS source was not rejected')
    assert(!groqCalled, 'provider was called with an unauthorized source')
  }),
)

Deno.test('source import authenticates, spends import quota and extracts an uploaded text file', () =>
  withFunctionEnvironment(async () => {
    let quotaBucket: string | undefined
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) {
        quotaBucket = ((await request.json()) as { requested_bucket?: string }).requested_bucket
        return Response.json({ allowed: true, bucket: 'import', limit: 40, remaining: 39, retryAfterSeconds: 0 })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    }
    const form = new FormData()
    form.set('file', new File(['Source evidence from an uploaded document.'], 'evidence.txt', { type: 'text/plain' }))
    const response = await handleSourceImportRequest(
      new Request('https://function.test', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-jwt' },
        body: form,
      }),
    )
    const body = await response.json()
    assert(response.status === 200, `text import returned ${response.status}`)
    assert(quotaBucket === 'import', 'source import did not spend the import quota')
    assert(
      body.imported?.title === 'evidence' && body.imported?.content.includes('Source evidence'),
      'text was not extracted',
    )
  }),
)

Deno.test('source import blocks localhost before requesting the target', () =>
  withFunctionEnvironment(async () => {
    let targetRequested = false
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
      if (request.url.endsWith('/rest/v1/rpc/consume_ai_quota')) return quotaAllowed()
      targetRequested = true
      throw new Error('private target should not be requested')
    }
    const response = await handleSourceImportRequest(jsonRequest({ action: 'url', url: 'http://localhost/admin' }))
    const body = await response.json()
    assert(response.status === 400 && body.error?.code === 'PRIVATE_URL', 'localhost URL was not blocked')
    assert(!targetRequested, 'private target received a request')
  }),
)

Deno.test('CORS answers preflight and restricts browsers to the configured origins', () =>
  withFunctionEnvironment(async () => {
    Deno.env.set('ALLOWED_ORIGINS', 'https://app.example, https://preview.example')
    const wrapped = withCors(() => Promise.resolve(jsonResponseStub()))

    const allowed = await wrapped(
      new Request('https://function.test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example' },
      }),
    )
    assert(allowed.status === 200, 'preflight was not answered')
    assert(
      allowed.headers.get('Access-Control-Allow-Origin') === 'https://app.example',
      'configured origin was not echoed',
    )
    assert(allowed.headers.get('Vary') === 'Origin', 'per-origin response was not marked for caches')

    const foreign = await wrapped(
      new Request('https://function.test', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
      }),
    )
    assert(
      foreign.headers.get('Access-Control-Allow-Origin') === 'https://app.example',
      'an unlisted origin was allowed',
    )
  }),
)

Deno.test('CORS falls back to the wildcard only while no origins are configured', () =>
  withFunctionEnvironment(async () => {
    const wrapped = withCors(() => Promise.resolve(jsonResponseStub()))
    const response = await wrapped(
      new Request('https://function.test', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    assert(response.headers.get('Access-Control-Allow-Origin') === '*', 'local development lost its wildcard default')
  }),
)

function jsonResponseStub() {
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
}
