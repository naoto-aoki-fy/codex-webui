import { expect, it } from 'vitest'
import { normalizeThreadGroupsV2 } from '../../api/normalizers/v2'
import type { Thread } from '../../api/appServerDtos'
import { groupThreadsByProject, UNASSIGNED_PROJECT } from '../../utils/desktopProjectGroups'
import { folderGroupKey, groupThreadsByFolder, parseThreadViewMode, toSidebarProjectGroups } from './sidebarGroups'

it('groups actual working directories across native assignments without changing any threads', () => {
  const data = [
    { id: 'a', cwd: '/workspace/app', projectId: 'p1' },
    { id: 'b', cwd: '/workspace//app/', projectId: 'p2' },
    { id: 'ios', cwd: '/workspace/app', projectId: null },
    { id: 'unknown-project', cwd: '/workspace/app/', projectId: 'deleted' },
    { id: 'same-name', cwd: '/other/app', projectId: null },
    { id: 'worktree', cwd: '/workspace/app/.codex/worktrees/branch', projectId: 'p1' },
    { id: 'missing', projectId: 'p1' },
    { id: 'blank', cwd: '  ' },
  ].map(row => ({ ...row, createdAt: 1, updatedAt: 1, preview: row.id })) as Thread[]
  const native = groupThreadsByProject(normalizeThreadGroupsV2({ data }), ['p1', 'p2', 'empty'].map((id, position) => ({
      id, name: 'Shared name', roots: [{ path: '/unrelated/root' }], metadata: {}, position,
      createdAt: 1, updatedAt: 1, recencyAt: null,
    })))
  expect(toSidebarProjectGroups(native).filter(group => group.kind === 'project' && group.projectId === UNASSIGNED_PROJECT)
    .map(group => group.threads.map(thread => thread.id))).toEqual([['ios', 'same-name', 'blank']])
  const original = structuredClone(native)
  const folders = groupThreadsByFolder(native)
  const byCwd = Object.fromEntries(folders.map(folder => [folder.key, folder.threads.map(thread => thread.id).sort()]))
  expect(byCwd).toEqual({
    'folder:/workspace/app': ['a', 'b', 'ios', 'unknown-project'],
    'folder:/other/app': ['same-name'],
    'folder:/workspace/app/.codex/worktrees/branch': ['worktree'],
    'folder:': ['blank', 'missing'],
  })
  expect(folders.filter(folder => folder.name === 'app')).toHaveLength(2)
  expect(folders.find(folder => !folder.cwd)?.name).toBe('No working directory')
  expect(native).toEqual(original)
})

it('normalizes directory separators and Windows paths without confusing roots or distinct POSIX names', () => {
  expect(folderGroupKey('C:/WORK/App/')).toBe(folderGroupKey(String.raw`\\?\C:\work\app`))
  expect(folderGroupKey(String.raw`\\SERVER\Share` + '\\')).toBe(folderGroupKey(String.raw`\\?\UNC\server\share`))
  expect(folderGroupKey('C:/')).not.toBe(folderGroupKey('C:'))
  expect(folderGroupKey('///')).toBe(folderGroupKey('/'))
  expect(folderGroupKey('/')).not.toBe(folderGroupKey(''))
  expect(folderGroupKey('/foo\\bar')).not.toBe(folderGroupKey('/foo/bar'))
  expect(folderGroupKey('/A')).not.toBe(folderGroupKey('/a'))
})

it('reads legacy organization modes and defaults unknown or absent values to project', () => {
  expect(['project', 'folder', 'chronological', 'unsupported', null].map(parseThreadViewMode))
    .toEqual(['project', 'folder', 'chronological', 'project', 'project'])
})
