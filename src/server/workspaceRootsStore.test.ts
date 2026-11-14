import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as store from './workspaceRootsStore'
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

it('normalizes malformed legacy fields without writing to the registry', async () => {
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
  expect(JSON.parse(await readFile(file(), 'utf8')).unknown).toEqual({ nested: true })
})

it('handles absent state and blank roots without creating a file', async () => {
  expect(await store.readWorkspaceRootsState()).toEqual(empty())
  await expect(stat(file())).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['{broken', 'null', '[]'])('rejects malformed global state without overwriting it: %s', async raw => {
  await writeFile(file(), raw)
  await expect(store.readWorkspaceRootsState()).rejects.toThrow()
  expect(await readFile(file(), 'utf8')).toBe(raw)
})
