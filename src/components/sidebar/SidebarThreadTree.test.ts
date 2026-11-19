import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, getCurrentInstance, h, nextTick, reactive, ssrContextKey } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Thread } from '../../api/appServerDtos'
import type { UiThread } from '../../types/codex'
import { normalizeThreadGroupsV2 } from '../../api/normalizers/v2'
import { filterGroupsByWorkspaceRoots } from '../../utils/desktopProjectGroups'
import { folderGroupKey, projectGroupKey, type SidebarGroup, type ThreadViewMode } from './sidebarGroups'
import SidebarThreadTree from './SidebarThreadTree.vue'
import type { createSidebarThreads } from './sidebarThreads'
import { getPinnedThreadState, getThreadSummary, setThreadPinned } from '../../api/codexGateway'

vi.mock('vue-router', () => ({ useRouter: () => ({ resolve: vi.fn() }) }))
vi.mock('../../api/codexGateway', () => ({
  getPinnedThreadState: vi.fn(async () => ({ threadIds: ['z-new'] })),
  getThreadSummary: vi.fn(),
  setThreadPinned: vi.fn(),
  subscribeCodexNotifications: () => () => {},
}))

// Mount the real SFC setup with a renderless host: exercise its computed pipeline,
// watchers and pin hydration without a DOM or browser/layout dependencies.
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert: () => {}, remove: () => {}, setText: () => {}, setElementText: () => {},
  parentNode: () => null, nextSibling: () => null, patchProp: () => {},
})

type SidebarState = {
  threads: ReturnType<typeof createSidebarThreads>
  filteredGroups: SidebarGroup[]
  chatSortMode: 'updated' | 'created'
  globalThreads: UiThread[]
  isChronologicalView: boolean
  isPinnedSectionExpanded: boolean
  isCollapsed(projectName: string): boolean
  threadViewMode: ThreadViewMode
  activeGroupKey: string | null
  setThreadViewMode(mode: ThreadViewMode): void
  togglePinnedSection(): void
  toggleGroupCollapse(group: SidebarGroup): void
  toggleGroupExpansion(groupKey: string): void
  isExpanded(groupKey: string): boolean
  hasHiddenThreads(group: SidebarGroup): boolean
  visibleThreads(group: SidebarGroup): UiThread[]
  onInlineDeleteClick(threadId: string): void
  pinStateError: string
  pinnedThreads: UiThread[]
}
const cleanups: (() => void)[] = []
afterEach(() => {
  // The component removes browser listeners on unmount even in a renderless host.
  vi.stubGlobal('window', { removeEventListener: () => {} })
  vi.stubGlobal('document', { removeEventListener: () => {} })
  try {
    cleanups.splice(0).forEach(cleanup => cleanup())
  } finally {
    vi.unstubAllGlobals()
  }
})

const row = (id: string, projectId: string | null, createdAt: number, updatedAt: number, cwd = '/shared') =>
  ({ id, projectId, cwd, createdAt, updatedAt, preview: id }) as Thread

async function mountNativeSidebar() {
  vi.clearAllMocks()
  const nativeProjects = ['Alpha', 'Empty', 'Zulu'].map((name, position) => ({
    id: name, name, roots: [{ path: '/shared' }], metadata: {}, position,
    createdAt: 999, updatedAt: 999, recencyAt: null,
  }))
  const groups = filterGroupsByWorkspaceRoots(normalizeThreadGroupsV2({ data: [
    row('a-old', 'Alpha', 10, 10), row('a-new', 'Alpha', 60, 20),
    row('z-old', 'Zulu', 20, 30), row('z-new', 'Zulu', 30, 50),
  ] }), { order: [], nativeProjects })
  const props = reactive({ groups, projectDisplayNameById: {}, selectedThreadId: '',
    activeProjectName: null, isLoading: false, isThreadListFullyLoaded: false,
    newThreadCwd: undefined as string | undefined,
    searchQuery: '', searchMatchedThreadIds: null as string[] | null,
    // Reproduce the native parent's pre-fix input. After removal this is an inert
    // attribute; restoring the old conditional prop must fail these tests.
    nativeProjectOrder: true,
  })
  let state!: SidebarState
  const component = {
    ...SidebarThreadTree,
    render() {
      state = (getCurrentInstance() as unknown as { setupState: SidebarState }).setupState
      // Read the display pipeline as the template does.
      void state.filteredGroups
      return null
    },
  }
  const app = renderer.createApp({ render: () => h(component as Component, props) })
  app.provide(ssrContextKey, {})
  app.mount({})
  cleanups.push(() => app.unmount())
  await nextTick()
  return { props, state, nativeProjects }
}

