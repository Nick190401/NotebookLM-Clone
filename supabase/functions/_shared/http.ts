// Kept aligned with @supabase/supabase-js/cors without importing the full SDK
// into latency- and bundle-sensitive Edge Functions.
const ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage'
const ALLOWED_METHODS = 'POST, OPTIONS'

function configuredOrigins() {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/**
 * Browser callers are restricted to the origins in ALLOWED_ORIGINS. The wildcard
 * only applies while that secret is unset, which keeps local development usable
 * without silently shipping an open policy to a configured deployment.
 */
export function corsHeadersFor(request: Request): Record<string, string> {
  const base = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Max-Age': '86400',
  }
  const allowed = configuredOrigins()
  if (!allowed.length) return { ...base, 'Access-Control-Allow-Origin': '*' }

  const origin = request.headers.get('Origin')?.replace(/\/$/, '')
  return {
    ...base,
    'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0],
    Vary: 'Origin',
  }
}

/**
 * Owns preflight and CORS for every response, including streamed ones, so the
 * individual handlers never repeat the policy.
 */
export function withCors(handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const cors = corsHeadersFor(request)
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
    const response = await handler(request)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(cors)) headers.set(name, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfter?: string,
  ) {
    super(message)
  }
}

export interface AuthContext {
  authorization: string
  publishableKey: string
  supabaseUrl: string
  userId: string
}

export function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    console.error('Request failed', JSON.stringify({ code: error.code, status: error.status, message: error.message }))
    const headers = error.retryAfter ? { 'Retry-After': error.retryAfter } : undefined
    return jsonResponse(
      { error: { code: error.code, message: error.message, retryAfter: error.retryAfter } },
      error.status,
      headers,
    )
  }
  console.error(error)
  return jsonResponse(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected Edge Function error occurred.' } },
    500,
  )
}

function publishableKey() {
  const direct = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')
  if (direct) return direct
  const named = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (named) {
    try {
      const values = Object.values(JSON.parse(named) as Record<string, string>)
      if (values[0]) return values[0]
    } catch {
      throw new HttpError('Supabase publishable keys are malformed.', 'SUPABASE_NOT_CONFIGURED', 503)
    }
  }
  throw new HttpError('Supabase publishable key is not configured.', 'SUPABASE_NOT_CONFIGURED', 503)
}

export async function authenticatedContext(request: Request): Promise<AuthContext> {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) throw new HttpError('Authentication required.', 'AUTH_REQUIRED', 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
  if (!supabaseUrl) throw new HttpError('Supabase URL is not configured.', 'SUPABASE_NOT_CONFIGURED', 503)
  const key = publishableKey()

  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: key },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new HttpError('Supabase Auth is currently unavailable.', 'AUTH_UNAVAILABLE', 503)
  }
  if (response.status === 401 || response.status === 403)
    throw new HttpError('The Supabase session is invalid or expired.', 'AUTH_INVALID', 401)
  if (!response.ok) throw new HttpError('Supabase Auth could not validate the session.', 'AUTH_UNAVAILABLE', 503)
  const user = (await response.json()) as { id?: string }
  if (!user.id) throw new HttpError('The Supabase session has no user.', 'AUTH_INVALID', 401)
  return { authorization, publishableKey: key, supabaseUrl, userId: user.id }
}

function serviceRoleKey() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY')
  if (!key) throw new HttpError('Supabase service role key is not configured.', 'SUPABASE_NOT_CONFIGURED', 503)
  return key
}

async function rpc<T>(
  supabaseUrl: string,
  authorization: string,
  apikey: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
      method: 'POST',
      headers: { Authorization: authorization, apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HttpError('The Supabase Data API is currently unavailable.', 'DATABASE_UNAVAILABLE', 503)
  }
  if (!response.ok) {
    console.error('Supabase RPC failed', functionName, response.status, await response.text())
    throw new HttpError('The requested Supabase operation failed.', 'DATABASE_ERROR', 500)
  }
  return (await response.json()) as T
}

export function supabaseRpc<T>(context: AuthContext, functionName: string, body: Record<string, unknown>) {
  return rpc<T>(context.supabaseUrl, context.authorization, context.publishableKey, functionName, body)
}

/**
 * Reserved for the token-bound shared-chat lookup. That RPC returns unredacted
 * source text, so it must stay unreachable from the browser: the caller is
 * already authenticated at the HTTP boundary and the share token authorizes the
 * read. Every other call keeps forwarding the caller JWT so RLS still applies.
 */
export function supabaseServiceRpc<T>(context: AuthContext, functionName: string, body: Record<string, unknown>) {
  const key = serviceRoleKey()
  return rpc<T>(context.supabaseUrl, `Bearer ${key}`, key, functionName, body)
}
