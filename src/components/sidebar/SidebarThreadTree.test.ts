import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, getCurrentInstance, h, nextTick, reactive, ssrContextKey } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Thread } from '../../api/appServerDtos'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import { normalizeThreadGroupsV2 } from '../../api/normalizers/v2'
import { filterGroupsByWorkspaceRoots } from '../../utils/desktopProjectGroups'
import SidebarThreadTree from './SidebarThreadTree.vue'
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
  sortedGroups: UiProjectGroup[]
  filteredGroups: UiProjectGroup[]
  chatSortMode: 'updated' | 'created'
  globalThreads: UiThread[]
  isChronologicalView: boolean
  isPinnedSectionExpanded: boolean
  isCollapsed(projectName: string): boolean
  setThreadViewMode(mode: 'project' | 'chronological'): void
  togglePinnedSection(): void
  toggleProjectCollapse(projectName: string): void
  pinStateError: string
  togglePin(threadId: string): Promise<void>
  refreshPinnedThreadState(): Promise<void>
  pinnedThreads: UiThread[]
  unpinnedThreadsByProjectName: Map<string, UiThread[]>
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

const row = (id: string, projectId: string, createdAt: number, updatedAt: number) =>
  ({ id, projectId, cwd: '/shared', createdAt, updatedAt, preview: id }) as Thread

async function mountNativeSidebar() {
  vi.clearAllMocks()
  const nativeProjects = ['Alpha', 'Empty', 'Zulu'].map((name, position) => ({
    id: name, name, roots: [{ path: '/shared' }], metadata: {}, position,
    createdAt: 999, updatedAt: 999, recencyAt: null,
  }))
  const groups = filterGroupsByWorkspaceRoots(normalizeThreadGroupsV2({ data: [
    row('a-old', 'Alpha', 10, 10), row('a-new', 'Alpha', 60, 20),
    row('z-old', 'Zulu', 20, 30), row('z-new', 'Zulu', 30, 50),
  ] }), { projectMode: 'native', order: [], nativeProjects })
  const props = reactive({ groups, projectDisplayNameById: {}, selectedThreadId: '',
    activeProjectName: null, isLoading: false, isThreadListFullyLoaded: false,
    searchQuery: '', searchMatchedThreadIds: null,
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

const names = (groups: UiProjectGroup[]) => groups.map(group => group.projectName)
const ids = (threads: UiThread[]) => threads.map(thread => thread.id)

it('keeps Projects and Threads visible with stored section collapse preferences', async () => {
  const legacyKey = 'codex-web-local.sidebar-section-expansion.v1'
  const expansionKey = 'codex-web-local.sidebar-section-expansion.v2'
  const storage = new Map([
    [legacyKey, JSON.stringify({ projects: false, pinned: false })],
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
  state.toggleProjectCollapse('Alpha')
  expect(state.isCollapsed('Alpha')).toBe(true)
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
  expect(reloaded.isCollapsed('Alpha')).toBe(true)
  reloaded.toggleProjectCollapse('Alpha')
  expect(reloaded.isCollapsed('Alpha')).toBe(false)
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
    expect(names(props.groups)).toEqual(['Alpha', 'Empty', 'Zulu'])
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty'])
    expect(ids(state.sortedGroups[0]!.threads)).toEqual(['z-new', 'z-old'])
    expect(ids(state.pinnedThreads)).toEqual(['z-new'])
    expect(ids(state.unpinnedThreadsByProjectName.get('Zulu')!)).toEqual(['z-old'])

    state.chatSortMode = 'created'
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Alpha', 'Zulu', 'Empty'])
    expect(ids(state.sortedGroups[0]!.threads)).toEqual(['a-new', 'a-old'])
    expect(ids(state.globalThreads)).toEqual(['a-new', 'z-old', 'a-old'])
    state.chatSortMode = 'updated'
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty'])
    expect(ids(state.pinnedThreads)).toEqual(['z-new'])
    expect(names(props.groups)).toEqual(['Alpha', 'Empty', 'Zulu'])
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
    expect(ids(state.sortedGroups[0]!.threads)).toEqual(['a-old', 'a-new'])

    const page = normalizeThreadGroupsV2({ data: [
      row('z-page-b', 'Zulu', 80, 90), row('z-page-a', 'Zulu', 80, 90),
    ] })
    props.groups = props.groups.map(group => group.projectName === 'Zulu'
      ? { ...group, threads: [...group.threads, ...page[0]!.threads] } : group)
    await nextTick()
    expect(names(state.filteredGroups)).toEqual(['Zulu', 'Alpha', 'Empty'])
    expect(ids(state.sortedGroups[0]!.threads)).toEqual(['z-page-a', 'z-page-b', 'z-new', 'z-old'])

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
  vi.mocked(getPinnedThreadState).mockRejectedValueOnce(new Error('Legacy pin migration is incomplete'))
  await state.refreshPinnedThreadState()
  expect(state.pinStateError).toContain('Legacy pin migration')
  expect(ids(state.globalThreads)).toEqual(before)
  expect(ids(state.pinnedThreads)).toEqual(['z-new'])
  await state.togglePin('a-new')
  expect(setThreadPinned).not.toHaveBeenCalled()
  await state.refreshPinnedThreadState()
  expect(state.pinStateError).toBe('')
})
