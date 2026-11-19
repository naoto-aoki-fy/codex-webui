import { expect, it } from 'vitest'
import { filterGroupsByWorkspaceRoots, getWorkspaceProjectId, UNASSIGNED_PROJECT } from './desktopProjectGroups'
import { cloneWorkspaceRootsState } from '../api/normalizers/workspaceRoots'
import { normalizeThreadGroupsV2 } from '../api/normalizers/v2'

const state = { order: ['/shared'], active: [], labels: {}, projectOrder: ['p2', 'p1'], nativeProjects: [
  { id: 'p2', name: 'Same name', roots: [{ path: '/shared' }], metadata: {}, position: 0, createdAt: 1, updatedAt: 1, recencyAt: null },
  { id: 'p1', name: 'Same name', roots: [{ path: '/shared' }], metadata: {}, position: 1, createdAt: 1, updatedAt: 1, recencyAt: null },
  { id: 'empty', name: 'Empty project', roots: [], metadata: {}, position: 2, createdAt: 1, updatedAt: 1, recencyAt: null },
] }
it('groups only by explicit native IDs, preserving duplicate names, identical roots, empty projects and unassigned history', () => {
  const native = normalizeThreadGroupsV2({ data: [
    { id: 'one', projectId: 'p1', cwd: '/shared', createdAt: 1, updatedAt: 1, preview: '' },
    { id: 'two', projectId: 'p2', cwd: '/elsewhere/.codex/worktrees/shared', createdAt: 1, updatedAt: 1, preview: '' },
    { id: 'no-project', projectId: null, cwd: '/shared', createdAt: 1, updatedAt: 1, preview: '' },
  ] as any })
  const groups = filterGroupsByWorkspaceRoots(native, state)
  expect(groups.map(g => [g.projectName, g.threads.map(t => t.id)])).toEqual([
    ['p2', ['two']], ['p1', ['one']], ['empty', []], [UNASSIGNED_PROJECT, ['no-project']],
  ])
  expect(getWorkspaceProjectId(state, 'p1')).toBe('p1')
  expect(getWorkspaceProjectId(state, '/shared')).toBe('')
  expect(getWorkspaceProjectId(state, 'Same name')).toBe('')
  expect(groups[0]!.threads[0]!.cwd).toBe('/elsewhere/.codex/worktrees/shared')
})
it('clones native roots and metadata without sharing writable state with the cache', () => {
  const copy = cloneWorkspaceRootsState(state)
  copy.nativeProjects![0]!.roots[0]!.path = '/changed'
  copy.nativeProjects![0]!.metadata.extra = 'changed'
  expect(state.nativeProjects[0]!.roots[0]!.path).toBe('/shared')
  expect(state.nativeProjects[0]!.metadata).toEqual({})
})
