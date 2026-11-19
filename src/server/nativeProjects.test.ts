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
    if (method === 'project/create') {
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
  return { rpc, projects, threads, service: new NativeProjects(rpc) }
}

it('uses native names, roots, order and empty projects while preserving old state', async () => {
  const seed = { ...legacy, 'codexapp-native-project-migrations-v1': { fixture: { completed: false } } }
  await writeFile(statePath(), JSON.stringify(seed))
  const f = fixture()
  const p = { id: 'one', name: 'Same', roots: [{ path: '/a' }], metadata: {}, position: 0 }
  f.projects.push(p, { ...p, id: 'two' }, { ...p, id: 'empty', roots: [] })
  const [state, concurrent] = await Promise.all([f.service.read(), f.service.read()])
  expect(concurrent).toBe(state)
  expect(state.nativeProjects.map(p => p.id)).toEqual(['one', 'two', 'empty'])
  await f.service.operation({ type: 'rename', projectId: 'two', name: 'Renamed' })
  await f.service.operation({ type: 'move', projectId: 'two', beforeProjectId: 'one' })
  expect((await f.service.read()).nativeProjects.map(p => p.name)).toEqual(['Renamed', 'Same', 'Same'])
  await f.service.operation({ type: 'delete', projectId: 'one' })
  expect((await f.service.read()).nativeProjects.map(p => p.id)).toEqual(['two', 'empty'])
  expect(JSON.parse(await readFile(statePath(), 'utf8'))).toEqual(seed)
})
it('supports new installations and native registration without legacy state writes', async () => {
  const f = fixture()
  const first = await f.service.register('/remote/root')
  expect(await f.service.register('/remote/root')).toEqual(first)
  expect(f.rpc.mock.calls.map(([method]) => method)).toEqual(['project/list', 'project/create', 'project/list'])
  expect(f.projects).toHaveLength(1)
  await expect(readFile(statePath())).rejects.toMatchObject({ code: 'ENOENT' })
})
it.each([-32601, -32000])('distinguishes missing native APIs from permission/transport errors: %s', async code => {
  const f = fixture()
  f.rpc.mockRejectedValue(Object.assign(new Error('permission/transport'), { code }))
  await expect(f.service.read()).rejects.toThrow(code === -32601 ? 'Upgrade' : 'permission/transport')
})
