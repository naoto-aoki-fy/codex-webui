import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stageRemoteUpload, MAX_UPLOAD_BYTES } from './remoteUploads'
afterEach(() => vi.unstubAllEnvs())
it.each(['/remote/codex', 'C:\\remote\\codex'])('stages exact bytes on B, records ownership and retains across new clients: %s', async root => {
  const state = await mkdtemp(join(tmpdir(), 'remote-uploads-'))
  const remote = new Map<string, Buffer>()
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71])
  const rpc = vi.fn(async (method, p) => {
    if (method === 'fs/writeFile') remote.set(p.path, Buffer.from(p.dataBase64, 'base64'))
    return {}
  })
  const client = { rpc, resolveCodexHome: async () => root }
  try {
    const a = await stageRemoteUpload(client, 'photo.png', bytes, state)
    const b = await stageRemoteUpload({ ...client }, 'notes.txt', Buffer.from('B'), state)
    expect(a).not.toBe(b)
    expect(remote.get(a)).toEqual(bytes)
    expect(remote.get(b)?.toString()).toBe('B')
    expect(a).toContain('codexapp-uploads')
    expect((await readFile(join(state, 'codexapp-uploads.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line).path)).toEqual([a, b])
    expect(rpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
  } finally { await rm(state, { recursive: true }) }
})
it('does not return a usable attachment on remote-write failure or oversized input', async () => {
  const state = await mkdtemp(join(tmpdir(), 'remote-uploads-'))
  const rpc = vi.fn(async method => { if (method === 'fs/writeFile') throw new Error('Remote permission denied'); return {} })
  const client = { rpc, resolveCodexHome: async () => '/B' }
  try {
    await expect(stageRemoteUpload(client, 'x.txt', Buffer.from('x'), state)).rejects.toThrow('Remote permission denied')
    rpc.mockClear()
    await expect(stageRemoteUpload(client, 'large', Buffer.alloc(MAX_UPLOAD_BYTES + 1), state)).rejects.toThrow('20 MiB')
    expect(rpc).not.toHaveBeenCalled()
  } finally { await rm(state, { recursive: true }) }
})

it('recovers current upload reservations from the journal and enforces shared capacity', async () => {
  const state = await mkdtemp(join(tmpdir(), 'remote-capacity-'))
  const rpc = vi.fn(async (_method: string, _params?: unknown) => ({}))
  const client = { rpc, resolveCodexHome: async () => '/B' }
  const journalPath = join(state, 'codexapp-uploads.jsonl')
  const inventoryPath = join(state, 'codexapp-upload-inventory.json')
  try {
    const olderRecord = JSON.stringify({ path: '/B/codexapp-uploads/legacy', at: '2020-01-01' }) + '\n'
    await writeFile(journalPath, olderRecord)
    vi.stubEnv('CODEXUI_UPLOAD_CAPACITY_BYTES', '4')
    vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'one')
    const first = await stageRemoteUpload(client, 'a', Buffer.from('abc'), state)
    vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'two')
    await expect(stageRemoteUpload(client, 'b', Buffer.from('xy'), state)).rejects.toThrow('capacity reached')
    await rm(inventoryPath)
    await expect(stageRemoteUpload(client, 'b', Buffer.from('xy'), state)).rejects.toThrow('capacity reached')
    const second = await stageRemoteUpload(client, 'b', Buffer.from('x'), state)
    const { records } = JSON.parse(await readFile(inventoryPath, 'utf8'))
    expect(records).toEqual([
      expect.objectContaining({ path: '/B/codexapp-uploads/legacy' }),
      expect.objectContaining({ path: first, bytes: 3, status: 'unknown', profile: 'one' }),
      expect.objectContaining({ path: second, bytes: 1, status: 'staged', profile: 'two' }),
    ])
    expect((await readFile(journalPath, 'utf8')).startsWith(olderRecord)).toBe(true)
    expect(rpc.mock.calls.filter(([method]) => method === 'fs/writeFile')).toHaveLength(2)
    expect(rpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
  } finally { await rm(state, { recursive: true, force: true }) }
})
it('serializes capacity reservations and retains an ambiguous write reservation', async () => {
  const state = await mkdtemp(join(tmpdir(), 'remote-race-'))
  vi.stubEnv('CODEXUI_UPLOAD_CAPACITY_BYTES', '4')
  const rpc = vi.fn(async (method: string) => { if (method === 'fs/writeFile') throw new Error('Disconnected after send'); return {} })
  const client = { rpc, resolveCodexHome: async () => '/B' }
  try {
    const results = await Promise.allSettled([
      stageRemoteUpload(client, 'a', Buffer.from('abc'), state),
      stageRemoteUpload(client, 'b', Buffer.from('abc'), state),
    ])
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(rpc.mock.calls.filter(([method]) => method === 'fs/writeFile')).toHaveLength(1)
    const { records } = JSON.parse(await readFile(join(state, 'codexapp-upload-inventory.json'), 'utf8'))
    expect(records).toEqual([expect.objectContaining({ bytes: 3, status: 'unknown' })])
    expect(rpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
  } finally { await rm(state, { recursive: true, force: true }) }
})

it('preserves the explicit remote upload override without home discovery', async () => {
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '\\\\host\\share\\uploads')
  const state = await mkdtemp(join(tmpdir(), 'remote-override-'))
  const client = { rpc: vi.fn(async () => ({})), resolveCodexHome: vi.fn(async () => { throw new Error('must not discover') }) }
  try {
    const path = await stageRemoteUpload(client, 'x', Buffer.from('x'), state)
    expect(path.startsWith('\\\\host\\share\\uploads\\codexapp-uploads\\')).toBe(true)
    expect(client.resolveCodexHome).not.toHaveBeenCalled()
    expect(client.rpc.mock.calls.some(args => (args as unknown[])[0] === 'config/read')).toBe(false)
  } finally { await rm(state, { recursive: true, force: true }) }
})
