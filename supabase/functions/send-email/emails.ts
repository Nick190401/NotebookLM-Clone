import { HttpError } from '../_shared/http.ts'

const BRAND = 'NotebookLM Clone'

export interface SendEmailPayload {
  user: { email?: string; new_email?: string }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new: string
    token_hash_new: string
    old_email?: string
    provider?: string
  }
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

interface EmailContent {
  subject: string
  heading: string
  lines: string[]
  action?: { label: string; url: string; plain?: boolean }
  code?: string
  footer: string
}

const IGNORE_NOTE = 'If you did not request this, you can safely ignore this email.'
const SECURITY_NOTE = `If this was not you, reset your ${BRAND} password immediately.`

function verifyUrl(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string) {
  const params = new URLSearchParams({ token: tokenHash, type })
  if (redirectTo) params.set('redirect_to', redirectTo)
  return `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify?${params}`
}

function emailChangeContent(recipient: 'current' | 'new', newEmail: string, url: string): EmailContent {
  return {
    subject: `Connect your email to ${BRAND}`,
    heading: recipient === 'current' ? 'Approve this email change' : 'Confirm your new email',
    lines: recipient === 'current'
      ? [`Your ${BRAND} account is being moved to ${newEmail}. Approve the change from this address to continue.`, 'The change only completes once both addresses confirm it.']
      : [`Confirm ${newEmail} to use it for ${BRAND}. Your notebooks, sources, and Studio artifacts stay on the same account.`],
    action: { label: 'Confirm email change', url },
    footer: recipient === 'current' ? SECURITY_NOTE : IGNORE_NOTE,
  }
}

function contentFor(payload: SendEmailPayload, verify: (tokenHash: string) => string): EmailContent {
  const { user, email_data: data } = payload
  switch (data.email_action_type) {
    case 'signup':
      return {
        subject: `Confirm your ${BRAND} email`,
        heading: 'Confirm your email',
        lines: [`Confirm this address to finish setting up your ${BRAND} account. Everything in your current workspace stays with you.`],
        action: { label: 'Confirm email', url: verify(data.token_hash) },
        footer: IGNORE_NOTE,
      }
    case 'invite':
      return {
        subject: `You are invited to ${BRAND}`,
        heading: `You are invited to ${BRAND}`,
        lines: ['Accept the invitation to create your account and start building source-grounded notebooks.'],
        action: { label: 'Accept invitation', url: verify(data.token_hash) },
        footer: IGNORE_NOTE,
      }
    case 'magiclink':
      return {
        subject: `Your secure ${BRAND} sign-in link`,
        heading: 'Sign in to NotebookLM Clone',
        lines: ['Use this link to sign in. It works once and expires shortly.'],
        action: { label: 'Sign in', url: verify(data.token_hash) },
        footer: IGNORE_NOTE,
      }
    case 'recovery':
      return {
        subject: `Reset your ${BRAND} password`,
        heading: 'Reset your password',
        lines: [`Choose a new password for ${user.email ?? 'your account'}. The link expires shortly and can be used once.`],
        action: { label: 'Choose a new password', url: verify(data.token_hash) },
        footer: IGNORE_NOTE,
      }
    case 'reauthentication':
      return {
        subject: `${data.token} is your ${BRAND} verification code`,
        heading: 'Verify it is you',
        lines: ['Enter this code in NotebookLM Clone to confirm the change you just started.'],
        code: data.token,
        footer: IGNORE_NOTE,
      }
    case 'password_changed_notification':
      return {
        subject: `Your ${BRAND} password was changed`,
        heading: 'Your password was changed',
        lines: ['The password for your account was just updated. No further action is needed if you made this change.'],
        action: { label: `Open ${BRAND}`, url: data.site_url, plain: true },
        footer: SECURITY_NOTE,
      }
    case 'email_changed_notification':
      return {
        subject: `Your ${BRAND} email was changed`,
        heading: 'Your email was changed',
        lines: [`The address on your account changed${data.old_email ? ` from ${data.old_email}` : ''}${user.email ? ` to ${user.email}` : ''}.`],
        action: { label: `Open ${BRAND}`, url: data.site_url, plain: true },
        footer: SECURITY_NOTE,
      }
    case 'identity_linked_notification':
      return {
        subject: `A sign-in method was added to ${BRAND}`,
        heading: 'A sign-in method was added',
        lines: [`${data.provider || 'A new provider'} can now be used to sign in to your account.`],
        action: { label: `Open ${BRAND}`, url: data.site_url, plain: true },
        footer: SECURITY_NOTE,
      }
    case 'identity_unlinked_notification':
      return {
        subject: `A sign-in method was removed from ${BRAND}`,
        heading: 'A sign-in method was removed',
        lines: [`${data.provider || 'A provider'} can no longer be used to sign in to your account.`],
        action: { label: `Open ${BRAND}`, url: data.site_url, plain: true },
        footer: SECURITY_NOTE,
      }
    default:
      return {
        subject: `Confirm your ${BRAND} request`,
        heading: 'Confirm this request',
        lines: ['Confirm the request you just started in NotebookLM Clone.'],
        action: data.token_hash ? { label: 'Confirm request', url: verify(data.token_hash) } : undefined,
        code: data.token_hash ? undefined : data.token,
        footer: IGNORE_NOTE,
      }
  }
}

