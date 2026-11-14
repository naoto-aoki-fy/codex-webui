import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeProjects } from './nativeProjects'
import { createThreadPresentationStore } from './threadPresentationStore'
const identity = 'acceptance-connection'
const key = createHash('sha256').update(identity).digest('hex')
const roots = { 'electron-saved-workspace-roots': ['/legacy'] }
const receipt = (completed: boolean) => ({ 'codexapp-native-project-migrations-v1': { [key]: { completed } } })
const cases = [
  { name: 'no legacy data', state: {}, projects: true, pins: true },
  { name: 'unmigrated Projects', state: roots, projects: false, pins: true },
  { name: 'interrupted Project migration', state: { ...roots, ...receipt(false) }, projects: false, pins: true },
  { name: 'completed Project migration', state: { ...roots, ...receipt(true) }, projects: true, pins: true },
  { name: 'pins after completed Project migration', state: { ...roots, ...receipt(true), 'pinned-thread-ids': ['legacy-pin'] }, projects: true, pins: false },
  { name: 'pins without legacy Projects', state: { 'pinned-thread-ids': ['legacy-pin'] }, projects: true, pins: false },
]
let home: string
afterEach(async () => { vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }) })
it.each(cases)('independently fences $name, with byte-preserved state', async row => {
  home = await mkdtemp(join(tmpdir(), 'native-upgrade-acceptance-'))
  vi.stubEnv('CODEX_HOME', home)
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy')
  const path = join(home, '.codex-global-state.json')
  const before = JSON.stringify({ unrelated: { receipt: 'retained' }, ...row.state }, null, 2) + '\n'
  await writeFile(path, before)
  const rpc = vi.fn(async (method: string) => {
    if (method === 'project/list') return { data: [], nextCursor: null }
    if (method === 'thread/list') return { data: [{ id: 'native-pin' }], nextCursor: null }
    throw new Error('Unexpected mutation/read: ' + method)
  })
  const projects = new NativeProjects(rpc, () => identity)
  if (row.projects) await expect(projects.read()).resolves.toMatchObject({ projectMode: 'native' })
  else {
    await expect(projects.read()).rejects.toThrow('pre-cleanup WebUI')
    await expect(projects.register('/new')).rejects.toThrow('pre-cleanup WebUI')
    await expect(projects.operation({ type: 'delete', projectId: 'p' })).rejects.toThrow('pre-cleanup WebUI')
  }
  const pins = createThreadPresentationStore()
  if (row.pins) await expect(pins.readPinnedThreadIds(rpc)).resolves.toEqual(['native-pin'])
  else await expect(pins.readPinnedThreadIds(rpc)).rejects.toThrow('Legacy pin migration is incomplete')
  expect(await readFile(path, 'utf8')).toBe(before)
  expect(rpc.mock.calls.every(([method]) => ['project/list', 'thread/list'].includes(method))).toBe(true)
})
