import { authenticatedContext, HttpError, supabaseRpc } from '../../_shared/http.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function withEnvironment<T>(run: () => Promise<T>) {
  const previousUrl = Deno.env.get('SUPABASE_URL')
  const previousKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const previousFetch = globalThis.fetch
  Deno.env.set('SUPABASE_URL', 'https://project.supabase.co')
  Deno.env.set('SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key')
  return run().finally(() => {
    if (previousUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', previousUrl)
    if (previousKey === undefined) Deno.env.delete('SUPABASE_PUBLISHABLE_KEY'); else Deno.env.set('SUPABASE_PUBLISHABLE_KEY', previousKey)
    globalThis.fetch = previousFetch
  })
}

Deno.test('authenticated context validates the bearer session with Supabase Auth', () => withEnvironment(async () => {
  let received: Request | undefined
  globalThis.fetch = async (input, init) => {
    received = new Request(input, init)
    return Response.json({ id: 'user-a' })
  }
  const context = await authenticatedContext(new Request('https://function.test', { headers: { Authorization: 'Bearer user-jwt' } }))
  assert(context.userId === 'user-a', 'verified user id missing')
  assert(received?.url === 'https://project.supabase.co/auth/v1/user', 'wrong Auth endpoint')
  assert(received?.headers.get('Authorization') === 'Bearer user-jwt', 'bearer token was not forwarded')
  assert(received?.headers.get('apikey') === 'publishable-test-key', 'publishable key was not forwarded')
}))

Deno.test('authenticated context rejects an invalid session', () => withEnvironment(async () => {
  globalThis.fetch = () => Promise.resolve(Response.json({ message: 'invalid' }, { status: 401 }))
  let caught: unknown
  try {
    await authenticatedContext(new Request('https://function.test', { headers: { Authorization: 'Bearer expired' } }))
  } catch (error) {
    caught = error
  }
  assert(caught instanceof HttpError && caught.code === 'AUTH_INVALID' && caught.status === 401, 'invalid session was not rejected')
}))

Deno.test('Supabase RPC keeps the caller JWT so RLS remains active', () => withEnvironment(async () => {
  let received: Request | undefined
  globalThis.fetch = async (input, init) => {
    received = new Request(input, init)
    return Response.json([{ id: 'source-a' }])
  }
  const result = await supabaseRpc<{ id: string }[]>({
    authorization: 'Bearer user-jwt', publishableKey: 'publishable-test-key',
    supabaseUrl: 'https://project.supabase.co', userId: 'user-a',
  }, 'load_ai_sources', { requested_notebook_id: 'notebook-a', requested_source_ids: ['source-a'] })
  assert(result[0]?.id === 'source-a', 'RPC response was not parsed')
  assert(received?.url.endsWith('/rest/v1/rpc/load_ai_sources'), 'wrong RPC endpoint')
  assert(received?.headers.get('Authorization') === 'Bearer user-jwt', 'RLS bearer token missing')
  assert(await received?.json().then((body) => body.requested_notebook_id) === 'notebook-a', 'RPC body missing')
}))