export function buildMessages(payload: SendEmailPayload, supabaseUrl: string): EmailMessage[] {
  const { user, email_data: data } = payload
  const verify = (tokenHash: string) => verifyUrl(supabaseUrl, tokenHash, data.email_action_type, data.redirect_to)

  if (data.email_action_type === 'email_change') {
    const newEmail = user.new_email || user.email
    if (!newEmail) throw new HttpError('The email change hook payload has no address.', 'EMAIL_RECIPIENT_MISSING', 500)
    const messages: EmailMessage[] = []
    if (user.email && data.token_hash_new) {
      messages.push(toMessage(user.email, emailChangeContent('current', newEmail, verify(data.token_hash_new))))
    }
    messages.push(toMessage(newEmail, emailChangeContent('new', newEmail, verify(data.token_hash))))
    return messages
  }

  const recipient = user.email || user.new_email
  if (!recipient) throw new HttpError('The email hook payload has no address.', 'EMAIL_RECIPIENT_MISSING', 500)
  return [toMessage(recipient, contentFor(payload, verify))]
}

function toMessage(to: string, content: EmailContent): EmailMessage {
  return { to, subject: content.subject, html: renderHtml(content), text: renderText(content) }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function row(padding: string, body: string) {
  return `<tr><td style="padding:${padding};">${body}</td></tr>`
}

function renderHtml(content: EmailContent) {
  const paragraphs = content.lines
    .map((line) => row('12px 32px 0', `<p style="margin:0;font-size:15px;line-height:1.6;color:#6d7178;">${escapeHtml(line)}</p>`))
    .join('')
  const action = content.action
    ? row('24px 32px 0', `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#3f57dc;border-radius:999px;"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(content.action.label)}</a></td></tr></table>`)
    : ''
  const code = content.code
    ? row('20px 32px 0', `<div style="padding:14px 18px;background:#eaedff;border-radius:12px;font-size:22px;font-weight:700;letter-spacing:4px;color:#3f57dc;text-align:center;">${escapeHtml(content.code)}</div>`)
    : ''
  const fallback = content.action && !content.action.plain
    ? row('20px 32px 0', `<p style="margin:0;font-size:12px;line-height:1.6;color:#92969d;word-break:break-all;">Or paste this link into your browser:<br><span style="color:#5269e8;">${escapeHtml(content.action.url)}</span></p>`)
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f8ff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8ff;padding:32px 16px;font-family:'DM Sans','Google Sans',Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dfe1e7;border-radius:16px;">
${row('28px 32px 0', `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="36" align="center" style="width:36px;height:36px;background:#161719;border-radius:18px;color:#ffffff;font-size:15px;line-height:36px;">&#10022;</td><td style="padding-left:10px;font-size:16px;font-weight:700;color:#202124;">${BRAND}</td></tr></table>`)}
${row('22px 32px 0', `<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:#202124;">${escapeHtml(content.heading)}</h1>`)}
${paragraphs}${action}${code}${fallback}
${row('28px 32px 28px', `<p style="margin:0;padding-top:20px;border-top:1px solid #dfe1e7;font-size:12px;line-height:1.6;color:#92969d;">${escapeHtml(content.footer)}</p>`)}
</table>
</td></tr>
</table>
</body>
</html>`
}

function renderText(content: EmailContent) {
  const parts = [BRAND, '', content.heading, '', ...content.lines]
  if (content.action) parts.push('', `${content.action.label}: ${content.action.url}`)
  if (content.code) parts.push('', `Code: ${content.code}`)
  parts.push('', content.footer)
  return parts.join('\n')
}
