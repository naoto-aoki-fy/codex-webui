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
  const client = { rpc, getInitializationMetadata: () => ({ codexHome: root }) as any }
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
  const client = { rpc, getInitializationMetadata: () => ({ codexHome: '/B' }) as any }
  try {
    await expect(stageRemoteUpload(client, 'x.txt', Buffer.from('x'), state)).rejects.toThrow('Remote permission denied')
    rpc.mockClear()
    await expect(stageRemoteUpload(client, 'large', Buffer.alloc(MAX_UPLOAD_BYTES + 1), state)).rejects.toThrow('20 MiB')
    expect(rpc).not.toHaveBeenCalled()
  } finally { await rm(state, { recursive: true }) }
})
