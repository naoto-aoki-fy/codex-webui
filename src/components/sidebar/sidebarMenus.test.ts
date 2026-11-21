import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ref } from 'vue'
import { newThreadRoute, sidebarHref } from '../../router/sidebarRoutes'
import { UNASSIGNED_PROJECT } from '../../utils/desktopProjectGroups'
import { folderGroupKey, projectGroupKey, type FolderGroup, type SidebarGroup } from './sidebarGroups'
import { createSidebarMenus } from './sidebarMenus'

function setup(cwd = '  /work/Project with spaces/日本語  ') {
  const router = createRouter({ history: createMemoryHistory('/ui/'), routes: [
    { path: '/', name: 'home', component: {} },
    { path: '/thread/:threadId', name: 'thread', component: {} },
  ] })
  const open = vi.fn()
  vi.stubGlobal('window', { open, innerHeight: 900 })
  const emit = vi.fn()
  const resolveNewThreadCwd = vi.fn(() => '/work/Empty project')
  const menus = createSidebarMenus({
    router, emit,
    props: { groups: [{ projectName: 'empty project', threads: [] }],
      projectDisplayNameById: {}, selectedThreadId: 'selected', activeProjectName: 'other',
      isLoading: false, isThreadListFullyLoaded: true, searchQuery: '', searchMatchedThreadIds: null,
      removableProjectIds: ['removable', '/work/Project with spaces/日本語'], resolveNewThreadCwd },
    threads: { threadById: ref(new Map([['selected', { cwd }]])) } as Parameters<typeof createSidebarMenus>[0]['threads'],
  })
  return { menus, open, emit, resolveNewThreadCwd, router }
}

afterEach(() => vi.unstubAllGlobals())

describe('copy thread path', () => {
  it('uses the selection fallback immediately when the Clipboard API is unavailable', async () => {
    const { menus } = setup()
    const textarea = { value: '', style: {}, setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn() }
    const execCommand = vi.fn(() => true)
    const removeChild = vi.fn()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', { createElement: () => textarea, execCommand, body: { appendChild: vi.fn(), removeChild } })
    menus.openThreadMenuId.value = 'selected'

    const pending = menus.onCopyThreadPath('selected')
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    expect(textarea.value).toBe('/work/Project with spaces/日本語')
    expect(menus.openThreadMenuId.value).toBe('')
    await pending
    expect(removeChild).toHaveBeenCalledExactlyOnceWith(textarea)
  })

  it('preserves native copying and closes the menu', async () => {
    const { menus } = setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    menus.openThreadMenuId.value = 'selected'
    const pending = menus.onCopyThreadPath('selected')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/work/Project with spaces/日本語')
    expect(menus.openThreadMenuId.value).toBe('')
    await pending
  })

  it('keeps empty and missing paths ineligible', async () => {
    const { menus } = setup('  ')
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await menus.onCopyThreadPath('selected')
    await menus.onCopyThreadPath('missing')
    expect(writeText).not.toHaveBeenCalled()
  })
})

const project = (projectId: string): SidebarGroup => ({ kind: 'project', key: projectGroupKey(projectId), projectId, threads: [] })

describe('project tab menus', () => {
  it('opens the linked destination of an empty non-removable project without changing the current route', async () => {
    const { menus, open, emit, resolveNewThreadCwd, router } = setup()
    const group = project('empty project')
    await router.push('/thread/selected')
    menus.toggleProjectMenu(group.key)
    expect(menus.isProjectMenuOpen(group.key)).toBe(true)
    expect(menus.canRemoveProject(group)).toBe(false)
    menus.onOpenGroupInNewTab(sidebarHref(router, newThreadRoute(menus.getNewThreadTarget(group))))
    expect(resolveNewThreadCwd).toHaveBeenCalledExactlyOnceWith('empty project')
    expect(open).toHaveBeenCalledExactlyOnceWith('/ui/?projectId=empty+project&cwd=/work/Empty+project', '_blank', 'noopener,noreferrer')
    expect(router.currentRoute.value.fullPath).toBe('/thread/selected')
    expect(menus.isProjectMenuOpen(group.key)).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })
  it('retains removal eligibility and uses the same tab behavior for threads', () => {
    const { menus, open, emit } = setup()
    menus.onRemoveProject(project('empty project'))
    expect(emit).not.toHaveBeenCalled()
    menus.toggleProjectMenu(projectGroupKey('removable'))
    menus.onRemoveProject(project('removable'))
    expect(emit).toHaveBeenCalledExactlyOnceWith('remove-project', 'removable')
    expect(menus.isProjectMenuOpen(projectGroupKey('removable'))).toBe(false)
    menus.onOpenThreadInNewTab('selected')
    expect(open).toHaveBeenCalledExactlyOnceWith('/ui/thread/selected', '_blank', 'noopener,noreferrer')
  })
})

it('starts a folder composer in either tab using only its cwd, even when a Project ID matches', async () => {
  const { menus, open, emit, resolveNewThreadCwd, router } = setup()
  const cwd = '/work/Project with spaces/日本語'
  const folder: FolderGroup = { kind: 'folder', key: folderGroupKey(cwd), cwd, name: '日本語', threads: [] }
  expect(menus.canRemoveProject(project(cwd))).toBe(true)
  expect(menus.canRemoveProject(folder)).toBe(false)
  menus.onRemoveProject(folder)
  expect(emit).not.toHaveBeenCalled()

  await router.push('/?cwd=/other&projectId=removable')
  menus.onStartNewThread(folder)
  expect(emit).toHaveBeenLastCalledWith('start-new-thread', { cwd })
  menus.toggleProjectMenu(folder.key)
  menus.onOpenGroupInNewTab(sidebarHref(router, newThreadRoute(menus.getNewThreadTarget(folder))))
  const href = open.mock.calls[0]![0] as string
  expect(router.resolve(href.slice('/ui'.length)).query).toEqual({ cwd })
  expect(menus.isProjectMenuOpen(folder.key)).toBe(false)
  expect(router.currentRoute.value.query.projectId).toBe('removable')
  expect(resolveNewThreadCwd).not.toHaveBeenCalled()

  menus.onStartNewThread(project('removable'))
  expect(emit).toHaveBeenLastCalledWith('start-new-thread', { cwd: '/work/Empty project', projectId: 'removable' })
})

it('omits the Unassigned project ID and opens the no-directory folder at bare home', () => {
  const { menus, router } = setup()
  const unassigned = menus.getNewThreadTarget(project(UNASSIGNED_PROJECT))
  expect(unassigned).toEqual({ cwd: '/work/Empty project' })
  expect(sidebarHref(router, newThreadRoute(unassigned))).toBe('/ui/?cwd=/work/Empty+project')

  const folder: FolderGroup = { kind: 'folder', key: folderGroupKey(''), cwd: '', name: 'No working directory', threads: [] }
  expect(sidebarHref(router, newThreadRoute(menus.getNewThreadTarget(folder)))).toBe('/ui/')
})
