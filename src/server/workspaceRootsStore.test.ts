import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as store from './workspaceRootsStore'
import * as bridge from './codexAppServerBridge'
import { updateCodexGlobalState } from './codexGlobalState'

let home: string
const file = () => join(home, '.codex-global-state.json')
const empty = () => ({ order: [], active: [], labels: {}, projectOrder: [], remoteProjects: [] })
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'workspace-store-'))
  vi.stubEnv('CODEX_HOME', home)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

it('preserves the public bridge exports as the same functions', () => {
  expect(bridge.canonicalizeWorkspaceRootsState).toBe(store.canonicalizeWorkspaceRootsState)
  expect(bridge.canonicalizeWorkspaceRootsStateForRead).toBe(store.canonicalizeWorkspaceRootsStateForRead)
  expect(bridge.canonicalizeThreadListResponseForRead).toBe(store.canonicalizeThreadListResponseForRead)
  expect(bridge.writeWorkspaceRootsState).toBe(store.writeWorkspaceRootsState)
})

it('canonicalizes symlinks, deduplicates stably and prefers canonical labels', async () => {
  const root = join(home, 'root')
  const alias = join(home, 'alias')
  await mkdir(root)
  await symlink(root, alias)
  const missing = join(home, 'missing', '..', 'absent')
  const state = await store.canonicalizeWorkspaceRootsState({
    ...empty(), order: [alias, 'remote', root, missing, 'relative/../id'],
    active: [alias, root], projectOrder: ['remote', root, alias],
    labels: { [alias]: 'Alias', [root]: 'Canonical' },
  })
  expect(state).toEqual({
    ...empty(), order: [root, 'remote', join(home, 'absent'), 'relative/../id'],
    active: [root], projectOrder: ['remote', root], labels: { [root]: 'Canonical' },
  })
})

it('bounds root resolution at eight and resolves each distinct input once', async () => {
  let running = 0
  let peak = 0
  const resolver = vi.fn(async (path: string) => {
    peak = Math.max(peak, ++running)
    await new Promise(resolve => setTimeout(resolve, 1))
    running--
    return path
  })
  const order = Array.from({ length: 25 }, (_, i) => '/root/' + i)
  await store.canonicalizeWorkspaceRootsState({ ...empty(), order, active: order }, resolver)
  expect(resolver).toHaveBeenCalledTimes(25)
  expect(peak).toBe(8)
})

it('falls back for realpath errors and preserves malformed thread-list rows and metadata', async () => {
  const resolver = vi.fn(async () => { throw new Error('denied') })
  const row = { id: 'empty', cwd: '' }
  expect(await store.canonicalizeThreadListResponseForRead({
    data: [null, row, { cwd: '/missing/../root', extra: true }, { cwd: '/missing/../root' }, { cwd: 42 }],
    nextCursor: 'cursor', future: true,
  }, resolver)).toEqual({
    data: [null, row, { cwd: '/root', extra: true }, { cwd: '/root' }, { cwd: 42 }],
    nextCursor: 'cursor', future: true,
  })
  expect(resolver).toHaveBeenCalledTimes(1)
  for (const payload of [null, [], { data: 'invalid' }]) {
    expect(await store.canonicalizeThreadListResponseForRead(payload)).toBe(payload)
  }
})

it('normalizes malformed persisted fields while preserving unknown records on write', async () => {
  await writeFile(file(), JSON.stringify({
    'electron-saved-workspace-roots': ['remote', '', 4, 'remote'],
    'electron-workspace-root-labels': { remote: 'Label', invalid: 42 },
    'active-workspace-roots': null, 'project-order': {},
    'remote-projects': [null, { id: ' r ', hostId: ' h ', future: 42 }, { id: 'r' }, {}],
    unknown: { nested: true },
  }))
  expect(await store.readWorkspaceRootsState()).toEqual({
    order: ['remote'], active: [], labels: { remote: 'Label' }, projectOrder: [],
    remoteProjects: [{ id: 'r', hostId: 'h', remotePath: '', label: '' }],
  })
  await store.persistWorkspaceRoot(' another ')
  const raw = JSON.parse(await readFile(file(), 'utf8'))
  expect(raw.unknown).toEqual({ nested: true })
  expect(raw['remote-projects']).toEqual([null, { id: ' r ', hostId: ' h ', future: 42 }, { id: 'r' }, {}])
  expect(raw['electron-saved-workspace-roots']).toEqual(['another', 'remote'])
  expect(raw['electron-workspace-root-labels']).toEqual({ remote: 'Label' })
})

it('handles absent state and blank roots without creating a file', async () => {
  expect(await store.readWorkspaceRootsState()).toEqual(empty())
  await store.persistWorkspaceRoot('  ')
  await expect(stat(file())).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['{broken', 'null', '[]'])('rejects malformed global state without overwriting it: %s', async raw => {
  await writeFile(file(), raw)
  await expect(store.readWorkspaceRootsState()).rejects.toThrow()
  await expect(store.writeWorkspaceRootsState({ ...empty(), order: ['new'] })).rejects.toThrow()
  expect(await readFile(file(), 'utf8')).toBe(raw)
})

it('propagates filesystem failures and allows later transactions to recover', async () => {
  await mkdir(file())
  await expect(store.persistWorkspaceRoot('root')).rejects.toThrow()
  await rm(file(), { recursive: true })
  await store.persistWorkspaceRoot('root')
  expect((await store.readWorkspaceRootsState()).order).toEqual(['root'])
})

it('shares the global transaction queue and preserves no-op file bytes and mtime', async () => {
  await store.persistWorkspaceRoot('root')
  await Promise.all([
    store.persistWorkspaceRoot('second'),
    updateCodexGlobalState(payload => { payload.unrelated = true }),
  ])
  expect(JSON.parse(await readFile(file(), 'utf8')).unrelated).toBe(true)
  const raw = await readFile(file(), 'utf8')
  const before = await stat(file())
  await store.writeWorkspaceRootsState(await store.readWorkspaceRootsState())
  expect(await readFile(file(), 'utf8')).toBe(raw)
  expect((await stat(file())).mtimeMs).toBe(before.mtimeMs)
})
