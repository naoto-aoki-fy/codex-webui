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
