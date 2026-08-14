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
    const signInAnonymously = vi.fn().mockResolvedValue({ data: { user: { id: 'new-user', is_anonymous: true } }, error: null })
    const client = { auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously,
    } } as unknown as SupabaseClient

    await expect(createRepository(client).ensureSession()).resolves.toEqual({ id: 'new-user', email: null, isAnonymous: true })
    expect(signInAnonymously).toHaveBeenCalledOnce()
  })

  it('links an email to the current guest identity instead of creating a replacement user', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: 'guest-user', email: null, is_anonymous: true } }, error: null })
    const client = { auth: { updateUser } } as unknown as SupabaseClient

    await expect(createRepository(client).beginAccountUpgrade('person@example.com', 'https://app.test/?account=confirmed')).resolves.toMatchObject({ id: 'guest-user', isAnonymous: true })
    expect(updateUser).toHaveBeenCalledWith(
      { email: 'person@example.com' },
      { emailRedirectTo: 'https://app.test/?account=confirmed' },
    )
  })

  it('flushes pending guest writes before switching to an existing account', async () => {
    const write = deferred<{ data: null; error: null }>()
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: { id: 'account-user', email: 'person@example.com', is_anonymous: false } }, error: null })
    const client = { rpc: vi.fn().mockReturnValue(write.promise), auth: { signInWithPassword } } as unknown as SupabaseClient
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
