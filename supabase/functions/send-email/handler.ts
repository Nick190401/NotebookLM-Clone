import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { errorResponse, HttpError, jsonResponse } from '../_shared/http.ts'
import { buildMessages, type EmailMessage, type SendEmailPayload } from './emails.ts'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new HttpError(`${name} is not configured for the send-email hook.`, 'EMAIL_NOT_CONFIGURED', 500)
  return value
}

function verifiedPayload(request: Request, body: string): SendEmailPayload {
  const webhook = new Webhook(requiredEnv('SEND_EMAIL_HOOK_SECRET').replace('v1,whsec_', ''))
  try {
    return webhook.verify(body, Object.fromEntries(request.headers)) as SendEmailPayload
  } catch {
    throw new HttpError('The Auth hook signature could not be verified.', 'HOOK_SIGNATURE_INVALID', 401)
  }
}

async function sendWithResend(message: EmailMessage) {
  let response: Response
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: requiredEnv('RESEND_FROM_ADDRESS'),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new HttpError('Resend is currently unavailable.', 'EMAIL_UNAVAILABLE', 503, 'true')
  }
  if (response.ok) return
  console.error('Resend rejected the authentication email', response.status, await response.text())
  if (response.status === 429 || response.status >= 500) {
    throw new HttpError('Resend could not accept the authentication email yet.', 'EMAIL_RETRY', 503, 'true')
  }
  throw new HttpError('Resend rejected the authentication email.', 'EMAIL_SEND_FAILED', 500)
}

export async function handleSendEmailRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError('The send-email hook only accepts POST.', 'METHOD_NOT_ALLOWED', 405)
    const body = await request.text()
    const payload = verifiedPayload(request, body)
    for (const message of buildMessages(payload, requiredEnv('SUPABASE_URL'))) {
      await sendWithResend(message)
    }
    return jsonResponse({})
  } catch (error) {
    return errorResponse(error)
  }
}
