import { HttpError } from '../../../supabase/functions/_shared/http.ts'
import {
  assertWithinBurstLimit,
  clientAddress,
  consumeQuota,
  createBurstLimiter,
} from '../../../supabase/functions/_shared/quota.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const context = {
  authorization: 'Bearer user-jwt',
  publishableKey: 'publishable-test-key',
  supabaseUrl: 'https://project.supabase.co',
  userId: 'user-a',
}

function withFetch<T>(handler: typeof globalThis.fetch, run: () => Promise<T>) {
  const previous = globalThis.fetch
  globalThis.fetch = handler
  return run().finally(() => {
    globalThis.fetch = previous
  })
}

Deno.test('quota is reserved through the caller-bound RPC before provider work', () =>
  withFetch(
    async (input, init) => {
      const request = new Request(input, init)
      assert(request.url.endsWith('/rest/v1/rpc/consume_ai_quota'), `unexpected endpoint ${request.url}`)
      assert(request.headers.get('Authorization') === 'Bearer user-jwt', 'quota RPC lost the caller JWT')
      const body = (await request.json()) as { requested_bucket?: string }
      assert(body.requested_bucket === 'research', 'quota bucket was not forwarded')
      return Response.json({ allowed: true, bucket: 'research', limit: 8, remaining: 7, retryAfterSeconds: 0 })
    },
    async () => {
      const decision = await consumeQuota(context, 'research')
      assert(decision.remaining === 7, 'quota decision was not returned')
    },
  ),
)

Deno.test('an exhausted quota becomes a retryable 429 instead of a provider call', () =>
  withFetch(
    () =>
      Promise.resolve(
        Response.json({ allowed: false, bucket: 'chat', limit: 60, remaining: 0, retryAfterSeconds: 900 }),
      ),
    async () => {
      let caught: unknown
      try {
        await consumeQuota(context, 'chat')
      } catch (error) {
        caught = error
      }
      assert(caught instanceof HttpError, 'exhausted quota did not raise an HttpError')
      assert(caught.status === 429 && caught.code === 'QUOTA_EXCEEDED', `unexpected quota error ${caught.code}`)
      assert(caught.retryAfter === '900', 'retry hint was not forwarded')
      assert(caught.message.includes('60'), 'the limit was not explained to the caller')
    },
  ),
)

Deno.test('the burst limiter caps a single address and recovers after the window', () => {
  const limiter = createBurstLimiter({ limit: 3, windowMs: 60_000 })
  const start = 1_000_000
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert(limiter.take('ip-a', start).allowed, `attempt ${attempt} was refused inside the limit`)
  }
  const refused = limiter.take('ip-a', start)
  assert(!refused.allowed && refused.retryAfterSeconds === 60, `unexpected refusal ${JSON.stringify(refused)}`)
  assert(limiter.take('ip-b', start).allowed, 'an unrelated address was penalised')
  assert(limiter.take('ip-a', start + 60_000).allowed, 'the window never reopened')
})

Deno.test('refused burst attempts do not extend the lockout', () => {
  const limiter = createBurstLimiter({ limit: 2, windowMs: 10_000 })
  const start = 5_000
  limiter.take('ip-a', start)
  limiter.take('ip-a', start)
  for (let attempt = 0; attempt < 5; attempt += 1) limiter.take('ip-a', start + 1_000)
  const afterWindow = limiter.take('ip-a', start + 10_000)
  assert(afterWindow.allowed, 'repeated refusals kept the window closed')
})

Deno.test('expired windows are evicted so the limiter cannot grow without bound', () => {
  const limiter = createBurstLimiter({ limit: 1, windowMs: 1_000, maxKeys: 4 })
  for (let index = 0; index < 40; index += 1) limiter.take(`ip-${index}`, 1_000 + index * 500)
  assert(limiter.size() <= 8, `limiter retained ${limiter.size()} windows`)
})

Deno.test('the client address prefers the first forwarded hop', () => {
  const request = new Request('https://function.test', {
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
  })
  assert(clientAddress(request) === '203.0.113.7', 'forwarded client address was not extracted')
  assert(clientAddress(new Request('https://function.test')) === 'unknown', 'missing address was not defaulted')
})

Deno.test('burst refusal surfaces as a retryable HTTP error', () => {
  const limiter = createBurstLimiter({ limit: 1, windowMs: 30_000 })
  const request = new Request('https://function.test', { headers: { 'x-forwarded-for': '203.0.113.9' } })
  assertWithinBurstLimit(request, limiter)
  let caught: unknown
  try {
    assertWithinBurstLimit(request, limiter)
  } catch (error) {
    caught = error
  }
  assert(caught instanceof HttpError, 'burst limit did not raise an HttpError')
  assert(caught.status === 429 && caught.code === 'BURST_LIMITED', `unexpected burst error ${caught.code}`)
})
