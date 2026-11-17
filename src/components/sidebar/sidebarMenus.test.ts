import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ref } from 'vue'
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
    router, emit, getProjectDisplayName: name => name,
    props: { groups: [{ projectName: 'empty project', threads: [] }],
      projectDisplayNameById: {}, selectedThreadId: 'selected', activeProjectName: 'other',
      isLoading: false, isThreadListFullyLoaded: true, searchQuery: '', searchMatchedThreadIds: null,
      removableProjectIds: ['removable'], resolveNewThreadCwd },
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
