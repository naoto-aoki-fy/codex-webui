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
  expect(JSON.parse(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).file).toMatchObject({ thread: { id: 'file', preview: 'notes.txt', cwd: '/project' }, firstTurnId: 'turn1' })
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

it('keeps archive, rename and deletion state across restart', async () => {
  const rpc = async (m: string) => m === 'thread/read' ? { thread } : m === 'turn/start' ? { turn: { id: 'turn1' } } : { data: [] }
  await index.call('turn/start', params, rpc)
  await index.call('thread/name/set', { threadId: 'file', name: 'Named' }, rpc)
  await index.call('thread/archive', { threadId: 'file' }, rpc)
  index = new PersistentThreadIndex(() => home)
  expect((await index.call('thread/list', {}, rpc)).data).toEqual([])
  expect(JSON.parse(await readFile(join(home, 'codexapp-thread-index.json'), 'utf8')).file).toMatchObject({ archived: true, thread: { name: 'Named' } })
  await index.call('thread/unarchive', { threadId: 'file' }, rpc)
  await index.call('thread/delete', { threadId: 'file' }, rpc)
  expect((await index.call('thread/list', {}, rpc)).data).toEqual([])
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
