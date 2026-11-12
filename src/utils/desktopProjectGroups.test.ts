import { describe, expect, it } from 'vitest'
import type { WorkspaceRootsState } from '../api/codexGateway'
import type { UiProjectGroup, UiThread } from '../types/codex'
import * as legacy from '../composables/useDesktopState'
import {
  collectWorkspaceRootPathsForProjectRemoval,
  filterGroupsByWorkspaceRoots,
  collectDuplicateProjectLeafNames, getWorkspaceProjectId,
  getWorkspaceProjectOrderPaths, getRemoteProjectDisplayName, toProjectNameFromWorkspaceRoot,
} from './desktopProjectGroups'

const roots = (order: string[] = []): WorkspaceRootsState => ({
  order, active: [...order], projectOrder: [], labels: {},
})
const thread = (id: string, cwd: string, projectName = 'api'): UiThread => ({
  id, cwd, projectName, title: id, hasWorktree: false, createdAtIso: '', updatedAtIso: '',
  preview: '', unread: false, inProgress: false,
})
const group = (projectName: string, cwd?: string): UiProjectGroup => ({
  projectName, threads: cwd === undefined ? [] : [thread(projectName, cwd, projectName)],
})

describe('desktop project group presentation', () => {
  it('preserves the existing public function exports', () => {
    expect(legacy.filterGroupsByWorkspaceRoots).toBe(filterGroupsByWorkspaceRoots)
    expect(legacy.collectWorkspaceRootPathsForProjectRemoval).toBe(collectWorkspaceRootPathsForProjectRemoval)
  })

  it('preserves arrays and groups without roots or disambiguation', () => {
    for (const groups of [[], [group('api', '/one/api')], [group('api'), group('other')]]) {
      expect(filterGroupsByWorkspaceRoots(groups, null)).toBe(groups)
      expect(filterGroupsByWorkspaceRoots(groups, roots())).toBe(groups)
    }
  })

  it('filters history groups, adds placeholders and retains projectless threads', () => {
    const allowed = group('api', '/one/api')
    const projectless = group('Projectless', '')
    const result = filterGroupsByWorkspaceRoots(
      [allowed, group('outside', '/outside'), projectless], roots(['/one/api', '/one/empty']),
    )
    expect(result.map((row) => row.projectName)).toEqual(['api', 'Projectless', 'empty'])
    expect(result[0]).toBe(allowed)
    expect(result[1]).toBe(projectless)
    expect(result[2]?.threads).toEqual([])
  })

  it('disambiguates duplicate leaf paths and preserves unchanged thread references', () => {
    const first = thread('first', '/one/api', '/one/api')
    const second = thread('second', '/two/api')
    const input = [{ projectName: 'api', threads: [first, second] }]
    const state = roots(['/one/api', '/two/api'])
    const result = filterGroupsByWorkspaceRoots(input, state)
    expect(result.map((row) => row.projectName)).toEqual(['/one/api', '/two/api'])
    expect(result[0]?.threads[0]).toBe(first)
    expect(result[1]?.threads[0]).toEqual({ ...second, projectName: '/two/api' })
    expect(input[0]?.threads).toEqual([first, second])
    expect(getWorkspaceProjectId(state, 'api', input)).toBe('')
    expect([...collectWorkspaceRootPathsForProjectRemoval(state, '/two/api')]).toEqual(['/two/api'])
    expect([...collectWorkspaceRootPathsForProjectRemoval(state, 'api')]).toEqual([])
  })

  it('preserves separator distinctions while treating repeated identical roots as one identity', () => {
    const state = roots(['/one/api', '/one/api', '  ', ''])
    expect([...collectDuplicateProjectLeafNames([], state)]).toEqual([])
    expect(filterGroupsByWorkspaceRoots([], state)).toEqual([group('api')])
    expect(toProjectNameFromWorkspaceRoot('C:\\work\\api')).toBe('api')
    expect([...collectDuplicateProjectLeafNames([
      group('api', 'C:\\work\\api'), group('api', 'C:/work/api'),
    ], null)]).toEqual(['api'])
  })

  it('keeps managed worktrees with their unique canonical root', () => {
    const input = [{
      projectName: 'api',
      threads: [thread('main', '/one/api'), thread('worktree', '/home/.codex/worktrees/id/api')],
    }]
    const result = filterGroupsByWorkspaceRoots(input, roots(['/one/api']))
    expect(result[0]).toBe(input[0])
    expect(result[0]?.threads).toBe(input[0]?.threads)
  })

  it('keeps remote ids in ordering and placeholders, with existing label fallbacks', () => {
    const state = roots(['/one/api'])
    const remote = { id: 'remote-id', hostId: 'ssh:host', remotePath: '/srv/repo', label: '' }
    state.remoteProjects = [remote]
    state.projectOrder = ['missing', remote.id, '/one/api']
    expect(getWorkspaceProjectOrderPaths(state)).toEqual(['remote-id', '/one/api'])
    expect(filterGroupsByWorkspaceRoots([], state)).toEqual([group('remote-id'), group('api')])
    expect(getRemoteProjectDisplayName(remote)).toBe('repo host')
    expect(getRemoteProjectDisplayName({ ...remote, label: 'Custom' })).toBe('Custom host')
    expect(getRemoteProjectDisplayName({ ...remote, hostId: ' ' })).toBe('repo')
    expect([...collectWorkspaceRootPathsForProjectRemoval(state, remote.id)]).toEqual([])
  })

  it('retains unknown metadata and existing malformed-path failures', () => {
    const groups = [{ ...group('', ''), custom: 'retained' }]
    expect(filterGroupsByWorkspaceRoots(groups, null)).toBe(groups)
    expect(filterGroupsByWorkspaceRoots(groups, roots(['/one/api']))[0]).toBe(groups[0])
    expect(() => filterGroupsByWorkspaceRoots([], roots([null as unknown as string]))).toThrow(TypeError)
    expect(getRemoteProjectDisplayName({
      id: 'remote', hostId: '', remotePath: '', label: '',
    })).toBe('Projectless')
  })

  it('preserves empty-root and unknown-removal behavior', () => {
    const state = roots(['', '   '])
    expect(filterGroupsByWorkspaceRoots([], state)).toEqual([])
    expect([...collectWorkspaceRootPathsForProjectRemoval(state, 'missing')]).toEqual([])
  })
})
