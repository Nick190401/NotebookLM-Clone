import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createBlankNotebook } from '../../src/lib/notebook'
import { createRepository } from '../../src/lib/repository'
import { makeSource } from '../../src/lib/source'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Supabase repository', () => {
  it('creates an anonymous session only when no session exists', async () => {
    const signInAnonymously = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: 'new-user', is_anonymous: true } }, error: null })
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously,
      },
    } as unknown as SupabaseClient

    await expect(createRepository(client).ensureSession()).resolves.toEqual({
      id: 'new-user',
      email: null,
      isAnonymous: true,
    })
    expect(signInAnonymously).toHaveBeenCalledOnce()
  })

  it('links an email to the current guest identity instead of creating a replacement user', async () => {
    const updateUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: 'guest-user', email: null, is_anonymous: true } }, error: null })
    const client = { auth: { updateUser } } as unknown as SupabaseClient

    await expect(
      createRepository(client).beginAccountUpgrade('person@example.com', 'https://app.test/?account=confirmed'),
    ).resolves.toMatchObject({ id: 'guest-user', isAnonymous: true })
    expect(updateUser).toHaveBeenCalledWith(
      { email: 'person@example.com' },
      { emailRedirectTo: 'https://app.test/?account=confirmed' },
    )
  })

  it('flushes pending guest writes before switching to an existing account', async () => {
    const write = deferred<{ data: null; error: null }>()
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: { id: 'account-user', email: 'person@example.com', is_anonymous: false } },
      error: null,
    })
    const client = {
      rpc: vi.fn().mockReturnValue(write.promise),
      auth: { signInWithPassword },
    } as unknown as SupabaseClient
    const repository = createRepository(client)
    const notebook = createBlankNotebook('Guest research')

    const save = repository.saveNotebook(notebook)
    const signIn = repository.signIn('person@example.com', 'valid-password')
    await Promise.resolve()
    expect(signInWithPassword).not.toHaveBeenCalled()

    write.resolve({ data: null, error: null })
    await save
    await expect(signIn).resolves.toEqual({ id: 'account-user', email: 'person@example.com', isAnonymous: false })
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'person@example.com', password: 'valid-password' })
  })

  it('signs out only the current browser session after pending writes finish', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { signOut } } as unknown as SupabaseClient

    await createRepository(client).signOut()
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('loads a token-bound shared notebook without adding it to the viewer workspace', async () => {
    const notebook = createBlankNotebook('Shared research')
    const rpc = vi.fn().mockResolvedValue({ data: { access: 'full', notebook }, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.loadSharedNotebook('33333333-3333-4333-8333-333333333333')).resolves.toEqual({
      access: 'full',
      notebook,
    })
    expect(rpc).toHaveBeenCalledWith('load_shared_notebook', {
      requested_share_token: '33333333-3333-4333-8333-333333333333',
    })
  })

  it('reports a revoked shared notebook without exposing another workspace', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.loadSharedNotebook('33333333-3333-4333-8333-333333333333')).rejects.toThrow(
      'unavailable or has been revoked',
    )
  })

  it('updates sharing through the owner-bound RPC', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { access: 'chat', token: '33333333-3333-4333-8333-333333333333' }, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)

    await expect(repository.setNotebookSharing('notebook-a', 'chat')).resolves.toEqual({
      access: 'chat',
      token: '33333333-3333-4333-8333-333333333333',
    })
    expect(rpc).toHaveBeenCalledWith('set_notebook_sharing', {
      requested_notebook_id: 'notebook-a',
      requested_access: 'chat',
    })
  })

  it('serializes snapshots for the same notebook so older writes cannot win', async () => {
    const first = deferred<{ data: null; error: null }>()
    const rpc = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)
    const notebook = {
      ...createBlankNotebook('First title'),
      sources: [makeSource({ title: 'Evidence', kind: 'text', origin: 'test', content: 'Large source text' })],
    }

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

  it('coalesces a burst of edits into one follow-up write without dropping content', async () => {
    const first = deferred<{ data: null; error: null }>()
    const rpc = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)
    const sources = Array.from({ length: 18 }, (_, index) =>
      makeSource({ title: `Evidence ${index}`, kind: 'text', origin: 'test', content: `Body ${index}` }),
    )
    const notebook = { ...createBlankNotebook('Toggling notebook'), sources }

    const save = repository.saveNotebook(notebook)
    // Mirrors rapid source toggling: only the selected flags change each time.
    for (let edit = 1; edit <= 8; edit += 1) {
      void repository.saveNotebook({
        ...notebook,
        title: `Edit ${edit}`,
        sources: sources.map((source, index) => ({ ...source, selected: index % 2 === edit % 2 })),
      })
    }
    await Promise.resolve()
    expect(rpc).toHaveBeenCalledTimes(1)

    first.resolve({ data: null, error: null })
    await save

    expect(rpc).toHaveBeenCalledTimes(2)
    const written = rpc.mock.calls[1][1].snapshot
    expect(written.title).toBe('Edit 8')
    // Coalescing must never shrink the notebook: every source has to survive, and
    // unchanged bodies are omitted only because the RPC restores them server-side.
    expect(written.sources).toHaveLength(18)
    expect(written.sources.map((source: { id: string }) => source.id)).toEqual(sources.map((source) => source.id))
    expect(rpc.mock.calls[0][1].snapshot.sources).toHaveLength(18)
    expect(rpc.mock.calls[0][1].snapshot.sources[0]).toHaveProperty('content', 'Body 0')
  })

  it('flushing a notebook waits for the coalesced follow-up write', async () => {
    const first = deferred<{ data: null; error: null }>()
    const rpc = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)
    const notebook = createBlankNotebook('Flushed notebook')

    void repository.saveNotebook(notebook)
    void repository.saveNotebook({ ...notebook, title: 'Latest before flush' })
    first.resolve({ data: null, error: null })
    await repository.flushNotebook(notebook.id)

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).toMatchObject({ snapshot: { title: 'Latest before flush' } })
  })

  it('a failed write does not strand later edits behind a dead writer', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'network down' } })
      .mockResolvedValue({ data: null, error: null })
    const repository = createRepository({ rpc } as unknown as SupabaseClient)
    const notebook = createBlankNotebook('Recovering notebook')

    await expect(repository.saveNotebook(notebook)).rejects.toThrow('could not be saved')
    await expect(repository.saveNotebook({ ...notebook, title: 'After recovery' })).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
