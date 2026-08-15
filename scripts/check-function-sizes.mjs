import { execFileSync } from 'node:child_process'

const functions = [
  ['notebook-ai', 'supabase/functions/notebook-ai/deno.json', 'supabase/functions/notebook-ai/index.ts'],
  ['source-import', 'supabase/functions/source-import/deno.json', 'supabase/functions/source-import/index.ts'],
  ['send-email', 'supabase/functions/send-email/deno.json', 'supabase/functions/send-email/index.ts'],
]
// Supabase rejects Edge Function bundles at 5 MB, so CI fails before a deploy can.
const limitInBytes = 5 * 1024 * 1024

for (const [name, config, entrypoint] of functions) {
  const output = execFileSync('deno', ['info', '--config', config, entrypoint], { encoding: 'utf8' }).replace(
    /\x1b\[[0-9;]*m/g,
    '',
  )
  const match = output.match(/^size:\s+([\d.]+)(KB|MB)$/m)
  if (!match) throw new Error(`Could not read the ${name} dependency size from deno info.`)
  const bytes = Number(match[1]) * (match[2] === 'MB' ? 1024 * 1024 : 1024)
  console.log(`${name}: ${match[1]}${match[2]}`)
  if (bytes >= limitInBytes) throw new Error(`${name} exceeds the 5 MB server-side bundle threshold.`)
}
