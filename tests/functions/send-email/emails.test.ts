import { buildMessages, type SendEmailPayload } from '../../../supabase/functions/send-email/emails.ts'

const SUPABASE_URL = 'https://project.supabase.co'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function payload(overrides: Partial<SendEmailPayload['email_data']>, user: SendEmailPayload['user'] = { email: 'reader@example.com' }): SendEmailPayload {
  return {
    user,
    email_data: {
      token: '12345678',
      token_hash: 'hash-current',
      redirect_to: 'https://notebooklm.example/?account=confirmed',
      email_action_type: 'signup',
      site_url: 'https://notebooklm.example',
      token_new: '',
      token_hash_new: '',
      ...overrides,
    },
  }
}

const actionTypes = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'reauthentication',
  'password_changed_notification',
  'email_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'unknown_future_type',
]

Deno.test('every email action type renders one branded, script-free NotebookLM message', () => {
  for (const email_action_type of actionTypes) {
    const [message, ...rest] = buildMessages(payload({ email_action_type }), SUPABASE_URL)
    assert(rest.length === 0, `${email_action_type} produced more than one message`)
    assert(message.to === 'reader@example.com', `${email_action_type} was addressed to ${message.to}`)
    assert(message.subject.length > 0, `${email_action_type} has no subject`)
    assert(message.html.startsWith('<!doctype html>'), `${email_action_type} is not a full HTML document`)
    assert(message.html.includes('NotebookLM Clone'), `${email_action_type} is not branded`)
    assert(message.html.includes('role="presentation"'), `${email_action_type} does not use presentational table layout`)
    assert(!/<script|javascript:/i.test(message.html), `${email_action_type} contains executable email content`)
    assert(message.text.includes('NotebookLM Clone'), `${email_action_type} has no plain-text alternative`)
  }
})

Deno.test('verification emails link to the Supabase verify endpoint with the token hash and redirect', () => {
  const [message] = buildMessages(payload({ email_action_type: 'recovery' }), SUPABASE_URL)
  const expected = 'https://project.supabase.co/auth/v1/verify?token=hash-current&type=recovery&redirect_to=https%3A%2F%2Fnotebooklm.example%2F%3Faccount%3Dconfirmed'
  assert(message.html.includes(`href="${expected.replace(/&/g, '&amp;')}"`), 'recovery link is missing or malformed')
  assert(message.text.includes(expected), 'plain-text recovery link is missing')
  assert(message.html.includes('12345678'), 'the one-time code was not offered as a fallback')
})

Deno.test('notification emails point at the site instead of a verification link', () => {
  const [message] = buildMessages(payload({ email_action_type: 'password_changed_notification' }), SUPABASE_URL)
  assert(message.html.includes('href="https://notebooklm.example"'), 'notification does not link to the site')
  assert(!message.html.includes('/auth/v1/verify'), 'notification exposes a verification link')
})

Deno.test('secure email change sends both addresses the token pair that belongs to them', () => {
  const messages = buildMessages(payload(
    { email_action_type: 'email_change', token_new: '87654321', token_hash_new: 'hash-new' },
    { email: 'reader@example.com', new_email: 'moved@example.com' },
  ), SUPABASE_URL)
  assert(messages.length === 2, 'secure email change did not produce two messages')
  const [current, next] = messages
  assert(current.to === 'reader@example.com' && next.to === 'moved@example.com', 'email change recipients are wrong')
  assert(current.html.includes('token=hash-new') && current.html.includes('12345678'), 'current address received the wrong token pair')
  assert(next.html.includes('token=hash-current') && next.html.includes('87654321'), 'new address received the wrong token pair')
})

Deno.test('an anonymous account linking its first email receives a single confirmation', () => {
  const messages = buildMessages(payload(
    { email_action_type: 'email_change', token_new: '87654321', token_hash_new: 'hash-new' },
    { email: '', new_email: 'guest@example.com' },
  ), SUPABASE_URL)
  assert(messages.length === 1, 'a guest upgrade should only email the new address')
  assert(messages[0].to === 'guest@example.com', 'the guest upgrade was addressed to the wrong recipient')
})

Deno.test('addresses from the hook payload are escaped before they reach the HTML body', () => {
  const [message] = buildMessages(payload(
    { email_action_type: 'email_changed_notification', old_email: '"><img src=x onerror=alert(1)>@example.com' },
    { email: 'reader@example.com' },
  ), SUPABASE_URL)
  assert(!message.html.includes('<img src=x'), 'a payload address was injected into the markup')
  assert(message.html.includes('&lt;img src=x'), 'the payload address was not escaped')
})
