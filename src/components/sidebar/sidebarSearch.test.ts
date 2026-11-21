import { expect, it } from 'vitest'
import { normalizeThreadGroupsV2 } from '../../api/normalizers/v2'
import type { Thread } from '../../api/appServerDtos'
import type { Project } from '../../server/protocol/0.167.2/v2/Project'
import { findFolderNames, findProjectNames, findThreadTitles } from './sidebarSearch'

function project(id: string, name: string, ...paths: string[]): Project {
  return {
    id, name, roots: paths.map(path => ({ path })), metadata: {},
    position: 0, createdAt: 1, updatedAt: 1, recencyAt: null,
  }
}

function threads(rows: Array<Partial<Thread>>) {
  return normalizeThreadGroupsV2({ data: rows.map((row, index) => ({
    id: String(index), createdAt: 1, updatedAt: 1, preview: '', cwd: '', ...row,
  }) as Thread) }).flatMap(group => group.threads)
}

it('ranks displayed titles by exact, prefix and partial match, using recency within a rank', () => {
  const rows = threads([
    { name: 'More サイドバー', updatedAt: 100 },
    { name: 'サイドバー older', updatedAt: 2 },
    { name: 'サイドバー' },
    { name: 'サイドバー recent', updatedAt: 10 },
    { name: 'Other', preview: 'サイドバー' },
    { name: 'INSENSITIVE' },
  ])
  expect(findThreadTitles(rows, 'サイドバー').map(row => row.id)).toEqual(['2', '3', '1', '0'])
  expect(findThreadTitles(rows, 'insensitive').map(row => row.id)).toEqual(['5'])
})

it('keeps empty Projects and shows IDs only when the displayed name and path collide', () => {
  const projects = [
    project('a', 'Build', '/remote/root'), project('b', 'Build', '/remote/root'),
    project('archive', 'Archive Build'), project('prefix', 'Build Tools', '/remote/tools'),
    project('distinct', 'Build', '/different/root'),
  ]
  const rows = findProjectNames(projects, 'BUILD', id => projects.find(row => row.id === id)?.roots[0]?.path ?? '')
  expect(rows.map(row => row.key)).toEqual(['distinct', 'a', 'b', 'prefix', 'archive'])
  expect(rows.map(row => row.idLabel)).toEqual([undefined, 'a', 'b', undefined, undefined])
  expect(rows.at(-1)?.target).toEqual({ projectId: 'archive', cwd: '' })
  expect(rows[1]?.target).toEqual({ projectId: 'a', cwd: '/remote/root' })
})

it('uses every registered root and working directory, deduplicates normalized paths, and matches only the leaf', () => {
  const projects = [project('one', 'Project without threads', '/parent-only/共有', '/another/サンプル', 'C:\\repo\\共有\\')]
  const rows = threads([{ cwd: '/parent-only//共有/' }, { cwd: '/different/共有' }, { cwd: 'c:/repo/共有' }, { cwd: '/remote/other-共有' }])
  const results = findFolderNames(projects, rows, '共有')
  expect(results).toHaveLength(4)
  expect(results.slice(0, 3).map(row => row.pathLabel)).toEqual(expect.arrayContaining(['/parent-only/共有', '/different/共有', 'C:\\repo\\共有\\']))
  expect(results[3]?.pathLabel).toBeUndefined()
  expect(results.every(row => !('projectId' in row.target))).toBe(true)
  expect(findFolderNames(projects, rows, 'parent-only')).toEqual([])
  expect(findFolderNames(projects, rows, 'サンプル')[0]?.target).toEqual({ cwd: '/another/サンプル' })
})
