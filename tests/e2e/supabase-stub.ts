import type { Page, Route } from '@playwright/test'

export const SUPABASE_HOST = 'https://e2e.supabase.co'

function base64Url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Shape-compatible token: the stub never verifies it, the client only reads exp. */
function accessToken(userId: string) {
  const expires = Math.floor(Date.now() / 1000) + 3_600
  return [
    base64Url({ alg: 'HS256', typ: 'JWT' }),
    base64Url({ sub: userId, role: 'authenticated', exp: expires, is_anonymous: true }),
    'e2e-signature',
  ].join('.')
}

function session(userId = 'e2e-user') {
  return {
    access_token: accessToken(userId),
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 3_600,
    expires_at: Math.floor(Date.now() / 1000) + 3_600,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: '',
      is_anonymous: true,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
}

export interface StubOptions {
  /** Text the streamed chat answer produces, split into server-sent chunks. */
  answerChunks?: string[]
  citations?: { sourceId: string; label: number; excerpt: string }[]
}

interface StubState {
  notebooks: Record<string, unknown>[]
  savedSnapshots: Record<string, unknown>[]
}

function sse(events: unknown[]) {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
}

/** Routes every Supabase call to an in-memory double; the bundle under test stays real. */
export async function stubSupabase(page: Page, options: StubOptions = {}) {
  const state: StubState = { notebooks: [], savedSnapshots: [] }

  await page.route(`${SUPABASE_HOST}/auth/v1/**`, (route) => {
    const url = route.request().url()
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({ json: session().user })
    }
    return route.fulfill({ json: session() })
  })

  await page.route(`${SUPABASE_HOST}/rest/v1/rpc/*`, async (route: Route) => {
    const name = route.request().url().split('/').pop()?.split('?')[0]
    const body = route.request().postDataJSON() as Record<string, unknown> | null

    if (name === 'load_workspace') {
      return route.fulfill({
        json: { notebooks: state.notebooks, settings: { theme: 'system', outputLanguage: 'English' } },
      })
    }
    if (name === 'save_notebook_snapshot') {
      const snapshot = body?.snapshot as Record<string, unknown>
      state.savedSnapshots.push(snapshot)
      const index = state.notebooks.findIndex((notebook) => notebook.id === snapshot.id)
      if (index >= 0) state.notebooks[index] = snapshot
      else state.notebooks.unshift(snapshot)
      return route.fulfill({ status: 204, body: '' })
    }
    if (name === 'consume_ai_quota') {
      return route.fulfill({ json: { allowed: true, bucket: 'chat', limit: 60, remaining: 59, retryAfterSeconds: 0 } })
    }
    return route.fulfill({ json: null })
  })

  await page.route(`${SUPABASE_HOST}/functions/v1/notebook-ai`, async (route) => {
    const body = route.request().postDataJSON() as { action?: string; sourceIds?: string[] } | null

    if (body?.action === 'status') {
      return route.fulfill({
        json: {
          configured: true,
          provider: 'Groq',
          primaryModel: 'openai/gpt-oss-120b',
          fallbackModel: 'openai/gpt-oss-20b',
          fastModel: 'llama-3.1-8b-instant',
        },
      })
    }

    if (body?.action === 'chat') {
      const sourceId = body.sourceIds?.[0] ?? 'source-a'
      const chunks = options.answerChunks ?? ['Reliable ten-minute service ', 'improved public trust. [1]']
      const citations = options.citations ?? [
        { sourceId, label: 1, excerpt: 'Reliable ten-minute service improved public trust.' },
      ]
      return route.fulfill({
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        body: sse([
          { type: 'context', usedSourceIds: [sourceId], omittedSourceIds: [] },
          ...chunks.map((text) => ({ type: 'delta', text })),
          { type: 'done', citations, model: 'openai/gpt-oss-120b' },
        ]),
      })
    }

    return route.fulfill({ json: {} })
  })

  await page.route(`${SUPABASE_HOST}/functions/v1/source-import`, (route) =>
    route.fulfill({
      json: {
        imported: {
          title: 'Imported evidence',
          kind: 'text',
          origin: 'evidence.txt',
          content: 'Reliable ten-minute service improved public trust.',
        },
      },
    }),
  )

  return state
}
