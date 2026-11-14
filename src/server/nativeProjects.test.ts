import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeProjects } from './nativeProjects'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'native-projects-')); vi.stubEnv('CODEX_HOME', home) })
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) })
const imported = { 'conversation-transfers-v1': { receipt: { destinationId: 't', stage: 'ready', messages: [{ role: 'assistant', text: 'old imported answer' }] } } }
const legacy = { 'electron-saved-workspace-roots': ['/a', '/empty'], 'electron-workspace-root-labels': { '/a': 'Named A', '/empty': 'Empty' }, 'active-workspace-roots': ['/a'], 'project-order': ['/empty', '/a'], ...imported }
const statePath = () => join(home, '.codex-global-state.json')
function fixture() {
  let seq = 0
  const projects: any[] = []
  const threads = new Map<string, any>([['t', { id: 't', cwd: '/a', projectId: null, createdAt: 1, updatedAt: 1, turns: [], preview: 'text', archived: false }], ['archived', { id: 'archived', cwd: '/a', projectId: null, createdAt: 1, updatedAt: 1, turns: [], archived: true }]])
  const keys = new Map<string, any>()
  const rpc = vi.fn(async (method: string, p: any): Promise<any> => {
    if (method === 'project/list') return { data: projects.map((project, position) => ({ ...project, position })), nextCursor: null }
    if (method === 'thread/list') return { data: [...threads.values()].filter(t => t.archived === p.archived && !t.hidden), nextCursor: null }
    if (method === 'project/import' || method === 'project/create') {
      if (keys.has(p.idempotencyKey)) return { project: keys.get(p.idempotencyKey) }
      const project = { id: 'p' + ++seq, name: p.name, roots: p.roots, metadata: p.metadata || {}, position: projects.length, createdAt: 1, updatedAt: 1, recencyAt: null }
      projects.push(project); keys.set(p.idempotencyKey, project)
      for (const id of p.threads || []) threads.get(id).projectId = project.id
      return { project }
    }
    if (method === 'project/read') return { project: projects.find(v => v.id === p.projectId) }
    if (method === 'thread/read') return { thread: threads.get(p.threadId) }
    if (method === 'thread/metadata/update') { threads.get(p.threadId).projectId = p.projectId; return { thread: threads.get(p.threadId) } }
    if (method === 'project/move') {
      const [project] = projects.splice(projects.findIndex(v => v.id === p.projectId), 1)
      const index = p.beforeProjectId ? projects.findIndex(v => v.id === p.beforeProjectId) : projects.length
      projects.splice(index, 0, project); return {}
    }
    if (method === 'project/update') { const project = projects.find(v => v.id === p.projectId); Object.assign(project, { name: p.name }); return { project } }
    if (method === 'project/delete') { projects.splice(projects.findIndex(v => v.id === p.projectId), 1); for (const thread of threads.values()) if (thread.projectId === p.projectId) thread.projectId = null; return {} }
    throw new Error('Unexpected ' + method)
  })
  return { rpc, projects, threads, service: new NativeProjects(rpc, () => 'test-server/home') }
}

it('migrates empty projects, labels, roots, order and archived/unarchived members once; preserves legacy/imported data', async () => {
  await writeFile(statePath(), JSON.stringify(legacy))
  const f = fixture()
  const [first, concurrent] = await Promise.all([f.service.read(), f.service.read()])
  expect(first).toEqual(concurrent)
  expect(first.nativeProjects?.map(p => [p.name, p.roots])).toEqual([['Empty', [{ path: '/empty' }]], ['Named A', [{ path: '/a' }]]])
  const member = first.nativeProjects![1]!.id
  expect(f.threads.get('t').projectId).toBe(member)
  expect(f.threads.get('archived').projectId).toBe(member)
  expect(JSON.parse(await readFile(statePath(), 'utf8'))).toMatchObject(legacy)
  const before = f.rpc.mock.calls.length
  expect(await new NativeProjects(f.rpc, () => 'test-server/home').read()).toEqual(first)
  expect(f.rpc.mock.calls.slice(before).map(([m]) => m)).toEqual(['project/list'])
  expect(f.projects).toHaveLength(2)
  // Subsequent native edits are never overwritten by stale legacy names/order.
  await f.service.operation({ type: 'rename', projectId: member, name: 'Native name' })
  expect((await f.service.read()).nativeProjects?.[1]?.name).toBe('Native name')
  await f.service.operation({ type: 'delete', projectId: member })
  expect((await f.service.read()).nativeProjects).toHaveLength(1)
  expect(JSON.parse(await readFile(statePath(), 'utf8'))).toMatchObject(legacy)
})

it.each(['lost import reply', 'failed move'])('retries a partial migration after %s without duplicate projects or lost associations', async failure => {
  await writeFile(statePath(), JSON.stringify(legacy))
  const f = fixture(), original = f.rpc.getMockImplementation()!
  let fail = true
  f.rpc.mockImplementation(async (m, p) => {
    if (fail && ((failure === 'failed move' && m === 'project/move') || (failure === 'lost import reply' && m === 'project/import'))) {
      fail = false
      if (m === 'project/import') await original(m, p)
      throw new Error('transport interrupted')
    }
    return original(m, p)
  })
  await expect(f.service.read()).rejects.toThrow('transport interrupted')
  const restarted = new NativeProjects(f.rpc, () => 'test-server/home')
  const state = await restarted.read()
  expect(state.nativeProjects?.map(p => p.name)).toEqual(['Empty', 'Named A'])
  expect(f.projects).toHaveLength(2)
  expect(f.threads.get('t').projectId).toBe(state.nativeProjects![1]!.id)
})