const names = (groups: SidebarGroup[]) => groups.map(group => group.kind === 'project' ? group.projectId : group.cwd)
const byKey = (state: SidebarState, key: string) => state.filteredGroups.find(group => group.key === key)!
const ids = (threads: UiThread[]) => threads.map(thread => thread.id)

it('keeps Projects and Threads visible with stored section collapse preferences', async () => {
  const legacyKey = 'codex-web-local.sidebar-section-expansion.v1'
  const expansionKey = 'codex-web-local.sidebar-section-expansion.v2'
  const storage = new Map([
    [legacyKey, JSON.stringify({ projects: false, pinned: true })],
    [`${expansionKey}.pinned`, JSON.stringify('0')],
    [`${expansionKey}.projects`, JSON.stringify('0')],
  ])
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      get length() { return storage.size },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  vi.stubGlobal('ResizeObserver', class {})

  const { props, state } = await mountNativeSidebar()
  const checkSection = async (label: string, content: string) => {
    const html = await renderToString(createSSRApp(SidebarThreadTree, props))
    const header = html.match(/<div[^>]*class="[^"]*thread-tree-header-row[^"]*"[^>]*>/)?.[0]
    expect(header).toBeDefined()
    expect(header).toContain('data-has-left="false"')
    expect(header).toContain('data-has-right="true"')
    expect(header).not.toContain('aria-expanded')
    expect(html).toMatch(new RegExp(`<span class="thread-tree-header"[^>]*aria-level="2"[^>]*>${label}</span>`))
    expect(html).toContain(content)
  }

  await checkSection('Projects', 'data-project-name="Alpha"')
  expect(state.isChronologicalView).toBe(false)
  expect(state.isPinnedSectionExpanded).toBe(false)
  state.togglePinnedSection()
  state.toggleGroupCollapse(byKey(state, projectGroupKey('Alpha')))
  expect(state.isCollapsed(projectGroupKey('Alpha'))).toBe(true)
  await nextTick()
  expect(storage.get(`${expansionKey}.pinned`)).toBe(JSON.stringify('1'))

  state.setThreadViewMode('chronological')
  expect(state.isChronologicalView).toBe(true)
  await nextTick()
  await checkSection('Threads', 'thread-list thread-list-global')
  expect(getPinnedThreadState).toHaveBeenCalledTimes(1)

  const { state: reloaded } = await mountNativeSidebar()
  expect(reloaded.isChronologicalView).toBe(true)
  expect(reloaded.isPinnedSectionExpanded).toBe(true)
  expect(reloaded.isCollapsed(projectGroupKey('Alpha'))).toBe(true)
  reloaded.toggleGroupCollapse(byKey(reloaded, projectGroupKey('Alpha')))
  expect(reloaded.isCollapsed(projectGroupKey('Alpha'))).toBe(false)
  reloaded.setThreadViewMode('project')
  expect(reloaded.isChronologicalView).toBe(false)
  await nextTick()
  await checkSection('Projects', 'data-project-name="Alpha"')
  expect(storage.get(`${expansionKey}.projects`)).toBe(JSON.stringify('0'))
  expect(getPinnedThreadState).toHaveBeenCalledTimes(1)
  expect(getThreadSummary).not.toHaveBeenCalled()
})

