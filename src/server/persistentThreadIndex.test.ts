import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersistentThreadIndex } from './persistentThreadIndex'
import { buildTextWithAttachments } from '../utils/attachmentPrompt'

let home: string
let index: PersistentThreadIndex
const text = buildTextWithAttachments('', [{ label: 'notes.txt', path: '/uploads/notes.txt' }])
const thread = { id: 'file', cwd: '/project', modelProvider: 'openai', source: 'cli', createdAt: 300, updatedAt: 300, preview: '', turns: [] }
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'thread-index-')); index = new PersistentThreadIndex(() => home) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })
const params = { threadId: 'file', input: [{ type: 'text', text }] }

it('persists accepted files independently and can read, resume and continue by canonical ID after restart', async () => {
  const rpc = vi.fn(async (method: string) => method === 'thread/read' || method === 'thread/resume' ? { thread } : method === 'turn/start' ? { turn: { id: 'turn1' } } : { data: [], nextCursor: null })
  await index.call('turn/start', params, rpc)
  expect(rpc.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(1)
  expect(text.split('## My request for Codex:\n\n')[1]).toBe('\n')
  index = new PersistentThreadIndex(() => home)
  expect(JSON.parse(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).file).toEqual({ firstTurnId: 'turn1' })
  for (const method of ['thread/read', 'thread/resume', 'turn/start']) await index.call(method, params, rpc)
  expect(rpc.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(2)
})

it('reconciles an accepted but lost response without resending', async () => {
  const rpc = vi.fn<(method: string) => Promise<any>>(async (method: string) => {
    if (method === 'turn/start') throw new Error('transport disconnected')
    if (method === 'thread/read') return { thread }
    return { data: [] }
  })
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow('disconnected')
  rpc.mockImplementation(async (method: string) => method === 'thread/read' ? { thread: { ...thread, turns: [{ id: 'accepted', items: [{ type: 'userMessage', content: params.input }] }] } } : { data: [] })
  index = new PersistentThreadIndex(() => home)
  await index.call('thread/read', { threadId: 'file' }, rpc)
  expect(JSON.parse(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).file).toMatchObject({ firstTurnId: 'accepted' })
  expect(rpc.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(1)
})

it('does not retain unused or definitively rejected threads', async () => {
  const rpc = vi.fn<(method: string) => Promise<any>>(async (method: string) => {
    if (method === 'turn/start') throw Object.assign(new Error('rejected'), { code: -32602 })
    return method === 'thread/read' ? { thread } : { data: [] }
  })
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow('rejected')
  expect((await index.call('thread/list', {}, rpc)).data).toEqual([])
})

it('leaves legacy list metadata unchanged through native mutations and restart', async () => {
  const legacy = { thread: { ...thread, name: 'Old' }, archived: false, deleted: false, firstTurnId: 'turn1' }
  const before = JSON.stringify({ file: legacy }, null, 2)
  await writeFile(join(home, 'codexapp-thread-index.json'), before)
  const rpc = vi.fn(async () => ({}))
  for (const method of ['thread/name/set', 'thread/archive', 'thread/unarchive', 'thread/delete']) {
    await index.call(method, { threadId: 'file', name: 'Native name' }, rpc)
    index = new PersistentThreadIndex(() => home)
  }
  expect(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).toBe(before)
  expect(rpc).toHaveBeenCalledTimes(4)
})

it('keeps the pending intent when confirmation persistence fails, without rejecting an accepted send', async () => {
  const rpc = async (method: string) => {
    if (method === 'thread/read') return { thread }
    await writeFile(join(home, 'codexapp-thread-index.json'), 'invalid JSON')
    return { turn: { id: 'accepted' } }
  }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(index.call('turn/start', params, rpc)).resolves.toMatchObject({ turn: { id: 'accepted' } })
  expect(warning).toHaveBeenCalled()
  warning.mockRestore()
})

it('does not send when the initial durable intent cannot be written', async () => {
  await writeFile(join(home, 'codexapp-thread-index.json'), 'invalid')
  const rpc = vi.fn(async () => ({ thread }))
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow()
  expect(rpc.mock.calls).toHaveLength(0)
})

it('does not mistake an earlier identical turn for a new accepted submission', async () => {
  const old = { id: 'old', items: [{ type: 'userMessage', content: params.input }] }
  const rpc = vi.fn<(method: string) => Promise<any>>(async (method: string) => {
    if (method === 'thread/read') return { thread: { ...thread, turns: [old] } }
    if (method === 'turn/start') throw new Error('disconnected')
    return { data: [] }
  })
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow('disconnected')
  index = new PersistentThreadIndex(() => home)
  expect((await index.call('thread/list', {}, rpc)).data).toEqual([])
  expect(JSON.parse(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).file.firstTurnId).toBeUndefined()
})

it('uses fresh thread/start metadata when an unused thread is not readable yet', async () => {
  const rpc = vi.fn(async (method: string) => {
    if (method === 'thread/start') return { thread }
    if (method === 'thread/read') throw new Error('not materialized')
    return { turn: { id: 'accepted' } }
  })
  await index.call('thread/start', {}, rpc)
  await index.call('turn/start', params, rpc)
  expect(rpc.mock.calls.some(([method]) => method === 'thread/read')).toBe(false)
})

it('delegates section membership, order and cursors without injecting indexed rows', async () => {
  await writeFile(join(home, 'codexapp-thread-index.json'), JSON.stringify({ file: { thread, firstTurnId: 'turn', archived: false, deleted: false } }))
  const page = { data: [{ ...thread, id: 'native' }], nextCursor: 'native-cursor' }
  const rpc = vi.fn(async () => page)
  const sectionParams = { sectionId: 'pinned', sortKey: 'section_position', limit: 10 }
  expect(await index.call('thread/list', sectionParams, rpc)).toBe(page)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/list', sectionParams)
})

const stored = async (directory = home) => JSON.parse(await readFile(join(directory, 'codexapp-thread-index.json'), 'utf8'))

it('preserves mixed-format metadata and unrelated recovery records on reconciliation and new sends', async () => {
  const pending = { token: 'lost', text, previous: ['old'] }
  const other = { thread: { id: 'other', preview: 'unique old label' }, pending: { ...pending, token: 'other' }, archived: true, deleted: false }
  const legacy = { thread, archived: false, deleted: false, pending }
  await writeFile(join(home, 'codexapp-thread-index.json'), JSON.stringify({ file: legacy, other }))
  index = new PersistentThreadIndex(() => home)
  const rpc = vi.fn(async (method: string) => method === 'thread/read'
    ? { thread: { ...thread, turns: [{ id: 'accepted', items: [{ type: 'userMessage', content: params.input }] }] } }
    : { turn: { id: 'new-turn' } })
  await index.call('thread/read', { threadId: 'file' }, rpc)
  expect(await stored()).toEqual({ file: { thread, archived: false, deleted: false, firstTurnId: 'accepted' }, other })
  await index.call('turn/start', { ...params, threadId: 'new' }, rpc)
  expect((await stored()).other).toEqual(other)
  expect((await stored()).new).toEqual({ firstTurnId: 'new-turn' })
})

it('blocks retries across restart until a new matching remote turn confirms the lost send', async () => {
  const old = { id: 'old', items: [{ type: 'userMessage', content: params.input }] }
  let remoteTurns = [old]
  const rpc = vi.fn(async (method: string): Promise<any> => {
    if (method === 'thread/read') return { thread: { ...thread, turns: remoteTurns } }
    if (method === 'turn/start') throw new Error('lost response')
    return {}
  })
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow('lost response')
  const intent = (await stored()).file.pending
  expect(intent).toMatchObject({ text, previous: ['old'] })
  index = new PersistentThreadIndex(() => home)
  await index.call('thread/read', { threadId: 'file' }, rpc)
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow('awaiting reconciliation')
  expect((await stored()).file.pending).toEqual(intent)
  remoteTurns = [old, { ...old, id: 'remote-completed' }]
  await index.call('thread/resume', { threadId: 'file' }, async () => ({ thread: { ...thread, turns: remoteTurns } }))
  expect((await stored()).file).toEqual({ firstTurnId: 'remote-completed' })
  expect(rpc.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1)
})

it('isolates recovery for identical thread IDs in separate profile stores', async () => {
  const second = await mkdtemp(join(tmpdir(), 'thread-index-profile-'))
  try {
    const otherIndex = new PersistentThreadIndex(() => second)
    const rpc = async (method: string): Promise<any> => {
      if (method === 'thread/read') return { thread }
      throw new Error('disconnected')
    }
    await expect(index.call('turn/start', params, rpc)).rejects.toThrow('disconnected')
    const before = await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')
    await otherIndex.call('turn/start', params, async method => method === 'thread/read' ? { thread } : { turn: { id: 'other-profile' } })
    expect(await stored(second)).toEqual({ file: { firstTurnId: 'other-profile' } })
    expect(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).toBe(before)
  } finally { await rm(second, { recursive: true, force: true }) }
})

it('clears only a definitively rejected intent and allows a deliberate retry', async () => {
  const rpc = async (method: string): Promise<any> => {
    if (method === 'thread/read') return { thread }
    throw Object.assign(new Error('rejected'), { code: -32602 })
  }
  await expect(index.call('turn/start', params, rpc)).rejects.toThrow('rejected')
  expect((await stored()).file).toEqual({})
  index = new PersistentThreadIndex(() => home)
  await index.call('turn/start', params, async method => method === 'thread/read' ? { thread } : { turn: { id: 'retry' } })
  expect((await stored()).file).toEqual({ firstTurnId: 'retry' })
})

it('passes native pagination through even when local recovery storage is malformed', async () => {
  await writeFile(join(home, 'codexapp-thread-index.json'), 'invalid')
  const pages = [{ data: [{ id: 'native' }], nextCursor: 'next' }, { data: [], nextCursor: null }]
  const rpc = vi.fn(async (_method: string, p: any) => pages[p.cursor ? 1 : 0])
  expect(await index.call('thread/list', { cursor: null }, rpc)).toBe(pages[0])
  expect(await index.call('thread/list', { cursor: 'next' }, rpc)).toBe(pages[1])
  expect(rpc.mock.calls).toEqual([['thread/list', { cursor: null }], ['thread/list', { cursor: 'next' }]])
})

it('preserves independent intents during concurrent writes from separate index instances', async () => {
  const second = new PersistentThreadIndex(() => home)
  const rpc = async (method: string, p: any): Promise<any> => {
    if (method === 'thread/read') return { thread: { ...thread, id: p.threadId } }
    throw new Error('lost response')
  }
  const results = await Promise.allSettled([
    index.call('turn/start', params, rpc),
    second.call('turn/start', { ...params, threadId: 'other' }, rpc),
  ])
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
  const entries = await stored()
  expect(Object.keys(entries).sort()).toEqual(['file', 'other'])
  for (const entry of Object.values(entries) as any[]) expect(entry.pending).toMatchObject({ text, previous: [] })
  expect(entries.file.pending.token).not.toBe(entries.other.pending.token)
})
