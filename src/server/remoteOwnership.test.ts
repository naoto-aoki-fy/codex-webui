import { expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCodexBridgeMiddleware } from './codexAppServerBridge'
import { ProjectFileService } from './appServerFileSystem'
import { getLocalDirectoryListing } from './localBrowseUi'

vi.mock('node:child_process', () => ({ spawn: () => { throw new Error('Unexpected local execution') }, spawnSync: () => { throw new Error('Unexpected local execution') } }))
it.each(['/only-on-B/repository', 'D:\\only-on-B\\repository'])('browses, registers, and starts threads in a remote-only workspace %s', async path => {
  const state = await mkdtemp(join(tmpdir(), 'ownership-state-'))
  const scope = globalThis as any
  const previous = scope.__codexRemoteSharedBridge__
  vi.stubEnv('CODEX_HOME', state)
  await expect(access(path)).rejects.toThrow()
  const projects: any[] = []
  const rpc = vi.fn(async (method, p) => {
    if (method === 'project/list') return { data: projects, nextCursor: null }
    if (method === 'project/create') { const project = { id: 'native-project', name: p.name, roots: p.roots, metadata: {}, position: 0 }; projects.push(project); return { project } }
    if (method === 'fs/getMetadata') return { isDirectory: true, isFile: false }
    if (method === 'fs/readDirectory') return { entries: [{ fileName: 'child', isDirectory: true }] }
    if (method === 'thread/start') return { thread: { id: 'remote-thread', cwd: p.cwd } }
    throw new Error('Unexpected RPC ' + method)
  })
  const client = { rpc, getSnapshotEpoch: () => null, storeThreadReadSnapshot: vi.fn() }
  const files = new ProjectFileService(client)
  scope.__codexRemoteSharedBridge__ = { version: 'external-websocket-files-v4', appServer: client, files, methodCatalog: {} }
  const middleware = createCodexBridgeMiddleware()
  const request = async (url: string, body?: unknown) => {
    const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method: body ? 'POST' : 'GET', url, headers: {} }) as any
    let result = ''
    const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn(), write: vi.fn(), end: (value: string) => { result += value } }) as any
    await middleware(req, res, vi.fn())
    expect(res.statusCode).toBe(200)
    return JSON.parse(result)
  }
  try {
    expect((await getLocalDirectoryListing(path, files)).entries[0].path).toContain('child')
    expect((await request('/codex-api/project-root', { path })).data.path).toBe(path)
    expect((await request('/codex-api/rpc', { method: 'thread/start', params: { cwd: path } })).result.thread.cwd).toBe(path)
    await expect(access(path)).rejects.toThrow()
  } finally { scope.__codexRemoteSharedBridge__ = previous; vi.unstubAllEnvs(); await rm(state, { recursive: true }) }
})
it('reads B content at an identical lexical path without changing A', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ownership-collision-'))
  const path = join(directory, 'same.txt')
  await writeFile(path, 'A sentinel')
  const files = new ProjectFileService({ rpc: vi.fn(async () => ({ dataBase64: Buffer.from('B content').toString('base64') })) })
  try {
    expect((await files.readFile(path)).toString()).toBe('B content')
    expect(await readFile(path, 'utf8')).toBe('A sentinel')
  } finally { await rm(directory, { recursive: true }) }
})