describe('SidebarThreadTree native project timestamp sorting', () => {
  it('sorts saved native order by member timestamps and switches modes, including pinned members', async () => {
    const { props, state, nativeProjects } = await mountNativeSidebar()
    expect(props.groups.map(group => group.projectName)).toEqual(['Alpha', 'Empty', 'Zulu'])
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty'])
    expect(ids(state.threads.sortedGroups.value[0]!.threads)).toEqual(['z-new', 'z-old'])
    expect(ids(state.pinnedThreads)).toEqual(['z-new'])
    expect(ids(state.threads.unpinnedThreadsByGroupKey.value.get(projectGroupKey('Zulu'))!)).toEqual(['z-old'])

    state.chatSortMode = 'created'
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Alpha', 'Zulu', 'Empty'])
    expect(ids(state.threads.sortedGroups.value[0]!.threads)).toEqual(['a-new', 'a-old'])
    expect(ids(state.globalThreads)).toEqual(['a-new', 'z-old', 'a-old'])
    state.chatSortMode = 'updated'
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty'])
    expect(ids(state.pinnedThreads)).toEqual(['z-new'])
    expect(props.groups.map(group => group.projectName)).toEqual(['Alpha', 'Empty', 'Zulu'])
    expect(props.groups.map(group => ids(group.threads))).toEqual([['a-new', 'a-old'], [], ['z-new', 'z-old']])
    expect(nativeProjects.map(project => project.position)).toEqual([0, 1, 2])
    expect(getPinnedThreadState).toHaveBeenCalledTimes(1)
    expect(getThreadSummary).not.toHaveBeenCalled()
    expect(setThreadPinned).not.toHaveBeenCalled()
  })

  it('reacts to metadata and additional pages, keeping empty projects last and ties deterministic', async () => {
    const { props, state } = await mountNativeSidebar()
    props.groups.find(group => group.projectName === 'Alpha')!.threads.find(thread => thread.id === 'a-old')!.updatedAtIso = new Date(70000).toISOString()
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Alpha', 'Zulu', 'Empty'])
    expect(ids(state.threads.sortedGroups.value[0]!.threads)).toEqual(['a-old', 'a-new'])

    const page = normalizeThreadGroupsV2({ data: [
      row('z-page-b', 'Zulu', 80, 90), row('z-page-a', 'Zulu', 80, 90),
    ] })
    props.groups = props.groups.map(group => group.projectName === 'Zulu'
      ? { ...group, threads: [...group.threads, ...page[0]!.threads] } : group)
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty'])
    expect(ids(state.threads.sortedGroups.value[0]!.threads)).toEqual(['z-page-a', 'z-page-b', 'z-new', 'z-old'])

    props.groups.find(group => group.projectName === 'Alpha')!.threads.find(thread => thread.id === 'a-old')!.updatedAtIso = new Date(90000).toISOString()
    props.groups.unshift({ projectName: 'Empty A', threads: [] })
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Alpha', 'Zulu', 'Empty', 'Empty A'])
    state.chatSortMode = 'created'
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty', 'Empty A'])
  })
})

it('keeps native conversations accessible and existing pins intact when pin loading fails, then recovers', async () => {
  const { state } = await mountNativeSidebar()
  const before = ids(state.globalThreads)
  vi.mocked(getPinnedThreadState).mockRejectedValueOnce(new Error('Native thread sections are required for pinning'))
  await state.threads.refreshPinnedThreadState()
  expect(state.pinStateError).toContain('Native thread sections')
  expect(ids(state.globalThreads)).toEqual(before)
  expect(ids(state.pinnedThreads)).toEqual(['z-new'])
  await state.threads.togglePin('a-new')
  expect(setThreadPinned).not.toHaveBeenCalled()
  await state.threads.refreshPinnedThreadState()
  expect(state.pinStateError).toBe('')
})

it('persists folder mode and isolates collapse and Show more from a matching native Project ID', async () => {
  const modeKey = 'codex-web-local.thread-view-mode.v1'
  const cwd = '/shared'
  const folderKey = folderGroupKey(cwd)
  const projectKey = projectGroupKey(folderKey)
  const storage = new Map([
    [modeKey, 'project'],
    [`codex-web-local.collapsed-projects.v2.${encodeURIComponent(folderKey)}`, JSON.stringify('1')],
  ])
  const listeners = new Set<(event: { key: string }) => void>()
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: { key: string }) => void) => {
      if (type === 'storage') listeners.add(listener)
    },
    removeEventListener: () => {},
    localStorage: {
      get length() { return storage.size },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  vi.stubGlobal('ResizeObserver', class {})

  const { props, state } = await mountNativeSidebar()
  props.groups.push({ projectName: folderKey, threads: [] })
  expect(state.threadViewMode).toBe('project')
  expect(byKey(state, projectKey)).toBeDefined()
  expect(state.isCollapsed(projectKey)).toBe(true)
  state.setThreadViewMode('folder')
  expect(state.isCollapsed(folderKey)).toBe(false)
  state.toggleGroupExpansion(folderKey)
  state.toggleGroupCollapse(byKey(state, folderKey))
  await nextTick()
  expect(storage.get(modeKey)).toBe('folder')

  const { state: reloaded } = await mountNativeSidebar()
  expect(reloaded.threadViewMode).toBe('folder')
  expect(reloaded.isCollapsed(folderKey)).toBe(true)
  expect(reloaded.isCollapsed(projectKey)).toBe(true)
  reloaded.toggleGroupCollapse(byKey(reloaded, folderKey))
  expect(reloaded.isCollapsed(projectKey)).toBe(true)

  state.setThreadViewMode('chronological')
  expect(ids(state.globalThreads)).toEqual(['z-old', 'a-new', 'a-old'])
  state.setThreadViewMode('project')
  expect(byKey(state, projectGroupKey('Empty'))).toBeDefined()
  expect(state.isExpanded(projectKey)).toBe(false)
  state.setThreadViewMode('folder')
  expect(state.isExpanded(folderKey)).toBe(true)
  props.groups.push(...normalizeThreadGroupsV2({ data: [
    row('same-basename', null, 1, 1, '/other/shared'), row('empty-cwd', null, 1, 1, ''),
  ] }))
  props.newThreadCwd = '/other/shared/'
  await nextTick()
  const html = await renderToString(createSSRApp(SidebarThreadTree, props))
  expect(html).toMatch(/aria-level="2"[^>]*>Folders<\/span>/)
  expect(html).toMatch(/title="\/other\/shared"[^>]*>\/other\/shared<\/span>/)
  expect(html).toMatch(/title="\/shared"[^>]*>\/shared<\/span>/)
  expect(html).toMatch(/data-folder-path="\/other\/shared"[^>]*><div[^>]*data-active="true"/)
  expect(html.match(/data-folder-path=""[\s\S]*?<\/article>/)?.[0]).toContain('No working directory')
  expect(html.match(/data-folder-path=""[\s\S]*?<\/article>/)?.[0]).not.toContain('thread-start-button')

  storage.set(modeKey, 'chronological')
  for (const listener of listeners) listener({ key: modeKey })
  expect(state.threadViewMode).toBe('chronological')
  storage.set(modeKey, 'folder')
  for (const listener of listeners) listener({ key: modeKey })
  expect(state.threadViewMode).toBe('folder')
})

