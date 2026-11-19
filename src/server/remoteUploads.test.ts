import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { profileStorageDirectory } from './connectionProfile'
import { profileDirectoryName, storageNames } from './webuiStorage.mjs'
import { stageRemoteUpload, MAX_UPLOAD_BYTES } from './remoteUploads'

beforeEach(() => vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '/dedicated'))
afterEach(() => vi.unstubAllEnvs())

const ledger = (file: string) => join(profileStorageDirectory('data'), storageNames.uploads, file)

it.each([
  ['/dedicated', '/dedicated/codexapp-uploads/'],
  ['C:\\remote\\uploads', 'C:\\remote\\uploads\\codexapp-uploads\\'],
  ['\\\\host\\share\\uploads', '\\\\host\\share\\uploads\\codexapp-uploads\\'],
])('stages exact bytes on the App Server and retains them across new clients: %s', async (root, prefix) => {
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', root)
  const remote = new Map<string, Buffer>()
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71])
  const rpc = vi.fn(async (method, p) => {
    if (method === 'fs/writeFile') remote.set(p.path, Buffer.from(p.dataBase64, 'base64'))
    return {}
  })
  const client = { rpc, resolveCodexHome: async () => '' }
  const a = await stageRemoteUpload(client, 'photo.png', bytes)
  const b = await stageRemoteUpload({ ...client }, 'notes.txt', Buffer.from('B'))
  expect(a).not.toBe(b)
  expect(a.startsWith(prefix + profileDirectoryName('unit-test'))).toBe(true)
  expect(remote.get(a)).toEqual(bytes)
  expect(remote.get(b)?.toString()).toBe('B')
  const lines = (await readFile(ledger(storageNames.journal), 'utf8')).trim().split('\n')
  expect(lines.map(line => JSON.parse(line).path)).toEqual([a, b])
  expect(rpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
})

it('does not return a usable attachment on remote-write failure or oversized input', async () => {
  const rpc = vi.fn(async method => { if (method === 'fs/writeFile') throw new Error('Remote permission denied'); return {} })
  const client = { rpc, resolveCodexHome: async () => '/B' }
  await expect(stageRemoteUpload(client, 'x.txt', Buffer.from('x'))).rejects.toThrow('Remote permission denied')
  rpc.mockClear()
  await expect(stageRemoteUpload(client, 'large', Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toThrow('20 MiB')
  expect(rpc).not.toHaveBeenCalled()
})

it('isolates capacity by ID and recovers current reservations from the same journal', async () => {
  const rpc = vi.fn(async (_method: string, _params?: unknown) => ({}))
  const client = { rpc, resolveCodexHome: async () => '/B' }
  vi.stubEnv('CODEXUI_UPLOAD_CAPACITY_BYTES', '4')
  const first = await stageRemoteUpload(client, 'a', Buffer.from('abc'))
  const inventoryPath = ledger(storageNames.inventory)
  const journalPath = ledger(storageNames.journal)
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'two')
  const second = await stageRemoteUpload(client, 'b', Buffer.from('bbbb'))
  expect(second).toContain(profileDirectoryName('two'))
  expect(first).toContain(profileDirectoryName('unit-test'))
  expect(JSON.parse(await readFile(ledger(storageNames.inventory), 'utf8')).records).toEqual([
    expect.objectContaining({ path: second, bytes: 4, status: 'staged' }),
  ])
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'unit-test')
  await rm(inventoryPath)
  await expect(stageRemoteUpload(client, 'c', Buffer.from('xy'))).rejects.toThrow('capacity reached')
  const third = await stageRemoteUpload(client, 'c', Buffer.from('x'))
  expect(JSON.parse(await readFile(inventoryPath, 'utf8')).records).toEqual([
    expect.objectContaining({ path: first, bytes: 3, status: 'unknown' }),
    expect.objectContaining({ path: third, bytes: 1, status: 'staged' }),
  ])
  expect(await readFile(journalPath, 'utf8')).not.toContain(second)
  expect(rpc.mock.calls.filter(([method]) => method === 'fs/writeFile')).toHaveLength(3)
  expect(rpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
})

it('serializes capacity reservations and retains an ambiguous write reservation', async () => {
  vi.stubEnv('CODEXUI_UPLOAD_CAPACITY_BYTES', '4')
  const rpc = vi.fn(async (method: string) => { if (method === 'fs/writeFile') throw new Error('Disconnected after send'); return {} })
  const client = { rpc, resolveCodexHome: async () => '/B' }
  const results = await Promise.allSettled([
    stageRemoteUpload(client, 'a', Buffer.from('abc')),
    stageRemoteUpload(client, 'b', Buffer.from('abc')),
  ])
  expect(results.every(result => result.status === 'rejected')).toBe(true)
  expect(rpc.mock.calls.filter(([method]) => method === 'fs/writeFile')).toHaveLength(1)
  const { records } = JSON.parse(await readFile(ledger(storageNames.inventory), 'utf8'))
  expect(records).toEqual([expect.objectContaining({ bytes: 3, status: 'unknown' })])
  expect(rpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
  await rm(ledger(storageNames.inventory))
  await writeFile(ledger(storageNames.journal), '{corrupt')
  await expect(stageRemoteUpload(client, 'c', Buffer.from('x'))).rejects.toThrow(SyntaxError)
  expect(rpc.mock.calls.filter(([method]) => method === 'fs/writeFile')).toHaveLength(1)
})

it.each(['', 'relative', '/dedicated/../custom', '/home/user/.codex/staging', '/custom', '/custom/nested'])(
  'rejects invalid or Codex-owned upload roots before making filesystem RPCs: %j', async root => {
    vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', root)
    const client = { rpc: vi.fn(), resolveCodexHome: async () => '/custom' }
    await expect(stageRemoteUpload(client, 'x', Buffer.from('x'))).rejects.toThrow('CODEXUI_REMOTE_UPLOAD_DIR')
    expect(client.rpc).not.toHaveBeenCalled()
  },
)
