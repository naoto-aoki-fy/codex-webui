import { expect, it } from 'vitest'
import { filterGroupsByWorkspaceRoots, UNASSIGNED_PROJECT } from './desktopProjectGroups'
import { normalizeThreadGroupsV2 } from '../api/normalizers/v2'
it('does not infer membership or fabricate legacy placeholders when native projects are unavailable', () => {
  const groups = normalizeThreadGroupsV2({ data: [{ id: 't', cwd: '/old/root', createdAt: 1, updatedAt: 1 }] as any })
  expect(filterGroupsByWorkspaceRoots(groups, { order: ['/old/root', '/empty'],  })
    .map(g => [g.projectName, g.threads.map(t => t.id)])).toEqual([[UNASSIGNED_PROJECT, ['t']]])
})