it('keeps folder rows current with selection, sort, search, pins, pagination and reconciliation', async () => {
  const { props, state } = await mountNativeSidebar()
  state.setThreadViewMode('folder')
  const shared = folderGroupKey('/shared')
  const other = folderGroupKey('/other/shared')
  const sharedRows = () => ids(state.visibleThreads(byKey(state, shared)))
  expect(names(state.filteredGroups)).toEqual(['/shared'])
  expect(sharedRows()).toEqual(['z-old', 'a-new', 'a-old'])
  expect(ids(state.pinnedThreads)).toEqual(['z-new'])
  await state.threads.togglePin('a-old')
  expect(setThreadPinned).toHaveBeenCalledExactlyOnceWith('a-old', true, 'z-new')
  expect(sharedRows()).toEqual(['z-old', 'a-new'])
  expect(ids(state.pinnedThreads)).toEqual(['a-old', 'z-new'])
  await state.threads.togglePin('a-old')
  expect(setThreadPinned).toHaveBeenLastCalledWith('a-old', false, 'a-old')
  state.chatSortMode = 'created'
  expect(sharedRows()).toEqual(['a-new', 'z-old', 'a-old'])

  props.selectedThreadId = 'z-new'
  await nextTick()
  expect(state.activeGroupKey).toBe(shared)
  props.newThreadCwd = '/other/shared/'
  await nextTick()
  expect(state.activeGroupKey).toBe(other)

  // A server search can surface an unloaded row, even if its preview does not match.
  const page = normalizeThreadGroupsV2({ data: [
    row('server-hit', null, 100, 100, '/other/shared'),
    ...Array.from({ length: 10 }, (_, index) => row(`page-${index}`, null, 5, 5)),
  ] })
  props.groups.push(...page)
  expect(state.hasHiddenThreads(byKey(state, shared))).toBe(true)
  expect(sharedRows()).toHaveLength(10)
  state.toggleGroupExpansion(shared)
  expect(sharedRows()).toHaveLength(13)

  props.searchQuery = 'does not occur in previews'
  props.searchMatchedThreadIds = ['server-hit', 'page-2']
  await nextTick()
  state.toggleGroupCollapse(byKey(state, shared))
  expect(sharedRows()).toEqual(['page-2'])
  expect(ids(state.visibleThreads(byKey(state, other)))).toEqual(['server-hit'])
  expect(state.pinnedThreads).toEqual([])

  props.searchMatchedThreadIds = null
  props.searchQuery = ''
  await nextTick()
  state.toggleGroupCollapse(byKey(state, shared))
  // The new-thread adapter publishes a cwd immediately, then replaces its summary.
  const pending = normalizeThreadGroupsV2({ data: [row('new', null, 200, 200, '/shared/')] })
  const unassigned = props.groups.find(group => group.projectName === pending[0]!.projectName)!
  unassigned.threads.push(pending[0]!.threads[0]!)
  expect(sharedRows()[0]).toBe('new')
  unassigned.threads.pop()
  props.groups.find(group => group.projectName === 'Zulu')!.threads.push(
    normalizeThreadGroupsV2({ data: [row('new', 'Zulu', 200, 210, '/shared')] })[0]!.threads[0]!,
  )
  expect(sharedRows().filter(id => id === 'new')).toEqual(['new'])
  state.onInlineDeleteClick('new')
  state.onInlineDeleteClick('new')
  expect(sharedRows()).not.toContain('new')
  expect(getPinnedThreadState).toHaveBeenCalledTimes(1)
  expect(getThreadSummary).not.toHaveBeenCalled()
})
