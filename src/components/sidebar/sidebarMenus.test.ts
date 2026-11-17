import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSidebarMenus } from './sidebarMenus'

function setup() {
  const router = createRouter({ history: createMemoryHistory('/ui/'), routes: [
    { path: '/', name: 'home', component: {} },
    { path: '/thread/:threadId', name: 'thread', component: {} },
  ] })
  const open = vi.fn()
  vi.stubGlobal('window', { open, innerHeight: 900 })
  const emit = vi.fn()
  const resolveNewThreadCwd = vi.fn(() => '/work/Empty project')
  const menus = createSidebarMenus({
    router, emit, getProjectDisplayName: name => name,
    props: { groups: [{ projectName: 'empty project', threads: [] }],
      projectDisplayNameById: {}, selectedThreadId: 'selected', activeProjectName: 'other',
      isLoading: false, isThreadListFullyLoaded: true, searchQuery: '', searchMatchedThreadIds: null,
      removableProjectIds: ['removable'], resolveNewThreadCwd },
    threads: {} as Parameters<typeof createSidebarMenus>[0]['threads'],
  })
  return { menus, open, emit, resolveNewThreadCwd, router }
}

afterEach(() => vi.unstubAllGlobals())

describe('project tab menus', () => {
  for (const entry of ['toggleProjectMenu', 'openProjectContextMenu'] as const) {
    it(`opens an empty non-removable project via ${entry} without changing the current route`, async () => {
      const { menus, open, emit, resolveNewThreadCwd, router } = setup()
      await router.push('/thread/selected')
      menus[entry]('empty project')
      expect(menus.isProjectMenuOpen('empty project')).toBe(true)
      expect(menus.canRemoveProject('empty project')).toBe(false)
      menus.onOpenProjectInNewTab('empty project')
      expect(resolveNewThreadCwd).toHaveBeenCalledExactlyOnceWith('empty project')
      expect(open).toHaveBeenCalledExactlyOnceWith('/ui/?projectId=empty+project&cwd=/work/Empty+project', '_blank', 'noopener,noreferrer')
      expect(router.currentRoute.value.fullPath).toBe('/thread/selected')
      expect(menus.isProjectMenuOpen('empty project')).toBe(false)
      expect(emit).not.toHaveBeenCalled()
    })
  }
  it('retains removal eligibility and uses the same tab behavior for threads', () => {
    const { menus, open, emit } = setup()
    menus.onRemoveProject('empty project')
    expect(emit).not.toHaveBeenCalled()
    menus.toggleProjectMenu('removable')
    menus.onRemoveProject('removable')
    expect(emit).toHaveBeenCalledExactlyOnceWith('remove-project', 'removable')
    expect(menus.isProjectMenuOpen('removable')).toBe(false)
    menus.onOpenThreadInNewTab('selected')
    expect(open).toHaveBeenCalledExactlyOnceWith('/ui/thread/selected', '_blank', 'noopener,noreferrer')
  })
})
