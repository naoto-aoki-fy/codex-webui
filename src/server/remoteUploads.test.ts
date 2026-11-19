import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { profileStorageDirectory } from './connectionProfile'
import { profileDirectoryName, storageNames } from './webuiStorage.mjs'
import { stageRemoteUpload, MAX_UPLOAD_BYTES } from './remoteUploads'

beforeEach(() => vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', '/dedicated'))
afterEach(() => vi.unstubAllEnvs())

const ledger = (file: string) => join(profileStorageDirectory('data'), storageNames.uploads, file)
const directoryMetadata = { isDirectory: true, isSymlink: false }

function remoteClient(home = '/server/core', request = (method: string, _params: { path: string, dataBase64?: string }) =>
  method === 'fs/getMetadata' ? directoryMetadata : {}) {
  return {
    uploadRpc: vi.fn(async (method: string, params: { path: string, dataBase64?: string }, _generation?: number) => request(method, params)),
    resolveCodexHome: vi.fn(async () => home),
    getConnectionGeneration: () => 17,
  }
}

it.each([
  ['/dedicated', '/dedicated/codexapp-uploads/', '/server/core'],
  ['C:\\remote\\uploads', 'C:\\remote\\uploads\\codexapp-uploads\\', 'C:\\remote\\core'],
  ['\\\\host\\share\\uploads', '\\\\host\\share\\uploads\\codexapp-uploads\\', '\\\\host\\share\\core'],
])('stages exact bytes on the App Server and retains them across new clients: %s', async (root, prefix, home) => {
  vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', root)
  vi.stubEnv('CODEX_HOME', root)
  const remote = new Map<string, Buffer>()
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71])
  const client = remoteClient(home, (method, p) => {
    if (method === 'fs/getMetadata') return directoryMetadata
    if (method === 'fs/writeFile') remote.set(p.path, Buffer.from(p.dataBase64!, 'base64'))
    return {}
  })
  const a = await stageRemoteUpload(client, 'photo.png', bytes)
  const b = await stageRemoteUpload({ ...client }, 'notes.txt', Buffer.from('B'))
  expect(a).not.toBe(b)
  expect(a.startsWith(prefix + profileDirectoryName('unit-test'))).toBe(true)
  expect(remote.get(a)).toEqual(bytes)
  expect(remote.get(b)?.toString()).toBe('B')
  const lines = (await readFile(ledger(storageNames.journal), 'utf8')).trim().split('\n')
  expect(lines.map(line => JSON.parse(line).path)).toEqual([a, b])
  expect(client.uploadRpc.mock.calls.some(([method]) => method === 'fs/remove')).toBe(false)
  expect(client.uploadRpc.mock.calls.every(([, , generation]) => generation === 17)).toBe(true)
})

it('does not return a usable attachment on remote-write failure or oversized input', async () => {
  const client = remoteClient('/B', method => {
    if (method === 'fs/writeFile') throw new Error('Remote permission denied')
    return directoryMetadata
  })
  const { uploadRpc: rpc } = client
  await expect(stageRemoteUpload(client, 'x.txt', Buffer.from('x'))).rejects.toThrow('Remote permission denied')
  rpc.mockClear()
  await expect(stageRemoteUpload(client, 'large', Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toThrow('20 MiB')
  expect(rpc).not.toHaveBeenCalled()
})

it('isolates capacity by ID and recovers current reservations from the same journal', async () => {
  const client = remoteClient()
  const { uploadRpc: rpc } = client
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
  const client = remoteClient('/B', method => {
    if (method === 'fs/writeFile') throw new Error('Disconnected after send')
    return directoryMetadata
  })
  const { uploadRpc: rpc } = client
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

it.each([
  ['', '/custom'], ['relative', '/custom'], ['/dedicated/../custom', '/custom'],
  ['/home/user/.codex/staging', '/custom'], ['/custom', '/custom'], ['/custom/nested', '/custom'],
  ['/CUSTOM/nested', '/custom'], ['C:relative', 'C:\\custom'], ['C:\\custom.\\nested', 'C:\\custom'],
  ['c:/Custom/ATTACHMENTS', 'C:\\custom'], ['\\\\?\\C:\\custom', 'C:\\custom'],
  ['C:\\CUSTOM~1\\nested', 'C:\\custom'], ['C:\\uploads:stream', 'C:\\custom'],
  ['//HOST/SHARE/CUSTOM/child', '\\\\host\\share\\custom'], ['C:\\uploads', '/custom'],
  ['/dedicated', '/dedicated/codexapp-uploads'],
])(
  'rejects invalid or Codex-owned upload roots before making filesystem RPCs: %j', async (root, home) => {
    vi.stubEnv('CODEXUI_REMOTE_UPLOAD_DIR', root)
    const client = remoteClient(home)
    await expect(stageRemoteUpload(client, 'x', Buffer.from('x'))).rejects.toThrow('CODEXUI_REMOTE_UPLOAD_DIR')
    expect(client.uploadRpc).not.toHaveBeenCalled()
  },
)

it.each(['', 'relative', '/custom/..', 'C:relative', '\\\\?\\C:\\core'])(
  'rejects an unknown or invalid Codex home before making filesystem RPCs: %j', async home => {
    vi.stubEnv('CODEX_HOME', '/local-core')
    const client = remoteClient(home)
    await expect(stageRemoteUpload(client, 'x', Buffer.from('x'))).rejects.toThrow('Cannot verify the App Server Codex home')
    expect(client.resolveCodexHome).toHaveBeenCalledWith()
    expect(client.uploadRpc).not.toHaveBeenCalled()
  },
)

it.each(['/dedicated', '/dedicated/codexapp-uploads', '/server'])('rejects links in either path: %s', async linked => {
  const client = remoteClient('/server/core', (_method, { path }) => ({ ...directoryMetadata, isSymlink: path === linked }))
  await expect(stageRemoteUpload(client, 'x', Buffer.from('x'))).rejects.toThrow('Cannot safely verify CODEXUI_REMOTE_UPLOAD_DIR')
  expect(client.uploadRpc.mock.calls.map(([method]) => method)).not.toContain('fs/createDirectory')
  await expect(readFile(ledger(storageNames.journal))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['Permission denied (os error 13)', 'Method not found'])('rejects inconclusive metadata: %s', async message => {
  const client = remoteClient('/server/core', () => { throw Object.assign(new Error(message), { code: -32603 }) })
  await expect(stageRemoteUpload(client, 'x', Buffer.from('x'))).rejects.toThrow('Cannot safely verify CODEXUI_REMOTE_UPLOAD_DIR')
  expect(client.uploadRpc.mock.calls.map(([method]) => method)).toEqual(['fs/getMetadata'])
})

it('permits creating a missing upload root after checking its existing parents', async () => {
  const client = remoteClient('/server/core', (method, { path }) => {
    if (method === 'fs/getMetadata' && path === '/dedicated') {
      throw Object.assign(new Error('No such file or directory (os error 2)'), { code: -32603 })
    }
    return directoryMetadata
  })
  await stageRemoteUpload(client, 'x', Buffer.from('x'))
  const checks = client.uploadRpc.mock.calls.filter(([method]) => method === 'fs/getMetadata')
  expect(checks.map(([, params]) => params.path).sort()).toEqual(['/', '/dedicated', '/server', '/server/core'])
  expect(client.uploadRpc.mock.calls.slice(-2).map(([method]) => method)).toEqual(['fs/createDirectory', 'fs/writeFile'])
})
