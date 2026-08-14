import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createBlankNotebook } from '../../src/lib/notebook'
import { createRepository } from '../../src/lib/repository'
import { makeSource } from '../../src/lib/source'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Supabase repository', () => {
  it('creates an anonymous session only when no session exists', async () => {
    const signInAnonymously = vi.fn().mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
    const client = { auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously,
    } } as unknown as SupabaseClient

    await expect(createRepository(client).ensureSession()).resolves.toMatchObject({ id: 'new-user' })
    expect(signInAnonymously).toHaveBeenCalledOnce()
  })

  it('loads a token-bound shared notebook without adding it to the viewer workspace', async () => {
    const notebook = createBlankNotebook('Shared research')
    const rpc = vi.fn().mockResolvedValue({ data: { access: 'full', notebook }, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.loadSharedNotebook('33333333-3333-4333-8333-333333333333')).resolves.toEqual({ access: 'full', notebook })
    expect(rpc).toHaveBeenCalledWith('load_shared_notebook', {
      requested_share_token: '33333333-3333-4333-8333-333333333333',
    })
  })

  it('reports a revoked shared notebook without exposing another workspace', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.loadSharedNotebook('33333333-3333-4333-8333-333333333333')).rejects.toThrow('unavailable or has been revoked')
  })

  it('updates sharing through the owner-bound RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { access: 'chat', token: '33333333-3333-4333-8333-333333333333' }, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.setNotebookSharing('notebook-a', 'chat')).resolves.toEqual({
      access: 'chat', token: '33333333-3333-4333-8333-333333333333',
    })
    expect(rpc).toHaveBeenCalledWith('set_notebook_sharing', {
      requested_notebook_id: 'notebook-a', requested_access: 'chat',
    })
  })

  it('serializes snapshots for the same notebook so older writes cannot win', async () => {
    const first = deferred<{ data: null; error: null }>()
    const rpc = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)
    const notebook = { ...createBlankNotebook('First title'), sources: [makeSource({ title: 'Evidence', kind: 'text', origin: 'test', content: 'Large source text' })] }

    const firstSave = repository.saveNotebook(notebook)
    const secondSave = repository.saveNotebook({ ...notebook, title: 'Latest title' })
    await Promise.resolve()
    expect(rpc).toHaveBeenCalledTimes(1)

    first.resolve({ data: null, error: null })
    await Promise.all([firstSave, secondSave])
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toMatchObject({ snapshot: { title: 'Latest title' } })
    expect(rpc.mock.calls[0][1].snapshot.sources[0]).toHaveProperty('content', 'Large source text')
    expect(rpc.mock.calls[1][1].snapshot.sources[0]).not.toHaveProperty('content')
  })
})
