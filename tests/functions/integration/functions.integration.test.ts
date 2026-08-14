import { handleNotebookAiRequest } from '../../../supabase/functions/notebook-ai/handler.ts'
import { handleSourceImportRequest } from '../../../supabase/functions/source-import/handler.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function jsonRequest(body: unknown) {
  return new Request('https://function.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function withFunctionEnvironment<T>(run: () => Promise<T>) {
  const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'GROQ_API_KEY'] as const
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]))
  const previousFetch = globalThis.fetch
  Deno.env.set('SUPABASE_URL', 'https://project.supabase.co')
  Deno.env.set('SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key')
  Deno.env.set('GROQ_API_KEY', 'groq-test-key')
  return run().finally(() => {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value)
    }
    globalThis.fetch = previousFetch
  })
}

Deno.test('notebook AI status validates auth without exposing the Groq key', () => withFunctionEnvironment(async () => {
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
}))

Deno.test('notebook AI status reports an unauthorized Groq key as unconfigured', () => withFunctionEnvironment(async () => {
  globalThis.fetch = (input) => {
    const url = String(input)
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
    if (url.endsWith('/openai/v1/models')) return Promise.resolve(Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 }))
    throw new Error(`Unexpected request: ${url}`)
  }
  const response = await handleNotebookAiRequest(jsonRequest({ action: 'status' }))
  const body = await response.json()
  assert(response.status === 200 && body.configured === false, 'Invalid Groq key was reported as configured')
  assert(!JSON.stringify(body).includes('groq-test-key'), 'Groq key leaked into status response')
}))

Deno.test('Groq rate-limit text is normalized to a retry header', () => withFunctionEnvironment(async () => {
  globalThis.fetch = (input) => {
    const url = String(input)
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(Response.json({ id: 'user-a' }))
    if (url.endsWith('/chat/completions')) {
      return Promise.resolve(Response.json({
        error: { message: 'Rate limit reached. Please try again in 11.018s.' },
      }, { status: 429 }))
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  const response = await handleNotebookAiRequest(jsonRequest({
    action: 'discover', query: 'Current transit reliability', language: 'English',
  }))
  assert(response.status === 429, 'Groq rate limit did not retain HTTP 429')
  assert(response.headers.get('Retry-After') === '12', 'Groq text retry hint was not normalized')
}))

Deno.test('grounded chat loads sources through the caller-bound RPC', () => withFunctionEnvironment(async () => {
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    calls.push(request.url)
    if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
    if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
      assert(request.headers.get('Authorization') === 'Bearer user-jwt', 'RPC lost the caller JWT')
      return Response.json([{
        id: 'source-a', title: 'Evidence', kind: 'text', origin: 'test',
        content: 'Reliable ten-minute service improved public trust.', summary: '', topics: [], selected: true,
        created_at: '2026-08-14T00:00:00.000Z',
      }])
    }
    if (request.url.endsWith('/chat/completions')) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        answer: 'Reliability improved public trust. [1]',
        citations: [{ sourceId: 'source-a', excerpt: 'Reliable ten-minute service improved public trust.' }],
      }) } }] })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  }
  const response = await handleNotebookAiRequest(jsonRequest({
    action: 'chat', notebookId: 'notebook-a', sourceIds: ['source-a'], message: 'What improved trust?',
    history: [], config: { style: 'Default', length: 'Default', instructions: '' }, language: 'English',
  }))
  const body = await response.json()
  assert(response.status === 200, `chat returned ${response.status}`)
  assert(body.content.includes('[1]') && body.citations[0]?.sourceId === 'source-a', 'grounded citation missing')
  assert(calls.some((url) => url.endsWith('/rest/v1/rpc/load_ai_sources')), 'source RPC was not used')
}))

