import { expect, it, vi } from 'vitest'
import { ProjectFileService, projectPath } from './appServerFileSystem'
import { getLocalDirectoryListing, normalizeLocalPath } from './localBrowseUi'

it('reads binary bytes and preserves the original structured RPC error', async () => {
  const error = Object.assign(new Error('Method not found'), { code: -32601, data: { method: 'fs/readFile' } })
  const rpc = vi.fn().mockResolvedValueOnce({ dataBase64: Buffer.from([0, 255, 1]).toString('base64') }).mockRejectedValueOnce(error)
  const files = new ProjectFileService({ rpc })
  expect(await files.readFile('/remote/binary')).toEqual(Buffer.from([0, 255, 1]))
  await expect(files.readFile('/remote/binary')).rejects.toBe(error)
  expect(rpc).toHaveBeenNthCalledWith(1, 'fs/readFile', { path: '/remote/binary' })
  expect(rpc).toHaveBeenCalledTimes(2)
})

it.each(['/remote/日本 語', 'C:\\remote\\日本 語', '\\\\host\\share\\project'])('lists %s using remote lexical rules without per-entry metadata calls', async path => {
  const rpc = vi.fn().mockResolvedValue({ entries: [
    { fileName: 'file.txt', isFile: true, isDirectory: false },
    { fileName: '.hidden', isFile: false, isDirectory: true },
    { fileName: 'dir2', isFile: false, isDirectory: true },
  ] })
  const files = new ProjectFileService({ rpc })
  const listing = await getLocalDirectoryListing(path, files)
  expect(listing.entries).toEqual([{ name: 'dir2', path: projectPath(path).join(path, 'dir2') }])
  expect(rpc).toHaveBeenCalledExactlyOnceWith('fs/readDirectory', { path })
  expect((await getLocalDirectoryListing(path, files, { showHidden: true })).entries[0]!.name).toBe('.hidden')
})

it('rejects malformed protocol responses instead of displaying an empty directory', async () => {
  const files = new ProjectFileService({ rpc: vi.fn().mockResolvedValue({}) })
  await expect(files.readDirectory('/remote')).rejects.toThrow('Invalid fs/readDirectory')
  await expect(files.getMetadata('/remote')).rejects.toThrow('Invalid fs/getMetadata')
  await expect(files.readFile('/remote')).rejects.toThrow('Invalid fs/readFile')
})


it('normalizes remote file URLs without Web-host path resolution', () => {
  expect(normalizeLocalPath('file:///remote/a%20b')).toBe('/remote/a b')
  expect(normalizeLocalPath('file:///C:/remote/a%20b')).toBe('C:/remote/a b')
  expect(normalizeLocalPath('file://server/share/a%20b')).toBe('\\\\server\\share\\a b')
})

it.each(['//server/share', '\\\\server\\share', 'C:/', 'C:\\', '/remote/'])('preserves remote roots and trailing separators browsing %s', async root => {
  const files = new ProjectFileService({ rpc: vi.fn().mockResolvedValue({ entries: [{ fileName: 'child', isDirectory: true }] }) })
  const listing = await getLocalDirectoryListing(root, files)
  const rules = projectPath(root)
  expect(listing.entries[0]!.path).toBe(rules.join(root, 'child'))
  expect(listing.parentPath).toBe(rules.dirname(root))
  if (root.startsWith('//') || root.startsWith('\\\\')) {
    expect(listing.entries[0]!.path).toBe('\\\\server\\share\\child')
    expect(rules.normalize(listing.parentPath)).toBe('\\\\server\\share\\')
  }
})

const metadata = { isFile: true, isDirectory: false, isSymlink: false, modifiedAtMs: 1, createdAtMs: 1 }

it('coalesces concurrent reads and bounds cache entries, bytes and lifetime', async () => {
  vi.useFakeTimers()
  try {
    const { FILE_CACHE_MAX_BYTES, FILE_CACHE_MAX_ENTRIES, FILE_CACHE_TTL_MS } = await import('./appServerFileSystem')
    const rpc = vi.fn(async () => ({ dataBase64: Buffer.alloc(1024 * 1024).toString('base64') }))
    const files = new ProjectFileService({ rpc })
    const [a, b] = await Promise.all([files.readFile('/remote/file', metadata), files.readFile('/remote/file', metadata)])
    expect(a).toBe(b)
    await files.readFile('/remote/file', metadata)
    expect(rpc).toHaveBeenCalledTimes(1)
    for (let i = 0; i < FILE_CACHE_MAX_ENTRIES + 1; i++) await files.readFile(`/remote/${i}`, metadata)
    expect(files.getCacheStats().bytes).toBeLessThanOrEqual(FILE_CACHE_MAX_BYTES)
    expect(files.getCacheStats().entries).toBeLessThanOrEqual(FILE_CACHE_MAX_ENTRIES)
    expect(files.getCacheStats().pending).toBe(0)
    const calls = rpc.mock.calls.length
    await files.readFile('/remote/32', { ...metadata, modifiedAtMs: 2 })
    expect(rpc).toHaveBeenCalledTimes(calls + 1)
    vi.advanceTimersByTime(FILE_CACHE_TTL_MS + 1)
    await files.readFile('/remote/32', { ...metadata, modifiedAtMs: 2 })
    expect(rpc).toHaveBeenCalledTimes(calls + 2)
    await files.readFile('/remote/32', { ...metadata, modifiedAtMs: 0 })
    await files.readFile('/remote/32', { ...metadata, modifiedAtMs: 0 })
    expect(rpc).toHaveBeenCalledTimes(calls + 4)
  } finally { vi.useRealTimers() }
})

it('clears file state across connection generations and rejects late reads', async () => {
  let generation = 1
  let finish!: (value: unknown) => void
  const rpc = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValue({ dataBase64: Buffer.from('new machine').toString('base64') })
  const files = new ProjectFileService({ rpc, getConnectionGeneration: () => generation })
  const old = files.readFile('/same/path', metadata)
  generation++
  expect(files.getCacheStats()).toEqual({ entries: 0, bytes: 0, pending: 0 })
  expect((await files.readFile('/same/path', metadata)).toString()).toBe('new machine')
  finish({ dataBase64: Buffer.from('old machine').toString('base64') })
  await expect(old).rejects.toThrow('Retired app-server')
  expect((await files.readFile('/same/path', metadata)).toString()).toBe('new machine')
})

it('bounds active file reads instead of launching untracked overflow work', async () => {
  let release!: (value: unknown) => void
  const barrier = new Promise(resolve => { release = resolve })
  const rpc = vi.fn(() => barrier)
  const files = new ProjectFileService({ rpc })
  const pending = Array.from({ length: 64 }, (_, i) => files.readFile(`/remote/${i}`))
  await expect(files.readFile('/remote/overflow')).rejects.toThrow('64 concurrent reads')
  expect(rpc).toHaveBeenCalledTimes(64)
  release({ dataBase64: '' })
  await Promise.all(pending)
  expect(files.getCacheStats().pending).toBe(0)
})