it('repairs an import missing a thread association and rejects an unsupported association method without falling back', async () => {
  await writeFile(statePath(), JSON.stringify(legacy))
  const f = fixture(), original = f.rpc.getMockImplementation()!
  let supported = false
  f.rpc.mockImplementation(async (m, p) => {
    if (m === 'project/import') return original(m, { ...p, threads: [] })
    if (m === 'thread/metadata/update' && !supported) throw Object.assign(new Error('unsupported thread association'), { code: -32601 })
    return original(m, p)
  })
  await expect(f.service.read()).rejects.toThrow('unsupported thread association')
  supported = true
  const state = await f.service.read()
  expect(f.threads.get('t').projectId).toBe(state.nativeProjects![1]!.id)
  expect(f.projects).toHaveLength(2)
})

it('uses a read-only legacy fallback only for explicit project/list absence before any migration; never for transport or denied calls', async () => {
  await writeFile(statePath(), JSON.stringify(legacy))
  for (const code of [-32601, -32000, undefined]) {
    const rpc = vi.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code }))
    const service = new NativeProjects(rpc, () => 'other-server')
    if (code === -32601) {
      expect(await service.read()).toMatchObject({ projectMode: 'legacy-readonly', order: ['/a', '/empty'] })
      await expect(service.register('/new')).rejects.toThrow('read-only')
    } else await expect(service.read()).rejects.toThrow('unavailable')
    expect(rpc.mock.calls.every(([m]) => m === 'project/list')).toBe(true)
    expect(JSON.parse(await readFile(statePath(), 'utf8'))).toEqual(legacy)
  }
})

it('adopts one exact existing native project and preserves unrelated native order; refuses conflicting native membership', async () => {
  await writeFile(statePath(), JSON.stringify(legacy))
  const f = fixture()
  const exact = { id: 'existing', name: 'Named A', roots: [{ path: '/a' }], metadata: {}, position: 0 }
  f.projects.push(exact, { ...exact, id: 'unrelated', name: 'Unrelated', roots: [{ path: '/other' }], position: 1 })
  f.threads.get('t').projectId = 'unrelated'
  await expect(f.service.read()).rejects.toThrow('conflicts with thread')
  expect(f.rpc.mock.calls.some(([m]) => m === 'project/import')).toBe(false)
  f.threads.get('t').projectId = 'existing'
  expect((await f.service.read()).nativeProjects?.map(p => p.id)).toEqual(['p1', 'existing', 'unrelated'])
  expect(f.rpc.mock.calls.filter(([m]) => m === 'project/import')).toHaveLength(1)
})

it('checkpoints accepted destination IDs before validation so incompatible replies cannot create duplicates on retry', async () => {
  await writeFile(statePath(), JSON.stringify(legacy))
  const f = fixture(), original = f.rpc.getMockImplementation()!
  let corrupt = true
  f.rpc.mockImplementation(async (m, p) => {
    const result = await original(m, p)
    if (m === 'project/import' && corrupt) result.project.name = 'incorrect native name'
    return result
  })
  await expect(f.service.read()).rejects.toThrow('did not preserve name/roots')
  expect(f.projects).toHaveLength(1)
  corrupt = false
  f.projects[0].name = 'Empty'
  expect((await f.service.read()).nativeProjects?.map(p => p.name)).toEqual(['Empty', 'Named A'])
  expect(f.projects).toHaveLength(2)
})

it('migrates existing injected-only imports omitted by native lists without changing their transcript receipts', async () => {
  const seed = { ...legacy, 'conversation-transfers-v1': { old: { destinationId: 'hidden-import', stage: 'ready', messages: [{ role: 'assistant', text: 'original imported content' }] } } }
  await writeFile(statePath(), JSON.stringify(seed))
  const f = fixture()
  f.threads.set('hidden-import', { ...f.threads.get('t'), id: 'hidden-import', hidden: true })
  const state = await f.service.read()
  expect(f.threads.get('hidden-import').projectId).toBe(state.nativeProjects![1]!.id)
  expect(JSON.parse(await readFile(statePath(), 'utf8'))['conversation-transfers-v1']).toEqual(seed['conversation-transfers-v1'])
  expect(f.rpc.mock.calls.filter(([m, p]) => m === 'thread/read' && p.threadId === 'hidden-import').every(([, p]) => p.includeTurns === false)).toBe(true)
})

it('does not overwrite an association changed by another client while migration was interrupted', async () => {
  await writeFile(statePath(), JSON.stringify(legacy))
  const f = fixture(), original = f.rpc.getMockImplementation()!
  let interrupted = true
  f.rpc.mockImplementation(async (m, p) => {
    if (interrupted && m === 'project/read') { interrupted = false; throw new Error('disconnect') }
    return original(m, p)
  })
  await expect(f.service.read()).rejects.toThrow('disconnect')
  f.threads.get('t').projectId = 'another-client-project'
  await expect(f.service.read()).rejects.toThrow('changed native project during migration')
  expect(f.threads.get('t').projectId).toBe('another-client-project')
})
