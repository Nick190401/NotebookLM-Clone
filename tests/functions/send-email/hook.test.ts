import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { handleSendEmailRequest } from '../../../supabase/functions/send-email/handler.ts'

const HOOK_SECRET = 'v1,whsec_dGVzdC1zZW5kLWVtYWlsLWhvb2stc2VjcmV0'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function withEnvironment<T>(run: () => Promise<T>) {
  const previous = globalThis.fetch
  Deno.env.set('SEND_EMAIL_HOOK_SECRET', HOOK_SECRET)
  Deno.env.set('RESEND_API_KEY', 'resend-test-key')
  Deno.env.set('RESEND_FROM_ADDRESS', 'NotebookLM Clone <auth@notebooklm.example>')
  Deno.env.set('SUPABASE_URL', 'https://project.supabase.co')
  return run().finally(() => {
    globalThis.fetch = previous
    for (const name of ['SEND_EMAIL_HOOK_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_ADDRESS', 'SUPABASE_URL'])
      Deno.env.delete(name)
  })
}

function hookRequest(body: string, sign = true) {
  const timestamp = new Date()
  const signature = new Webhook(HOOK_SECRET.replace('v1,whsec_', '')).sign('msg_test', timestamp, body)
  return new Request('https://function.test/send-email', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'msg_test',
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': sign ? signature : 'v1,invalid-signature',
    },
  })
}

const body = JSON.stringify({
  user: { email: 'reader@example.com' },
  email_data: {
    token: '12345678',
    token_hash: 'hash-current',
    redirect_to: 'https://notebooklm.example/?account=confirmed',
    email_action_type: 'signup',
    site_url: 'https://notebooklm.example',
    token_new: '',
    token_hash_new: '',
  },
})

Deno.test('a signed hook call sends the rendered email through Resend', () =>
  withEnvironment(async () => {
    let sent: Request | undefined
    globalThis.fetch = async (input, init) => {
      sent = new Request(input, init)
      return Response.json({ id: 'resend-message-id' })
    }

    const response = await handleSendEmailRequest(hookRequest(body))
    assert(response.status === 200, `hook returned ${response.status}`)
    assert(sent?.url === 'https://api.resend.com/emails', 'Resend was not called')
    assert(sent?.headers.get('Authorization') === 'Bearer resend-test-key', 'the Resend key was not forwarded')
    const message = (await sent!.json()) as { from: string; to: string[]; subject: string; html: string; text: string }
    assert(message.from === 'NotebookLM Clone <auth@notebooklm.example>', 'the configured sender was not used')
    assert(message.to[0] === 'reader@example.com', 'the message went to the wrong recipient')
    assert(message.subject === 'Confirm your NotebookLM Clone email', `unexpected subject ${message.subject}`)
    assert(message.html.includes('/auth/v1/verify?token=hash-current'), 'the confirmation link is missing')
  }),
)

Deno.test('an unsigned hook call is rejected without sending anything', () =>
  withEnvironment(async () => {
    let called = false
    globalThis.fetch = async () => {
      called = true
      return Response.json({})
    }

    const response = await handleSendEmailRequest(hookRequest(body, false))
    assert(response.status === 401, `unsigned call returned ${response.status}`)
    assert(!called, 'an unverified payload reached Resend')
  }),
)

Deno.test('a Resend outage is reported as a retryable hook failure', () =>
  withEnvironment(async () => {
    globalThis.fetch = async () => new Response('service unavailable', { status: 503 })

    const response = await handleSendEmailRequest(hookRequest(body))
    assert(response.status === 503, `outage returned ${response.status}`)
    assert(response.headers.get('Retry-After') === 'true', 'the hook did not ask Supabase Auth to retry')
  }),
)
