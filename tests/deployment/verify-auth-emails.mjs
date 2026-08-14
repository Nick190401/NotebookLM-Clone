import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const templates = {
  'confirmation.html': ['{{ .ConfirmationURL }}'],
  'email_change.html': ['{{ .ConfirmationURL }}', '{{ .NewEmail }}'],
  'recovery.html': ['{{ .ConfirmationURL }}', '{{ .Email }}'],
  'magic_link.html': ['{{ .ConfirmationURL }}'],
  'invite.html': ['{{ .ConfirmationURL }}'],
  'reauthentication.html': ['{{ .Token }}'],
  'password_changed_notification.html': ['{{ .SiteURL }}'],
  'email_changed_notification.html': ['{{ .SiteURL }}', '{{ .OldEmail }}', '{{ .Email }}'],
  'identity_linked_notification.html': ['{{ .SiteURL }}', '{{ .Provider }}'],
  'identity_unlinked_notification.html': ['{{ .SiteURL }}', '{{ .Provider }}'],
}

for (const [filename, variables] of Object.entries(templates)) {
  const html = await readFile(join(process.cwd(), 'supabase', 'templates', filename), 'utf8')
  const required = ['<!doctype html>', 'NotebookLM Clone', 'role="presentation"', ...variables]
  const missing = required.filter((value) => !html.includes(value))
  if (missing.length) throw new Error(`${filename} is missing: ${missing.join(', ')}`)
  if (/<script|javascript:/i.test(html)) throw new Error(`${filename} contains executable email content`)
}

const config = await readFile(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
const configMappings = {
  confirmation: './supabase/templates/confirmation.html',
  email_change: './supabase/templates/email_change.html',
  recovery: './supabase/templates/recovery.html',
  magic_link: './supabase/templates/magic_link.html',
  invite: './supabase/templates/invite.html',
  reauthentication: './supabase/templates/reauthentication.html',
  password_changed: './templates/password_changed_notification.html',
  email_changed: './templates/email_changed_notification.html',
  identity_linked: './templates/identity_linked_notification.html',
  identity_unlinked: './templates/identity_unlinked_notification.html',
}

for (const [type, path] of Object.entries(configMappings)) {
  if (!config.includes(`content_path = "${path}"`)) throw new Error(`config.toml does not map ${type} to ${path}`)
}

console.log(`Verified ${Object.keys(templates).length} branded Supabase auth email templates and config mappings.`)