Deno.test('artifact generation forwards the selected format into the grounded prompt', () => withFunctionEnvironment(async () => {
  let systemPrompt = ''
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
    if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) {
      return Response.json([{
        id: 'source-a', title: 'Evidence', kind: 'text', origin: 'test',
        content: 'A root concept connects two grounded findings.', summary: '', topics: [], selected: true,
        created_at: '2026-08-14T00:00:00.000Z',
      }])
    }
    if (request.url.endsWith('/chat/completions')) {
      const body = await request.json() as { messages?: { role?: string; content?: string }[] }
      systemPrompt = body.messages?.find((message) => message.role === 'system')?.content ?? ''
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        summary: 'Grounded map', sections: [], cards: [], questions: [], slides: [], columns: [], rows: [], metrics: [], transcript: [], narration: '',
        nodes: [
          { id: 'root', label: 'Root', parentId: '', sourceId: 'source-a' },
          { id: 'one', label: 'Finding one', parentId: 'root', sourceId: 'source-a' },
          { id: 'two', label: 'Finding two', parentId: 'root', sourceId: 'source-a' },
        ],
      }) } }] })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  }

  const response = await handleNotebookAiRequest(jsonRequest({
    action: 'artifact', notebookId: 'notebook-a', sourceIds: ['source-a'], type: 'mindmap',
    config: { focus: 'Service dependencies', language: 'English', format: 'Radial map' },
  }))
  assert(response.status === 200, `artifact returned ${response.status}`)
  assert(systemPrompt.includes('Format: Radial map.'), 'Selected artifact format was omitted from the Groq prompt')
  assert(systemPrompt.includes('Focus: Service dependencies.'), 'Custom artifact focus was omitted from the Groq prompt')
}))

Deno.test('shared chat loads sources only through the token-bound RPC', () => withFunctionEnvironment(async () => {
  let rpcBody: Record<string, unknown> | undefined
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'viewer-a' })
    if (request.url.endsWith('/rest/v1/rpc/load_shared_ai_sources')) {
      rpcBody = await request.json()
      return Response.json([{
        id: 'source-a', title: 'Shared evidence', kind: 'text', origin: 'test',
        content: 'Token-bound evidence supports the shared answer.', summary: '', topics: [], selected: true,
        created_at: '2026-08-14T00:00:00.000Z',
      }])
    }
    if (request.url.endsWith('/chat/completions')) {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        answer: 'The evidence is token-bound. [1]',
        citations: [{ sourceId: 'source-a', excerpt: 'Token-bound evidence supports the shared answer.' }],
      }) } }] })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  }

  const response = await handleNotebookAiRequest(jsonRequest({
    action: 'chat', notebookId: 'notebook-a', sourceIds: ['source-a'],
    shareToken: '33333333-3333-4333-8333-333333333333', message: 'What is protected?', history: [],
    config: { style: 'Default', length: 'Default', instructions: '' }, language: 'English',
  }))
  assert(response.status === 200, `shared chat returned ${response.status}`)
  assert(rpcBody?.requested_share_token === '33333333-3333-4333-8333-333333333333', 'share token was not forwarded')
  assert(rpcBody?.requested_notebook_id === 'notebook-a', 'shared notebook id was not forwarded')
}))

