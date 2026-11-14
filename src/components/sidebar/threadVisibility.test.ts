import { describe, expect, it } from 'vitest'
import { normalizeThreadGroupsV2 } from '../../api/normalizers/v2'
import { filterGroupsByWorkspaceRoots } from '../../utils/desktopProjectGroups'
import { collectChronologicalThreads, filterSidebarGroups } from './threadVisibility'

const cwd = '/home/user/Documents/Codex/2026-11-12/hello'
function history() {
  return normalizeThreadGroupsV2({ data: [
    { id: 'dated', cwd, name: 'Find me', preview: 'needle', createdAt: 1, updatedAt: 2 },
    { id: 'pinned', cwd, preview: '', createdAt: 1, updatedAt: 2 },
    { id: 'archiving', cwd, preview: '', createdAt: 1, updatedAt: 2 },
    { id: 'missing', preview: '', createdAt: 1, updatedAt: 2 },
    { id: 'blank', cwd: '   ', preview: '', createdAt: 1, updatedAt: 2 },
  ] } as Parameters<typeof normalizeThreadGroupsV2>[0])
}

describe('history visibility through normalization, workspace union and sidebar', () => {
  it.each([[], ['/unrelated/empty'], [cwd, '/unrelated/empty']].map(order => ({ order })))('shows dated and missing-cwd rows with roots $order', ({ order }) => {
    const groups = filterGroupsByWorkspaceRoots(history(), { order, active: order, projectOrder: [], labels: {} })
    const matches = (thread: { id: string }) => thread.id !== 'archiving'
    const projects = filterSidebarGroups(groups, matches, false, '__codexapp_unassigned__')
    expect(projects.find(group => group.projectName === '__codexapp_unassigned__')?.threads.map(thread => thread.id)).toEqual(['dated', 'pinned', 'missing', 'blank'])
    expect(collectChronologicalThreads(groups, matches, new Set(['pinned'])).map(thread => thread.id)).toEqual(expect.arrayContaining(['dated', 'missing', 'blank']))
    expect(collectChronologicalThreads(groups, matches, new Set(['pinned']))).toHaveLength(3)
    expect(new Set(groups.map(group => group.projectName)).size).toBe(groups.length)
    const search = (thread: { preview: string }) => thread.preview.includes('needle')
    expect(filterSidebarGroups(groups, search, true, null).flatMap(group => group.threads).map(thread => thread.id)).toEqual(['dated'])
    expect(collectChronologicalThreads(groups, search, new Set()).map(thread => thread.id)).toEqual(['dated'])
  })
})