Deno.test('deep research returns only deduplicated sources observed by Groq web tools', () => withFunctionEnvironment(async () => {
  const scoutRequests: Record<string, unknown>[] = []
  let synthesisRequest: Record<string, unknown> | undefined
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'researcher-a' })
    if (request.url.endsWith('/chat/completions')) {
      const requestBody = await request.json() as Record<string, unknown>
      const tools = requestBody.tools as { type?: string }[] | undefined
      if (!tools?.some((tool) => tool.type === 'browser_search')) {
        synthesisRequest = requestBody
        return Response.json({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: '## Executive summary\nVerified transit evidence from the supplied sources.' } }],
        })
      }
      scoutRequests.push(requestBody)
      return Response.json({
        model: requestBody.model,
        choices: [{ message: {
          content: 'Verified transit evidence, plus a hallucinated link to https://fake.example.',
          executed_tools: [
            { type: 'browser_search', browser_results: [
              { title: 'Primary transit study', url: 'https://research.example/study#findings', content: 'The study measured service reliability.', score: 0.94 },
              { title: 'Primary transit study duplicate', url: 'https://research.example/study', content: 'Duplicate result.', score: 0.81 },
              { title: 'Transport authority', url: 'https://authority.example/report', content: 'The authority published network performance.', score: 0.89 },
              { title: 'Unsafe scheme', url: 'ftp://files.example/report', content: 'Not importable.', score: 1 },
            ] },
          ],
        } }],
      })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  }

  const response = await handleNotebookAiRequest(jsonRequest({
    action: 'research', query: 'How does service reliability affect public trust?', language: 'English',
  }))
  const body = await response.json()
  assert(response.status === 200, `research returned ${response.status}`)
  assert(body.report.includes('Executive summary'), 'research report missing')
  assert(body.results.length === 2, 'tool results were not deduplicated or filtered')
  assert(body.results[0]?.url === 'https://research.example/study', 'URL fragment was not canonicalized')
  assert(!JSON.stringify(body.results).includes('fake.example'), 'model-authored URL escaped the tool evidence boundary')
  assert(body.toolCount === 2, 'research action count missing')
  assert(scoutRequests.length === 2, 'deep research did not investigate two independent angles')
  assert(JSON.stringify(scoutRequests.map((request) => request.model)) === JSON.stringify(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']), 'research scouts did not split model budgets')
  for (const request of scoutRequests) {
    assert(request.max_completion_tokens === 800, 'research scout exceeded the provider-safe output budget')
    assert(request.reasoning_effort === 'low', 'browser research did not use the efficient reasoning budget')
    assert(request.tool_choice === 'required', 'browser research did not require a tool call')
  }
  assert(JSON.stringify(synthesisRequest).includes('https://research.example/study'), 'synthesis did not receive verified sources')
  assert(!JSON.stringify(synthesisRequest).includes('https://fake.example'), 'unverified scout URL reached synthesis')
}))

Deno.test('grounded chat refuses source IDs the RLS RPC cannot return', () => withFunctionEnvironment(async () => {
  let groqCalled = false
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-b' })
    if (request.url.endsWith('/rest/v1/rpc/load_ai_sources')) return Response.json([])
    if (request.url.includes('api.groq.com')) groqCalled = true
    throw new Error(`Unexpected request: ${request.url}`)
  }
  const response = await handleNotebookAiRequest(jsonRequest({
    action: 'chat', notebookId: 'notebook-a', sourceIds: ['source-a'], message: 'Leak source?',
    history: [], config: { style: 'Default', length: 'Default', instructions: '' }, language: 'English',
  }))
  assert(response.status === 404, 'missing RLS source was not rejected')
  assert(!groqCalled, 'provider was called with an unauthorized source')
}))

Deno.test('source import authenticates and extracts an uploaded text file', () => withFunctionEnvironment(async () => {
  globalThis.fetch = () => Promise.resolve(Response.json({ id: 'user-a' }))
  const form = new FormData()
  form.set('file', new File(['Source evidence from an uploaded document.'], 'evidence.txt', { type: 'text/plain' }))
  const response = await handleSourceImportRequest(new Request('https://function.test', {
    method: 'POST', headers: { Authorization: 'Bearer user-jwt' }, body: form,
  }))
  const body = await response.json()
  assert(response.status === 200, `text import returned ${response.status}`)
  assert(body.imported?.title === 'evidence' && body.imported?.content.includes('Source evidence'), 'text was not extracted')
}))

Deno.test('source import blocks localhost before requesting the target', () => withFunctionEnvironment(async () => {
  let targetRequested = false
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-a' })
    targetRequested = true
    throw new Error('private target should not be requested')
  }
  const response = await handleSourceImportRequest(jsonRequest({ action: 'url', url: 'http://localhost/admin' }))
  const body = await response.json()
  assert(response.status === 400 && body.error?.code === 'PRIVATE_URL', 'localhost URL was not blocked')
  assert(!targetRequested, 'private target received a request')
}))
