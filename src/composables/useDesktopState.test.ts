import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// These orchestration fixtures begin with an already verified backend account.
// Backend hydration/race behavior is exercised in backendAuthentication.test.ts.
vi.mock('./backendAuthentication', async importOriginal => {
  const actual = await importOriginal<typeof import('./backendAuthentication')>()
  return { createBackendAuthentication: (invalidate?:()=>void) => {
    const auth = actual.createBackendAuthentication(invalidate)
    auth.observe({phase:'ready',blocking:false,revision:1})
    return {...auth,refresh:vi.fn(async()=>{})}
  } }
})
import {
  findAdjacentThreadId,
  removeThreadFromGroups,
  useDesktopState,
} from './useDesktopState'
import { loadPersistedDraftForThread, persistDraftForThread } from '../utils/composerDraftStorage'
import type { UiProjectGroup } from '../types/codex'
import type { ReasoningModel } from '../api/modelCapabilities'
import type { WorkspaceRootsState } from '../api/codexGateway'

const gatewayMocks = vi.hoisted(() => ({
  markNativeThreadRead: vi.fn(),
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  forkThread: vi.fn(),
  forkThreadFromResponse: vi.fn(),
  createConversationTransfer: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAvailableCollaborationModes: vi.fn(),
  getAvailableModelIds: vi.fn(),
  getCurrentModelConfig: vi.fn(),
  getPendingServerRequests: vi.fn(),
  getSkillsList: vi.fn(),
  getThreadDetail: vi.fn(),
  getThreadGroupsPage: vi.fn(),
  getWorkspaceRootsState: vi.fn(),
  interruptThreadTurn: vi.fn(),
  renameThread: vi.fn(),
  replyToServerRequest: vi.fn(),
  resumeThread: vi.fn(),
  revertThreadFileChanges: vi.fn(),
  revertThreadHistory: vi.fn(),
  validateThreadRevert: vi.fn(),
  setCodexSpeedMode: vi.fn(),
  setWorkspaceRootsState: vi.fn(),
  updateWorkspaceRootsState: vi.fn(),
  startThread: vi.fn(),
  startThreadTurn: vi.fn(),
  subscribeCodexNotifications: vi.fn(),
}))

vi.mock('../api/codexGateway', async (original) => ({
  ...await original<typeof import('../api/codexGateway')>(),
  ...gatewayMocks,
  getThreadDetailForRevert: gatewayMocks.getThreadDetail,
  getBackgroundThreadListLimit: vi.fn(() => 100),
  pickCodexRateLimitSnapshot: vi.fn(() => null),
}))

function thread(id: string, cwd: string, options: { hasWorktree?: boolean } = {}) {
  return {
    id,
    title: id,
    projectName: cwd ? cwd.split('/').at(-1) || cwd : 'Conversations',
    cwd,
    hasWorktree: options.hasWorktree ?? false,
    createdAtIso: '2026-04-28T00:00:00.000Z',
    updatedAtIso: '2026-04-28T00:00:00.000Z',
    preview: '',
    unread: false,
    inProgress: false,
  }
}

function installTestWindow(initialStorage: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialStorage))
  vi.stubGlobal('window', {
    localStorage: {
      get length() { return store.size }, key: (i: number) => [...store.keys()][i] ?? null,
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
    },
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  gatewayMocks.getWorkspaceRootsState.mockResolvedValue({ order: [], active: [], labels: {}, projectOrder: [], projectMode: 'native', nativeProjects: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('removeThreadFromGroups', () => {
  it('removes an archived thread and drops the now-empty project group', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('keep-alpha', '/tmp/alpha')],
      },
      {
        projectName: 'archived-project',
        threads: [thread('archive-me', '/tmp/archived-project')],
      },
      {
        projectName: 'beta',
        threads: [thread('keep-beta', '/tmp/beta')],
      },
      {
        projectName: 'empty-workspace-root',
        threads: [],
      },
    ]

    expect(removeThreadFromGroups(groups, 'archive-me').map((group) => [
      group.projectName,
      group.threads.map((row) => row.id),
    ])).toEqual([
      ['alpha', ['keep-alpha']],
      ['beta', ['keep-beta']],
      ['empty-workspace-root', []],
    ])
  })

  it('preserves referential identity when the thread is absent', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('keep-alpha', '/tmp/alpha')],
      },
    ]

    expect(removeThreadFromGroups(groups, 'missing-thread')).toBe(groups)
  })
})

describe('collaboration mode selection', () => {
  it('ignores legacy selection and keeps navigation independent of browser storage', () => {
    installTestWindow({
      'codex-web-local.selected-thread-id.v1': 'thread-a',
    })

    const state = useDesktopState()

    expect(state.selectedThreadId.value).toBe('')
    state.primeSelectedThread('thread-b')
    state.primeSelectedThread('')

    expect(state.selectedThreadId.value).toBe('')
    expect(window.localStorage.getItem('codex-web-local.selected-thread-id.v1')).toBe('thread-a')
  })

  it('does not carry plan mode from new chats into existing threads', () => {
    installTestWindow({
      'codex-web-local.collaboration-mode.v1': 'plan',
    })

    const state = useDesktopState()

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.setSelectedCollaborationMode('plan')

    expect(state.selectedCollaborationMode.value).toBe('plan')
    expect(window.localStorage.getItem('codex-web-local.collaboration-mode-by-context.v1')).toBe(null)

    state.primeSelectedThread('thread-a')

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.setSelectedCollaborationMode('plan')
    state.primeSelectedThread('thread-b')

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.primeSelectedThread('thread-a')

    expect(state.selectedCollaborationMode.value).toBe('plan')
  })
})

it('surfaces external app-server connection failures', async () => {
  installTestWindow()
  gatewayMocks.getThreadGroupsPage.mockRejectedValue(new Error('External app-server disconnected'))
  const state = useDesktopState()
  await state.refreshAll({ awaitAncillaryRefreshes: true })
  expect(state.error.value).toBe('External app-server disconnected')
})

describe('startup request deduplication', () => {
  it('preserves manual renaming and persists the trimmed title', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    await state.renameThreadById('thread-1', '  Manual title  ')

    expect(gatewayMocks.renameThread).toHaveBeenCalledWith('thread-1', 'Manual title')
    expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('Manual title')
  })

  it('uses server names after a forced refresh', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }], nextCursor: null,
    })
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [{ ...thread('thread-1', '/tmp/project'), title: 'Native name' }] }], nextCursor: null,
    })
    await state.refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })
    expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('Native name')
  })

  it('reuses a just-loaded thread list during startup refresh bursts', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })

    try {
      const state = useDesktopState()
      await state.refreshAll({ includeSelectedThreadMessages: false })
      await state.refreshAll({ includeSelectedThreadMessages: false })

      expect(gatewayMocks.getThreadGroupsPage).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reuses a just-loaded skills list for the same selected cwd', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([
      {
        name: 'example',
        description: 'Example skill',
        path: '/tmp/project/.agents/skills/example/SKILL.md',
        scope: 'project',
        enabled: true,
      },
    ])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: [] })

    try {
      const state = useDesktopState()
      state.primeSelectedThread('thread-1')
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

      expect(gatewayMocks.getSkillsList).toHaveBeenCalledTimes(1)
      expect(gatewayMocks.getSkillsList).toHaveBeenCalledWith(['/tmp/project'])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reuses a just-loaded empty skills list for the same selected cwd', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: [] })

    try {
      const state = useDesktopState()
      state.primeSelectedThread('thread-1')
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

      expect(gatewayMocks.getSkillsList).toHaveBeenCalledTimes(1)
      expect(state.installedSkills.value).toEqual([])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('bypasses recent thread-list reuse for event-driven thread refreshes', async () => {
    installTestWindow()
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        void Promise.resolve().then(() => callback())
      }
      return 1
    }) as typeof window.setTimeout)
    let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | undefined
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler as typeof notificationHandler
      return vi.fn()
    })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })

    try {
      const state = useDesktopState()
      await state.refreshAll({ includeSelectedThreadMessages: false })
      const callsBeforeNotification = gatewayMocks.getThreadGroupsPage.mock.calls.length
      state.startPolling()
      expect(notificationHandler).toBeDefined()
      notificationHandler!({
        method: 'thread/name/updated',
        params: {
          threadId: 'thread-1',
          threadName: 'Updated title',
        },
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('Updated title')
      await vi.waitFor(() => expect(gatewayMocks.getThreadGroupsPage.mock.calls.length).toBeGreaterThan(callsBeforeNotification))
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('live error overlay', () => {
  it('shows the default thinking overlay while a selected thread is in progress without activity events', async () => {
    installTestWindow()
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue(null)
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'create todo list app',
          messageType: 'userMessage',
        },
      ],
      inProgress: true,
      activeTurnId: 'turn-1',
      turnIndexByTurnId: {},
      hasMoreOlder: false,
    })

    const state = useDesktopState()
    state.primeSelectedThread('thread-thinking')
    await state.loadMessages('thread-thinking')

    expect(state.selectedLiveOverlay.value).toMatchObject({
      activityLabel: 'Thinking',
      reasoningText: '',
      errorText: '',
    })
  })

  it('keeps a new live error visible when an older persisted turn error exists', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue(null)
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [
        {
          id: 'old-error',
          role: 'system',
          text: 'old persisted failure',
          messageType: 'turnError',
        },
      ],
      inProgress: false,
      activeTurnId: '',
      turnIndexByTurnId: {},
      hasMoreOlder: false,
    })

    const state = useDesktopState()
    state.primeSelectedThread('thread-with-errors')
    await state.loadMessages('thread-with-errors')
    state.startPolling()

    notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: 'thread-with-errors',
        turnId: 'new-turn',
        turn: {
          id: 'new-turn',
          status: 'failed',
          error: { message: 'new live failure' },
        },
      },
    })

    expect(state.selectedLiveOverlay.value?.errorText).toBe('new live failure')
  })

  it('suppresses a live error only after that same error has persisted', async () => {
    installTestWindow()
    let notificationHandler: (notification: { method: string; params?: unknown }) => void = () => {}
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler
      return vi.fn()
    })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue(null)
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [
        {
          id: 'persisted-error',
          role: 'system',
          text: 'same failure',
          messageType: 'turnError',
        },
      ],
      inProgress: false,
      activeTurnId: '',
      turnIndexByTurnId: {},
      hasMoreOlder: false,
    })

    const state = useDesktopState()
    state.primeSelectedThread('thread-with-persisted-error')
    await state.loadMessages('thread-with-persisted-error')
    state.startPolling()

    notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: 'thread-with-persisted-error',
        turnId: 'same-turn',
        turn: {
          id: 'same-turn',
          status: 'failed',
          error: { message: 'same failure' },
        },
      },
    })

    expect(state.selectedLiveOverlay.value).toBe(null)
  })
})

describe('Codex model selection', () => {

  it('uses only the Codex catalog without rewriting inert legacy choices', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::openrouter-free': 'openrouter/free',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: [
      'gpt-5.5',
      'gpt-5.4-mini',
    ], models: [] })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.readModelIdForThread('')).toBe('gpt-5.5')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::openrouter-free': 'openrouter/free',
    })
  })

  it('drops stale non-Codex selected models from the Codex model list', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::codex': 'big-pickle',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: [
      'gpt-5.5',
      'gpt-5.4-mini',
    ], models: [] })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.availableModelIds.value).toEqual([
      'gpt-5.5',
      'gpt-5.4-mini',
    ])
    expect(state.availableModelIds.value).not.toContain('big-pickle')
    expect(state.readModelIdForThread('')).toBe('gpt-5.5')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::codex': 'big-pickle',
    })
  })

  it('refreshes a loaded optimistic thread when completion events arrive', async () => {
    installTestWindow()
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler, delay?: number) => {
      // Flush notification debounce timers without triggering periodic indexing retries.
      if (delay === 5000) return 2
      if (typeof callback === 'function') {
        void Promise.resolve().then(() => callback())
      }
      return 1
    }) as typeof window.setTimeout)
    let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | undefined
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler as typeof notificationHandler
      return vi.fn()
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.4-mini',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5', 'gpt-5.4-mini'], models: [] })
    gatewayMocks.startThread.mockResolvedValue({
      threadId: 'mini-thread',
      model: 'gpt-5.4-mini',
      modelProvider: 'openai',
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')
    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.4-mini',
      modelProvider: 'openai',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'hi',
          messageType: 'userMessage',
          turnId: 'turn-1',
          turnIndex: 0,
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          text: 'Hi.',
          messageType: 'agentMessage',
          turnId: 'turn-1',
          turnIndex: 0,
        },
      ],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: { 'turn-1': 0 },
    })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    await state.sendMessageToNewThread('hi', '/tmp/project')
    state.startPolling()
    expect(notificationHandler).toBeDefined()
    notificationHandler!({
      method: 'turn/completed',
      params: {
        threadId: 'mini-thread',
        turn: { id: 'turn-1', status: 'completed' },
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(gatewayMocks.getThreadDetail).toHaveBeenCalledWith('mini-thread')
    expect(state.messages.value.map((message) => `${message.role}:${message.text}`)).toEqual([
      'user:hi',
      'system:Worked for <1s',
      'assistant:Hi.',
    ])
    const discoveryCalls = gatewayMocks.getAvailableModelIds.mock.calls.length
    state.setSelectedModelId('gpt-5.5')
    expect(gatewayMocks.getAvailableModelIds).toHaveBeenCalledTimes(discoveryCalls)
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe('provider-model:["openai","gpt-5.5"]')
    await state.sendMessageToSelectedThread('second')
    expect(gatewayMocks.startThreadTurn.mock.calls.at(-1)?.[3]).toBe('provider-model:["openai","gpt-5.5"]')
    state.setSelectedModelId('gpt-5.4-mini')
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe('provider-model:["openai","gpt-5.4-mini"]')

  })

  it('surfaces selected thread load failures and still refreshes models', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5', 'gpt-5.4-mini'], models: [] })
    gatewayMocks.resumeThread.mockRejectedValue(new Error('thread not found'))

    const state = useDesktopState()
    state.primeSelectedThread('missing-thread')
    await state.refreshAll({
      includeSelectedThreadMessages: true,
      awaitAncillaryRefreshes: true,
    })

    expect(state.selectedLiveOverlay.value?.errorText).toContain('thread not found')
    expect(state.availableModelIds.value).toEqual(['gpt-5.5', 'gpt-5.4-mini'])
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe('gpt-5.5')

    await state.ensureThreadMessagesLoaded('missing-thread', { silent: true })
    await state.loadMessages('missing-thread')
    expect(gatewayMocks.resumeThread).toHaveBeenCalledTimes(1)
  })
})

describe('findAdjacentThreadId', () => {
  it('selects the next thread after the archived thread', () => {
    const threads = [
      thread('first-thread', '/tmp/project'),
      thread('selected-thread', '/tmp/project'),
      thread('next-thread', '/tmp/project'),
    ]

    expect(findAdjacentThreadId(threads, 'selected-thread')).toBe('next-thread')
  })

  it('falls back to the previous thread when the last thread is archived', () => {
    const threads = [
      thread('previous-thread', '/tmp/project'),
      thread('selected-thread', '/tmp/project'),
    ]

    expect(findAdjacentThreadId(threads, 'selected-thread')).toBe('previous-thread')
  })

  it('returns no fallback when there is no adjacent thread', () => {
    expect(findAdjacentThreadId([thread('selected-thread', '/tmp/project')], 'selected-thread')).toBe('')
  })
})

describe('locally created threads awaiting sidebar indexing', () => {
  let state: ReturnType<typeof useDesktopState>
  let notify: (notification: { method: string; params: unknown }) => void
  const ids = () => state.projectGroups.value.flatMap((group) => group.threads.map((row) => row.id))
  const refresh = () => state.refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })

  beforeEach(() => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.startThread.mockResolvedValue({ threadId: 'new-chat', model: 'gpt-5.5' })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')
    gatewayMocks.getThreadDetail.mockResolvedValue({
      messages: [{ id: 'user-1', role: 'user', text: 'hello', turnId: 'turn-1' }],
      inProgress: true,
      activeTurnId: 'turn-1',
      turnIndexByTurnId: {},
    })
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notify = handler
      return vi.fn()
    })
    state = useDesktopState()
    state.startPolling()
  })

  afterEach(() => {
    state.stopPolling()
    vi.restoreAllMocks()
  })

  async function create(id = 'new-chat', cwd = '/tmp/project') {
    gatewayMocks.startThread.mockResolvedValueOnce({ threadId: id, model: 'gpt-5.5' })
    await state.sendMessageToNewThread('hello', cwd)
    // Let the detached turn-start and its message synchronization finish.
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
  }

  function complete(id = 'new-chat') {
    notify({ method: 'turn/completed', params: { threadId: id, turn: { id: 'turn-1', status: 'completed' } } })
  }

  it('settles an active streamed turn when the external server disconnects', async () => {
    await create()
    notify({ method: 'turn/started', params: { threadId: 'new-chat', turn: { id: 'turn-1' } } })
    notify({ method: 'app-server/disconnected', params: null })
    expect(state.projectGroups.value[0]?.threads[0]?.inProgress).toBe(false)
    expect(state.error.value).toContain('inspect the thread before resending')
  })

  it('keeps a new chat during an active turn and after completion before its first list appearance', async () => {
    await create()
    await refresh()
    expect(ids()).toContain('new-chat')
    complete()
    expect(state.projectGroups.value[0]?.threads[0]?.inProgress).toBe(false)
    await refresh()
    expect(ids()).toContain('new-chat')
    expect(state.selectedThreadId.value).toBe('new-chat')
  })

  it('reconciles a temporary omission, then releases the confirmation timer', async () => {
    vi.mocked(window.setTimeout).mockImplementation(((_callback: TimerHandler, delay?: number) => (
      delay === 5000 ? 91 : 92
    )) as typeof window.setTimeout)
    await create()
    complete()
    await refresh()
    expect(ids()).toContain('new-chat')
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'project', threads: [thread('new-chat', '/tmp/project')] }], nextCursor: null,
    })
    await refresh()
    expect(ids()).toEqual(['new-chat'])
    expect(window.clearTimeout).toHaveBeenCalledWith(91)
  })

  it('bounds retention for a thread that is never indexed', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await create()
    complete()
    vi.mocked(Date.now).mockReturnValue(now + 120001)
    await refresh()
    expect(ids()).not.toContain('new-chat')
  })

  it('reconciles without further notifications and expires even if list requests fail', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    let reconcile: (() => void) | undefined
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler, delay?: number) => {
      if (delay === 5000) reconcile = callback as () => void
      return 91
    }) as typeof window.setTimeout)
    await create()
    complete()
    expect(reconcile).toBeDefined()
    gatewayMocks.getThreadGroupsPage.mockRejectedValue(new Error('bridge unavailable'))
    vi.mocked(Date.now).mockReturnValue(now + 120001)
    reconcile!()
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
    expect(ids()).not.toContain('new-chat')
  })

  it('starts a fresh grace period when a long first turn completes', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await create()
    vi.mocked(Date.now).mockReturnValue(now + 180000)
    await refresh()
    expect(ids()).toContain('new-chat')
    complete()
    await refresh()
    expect(ids()).toContain('new-chat')
    vi.mocked(Date.now).mockReturnValue(now + 300001)
    await refresh()
    expect(ids()).not.toContain('new-chat')
  })

  it('does not insert a thread when creation fails', async () => {
    gatewayMocks.startThread.mockRejectedValueOnce(new Error('creation failed'))
    await expect(state.sendMessageToNewThread('hello', '/tmp/project')).rejects.toThrow('creation failed')
    await refresh()
    expect(ids()).toEqual([])
  })

  it('expires a failed first turn without leaving a permanent entry', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    gatewayMocks.startThreadTurn.mockRejectedValueOnce(new Error('turn failed'))
    await create()
    vi.mocked(Date.now).mockReturnValue(now + 120001)
    await refresh()
    expect(ids()).not.toContain('new-chat')
  })

  it('honors explicit archiving before server confirmation', async () => {
    await create()
    gatewayMocks.archiveThread.mockResolvedValue(undefined)
    await state.archiveThreadById('new-chat')
    await refresh()
    expect(ids()).not.toContain('new-chat')
  })

  it('retains pending and returned threads when unrelated workspace roots are registered', async () => {
    await create()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'project', threads: [thread('existing', '/tmp/project')] }], nextCursor: null,
    })
    gatewayMocks.getWorkspaceRootsState.mockResolvedValue({
      order: ['/tmp/allowed'], active: ['/tmp/allowed'], labels: {}, projectOrder: [],
    })
    await refresh()
    expect(new Set(ids())).toEqual(new Set(['new-chat', 'existing']))
  })

  it('keeps concurrent pending chats grouped alongside paginated server history', async () => {
    await create('first')
    await create('second', '/tmp/other')
    await create('third')
    complete('first')
    complete('second')
    complete('third')
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'project', threads: [thread('older', '/tmp/project')] }], nextCursor: 'page-2',
    })
    await refresh()
    expect(new Set(ids())).toEqual(new Set(['first', 'second', 'third', 'older']))
    expect(state.isThreadListFullyLoaded.value).toBe(false)
    expect(state.projectGroups.value.find((group) => group.projectName === '__codexapp_unassigned__')?.threads.map((row) => row.id))
      .toEqual(expect.arrayContaining(['third', 'first', 'older']))
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'other', threads: [thread('second', '/tmp/other'), thread('oldest', '/tmp/other')] }],
      nextCursor: null,
    })
    await refresh()
    expect(new Set(ids())).toEqual(new Set(['first', 'second', 'third', 'older', 'oldest']))
    expect(state.isThreadListFullyLoaded.value).toBe(true)
  })
})

describe('response fork publication', () => {
  it('persists a portable revert draft before selection, preserves source drafts and never submits', async () => {
    installTestWindow()
    const sourceDraft = { text: 'Unsent source', imageUrls: ['image'], fileAttachments: [], skills: [{ name: 's', path: '/s' }] }
    persistDraftForThread('source', sourceDraft)
    gatewayMocks.resumeThread.mockResolvedValue({ messages: [], turnIndexByTurnId: {} })
    gatewayMocks.getThreadDetail.mockResolvedValue({ messages: [], turnIndexByTurnId: {} })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    let finish!: (value: unknown) => void
    gatewayMocks.createConversationTransfer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const state = useDesktopState()
    state.selectedThreadId.value = 'source'
    const pending = state.forkThreadById('source', 'snapshot', 'selected-model')
    await vi.waitFor(() => expect(gatewayMocks.createConversationTransfer).toHaveBeenCalled())
    expect(await state.forkThreadById('source', 'snapshot', 'selected-model')).toBe('')
    expect(loadPersistedDraftForThread('fork')).toBeNull()
    finish({ threadId: 'fork', model: 'different-model', modelProvider: 'Q', draftText: 'Restored **prompt**\nnext line', warnings: [] })
    expect(await pending).toBe('fork')
    expect(loadPersistedDraftForThread('fork')?.text).toBe('Restored **prompt**\nnext line')
    state.selectedThreadId.value = 'source'
    expect(loadPersistedDraftForThread('source')).toEqual(sourceDraft)
    state.selectedThreadId.value = 'fork'
    expect(loadPersistedDraftForThread('fork')?.text).toBe('Restored **prompt**\nnext line')
    expect(gatewayMocks.createConversationTransfer).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.startThreadTurn).not.toHaveBeenCalled()
    expect(gatewayMocks.forkThread).not.toHaveBeenCalled()
    expect(gatewayMocks.revertThreadHistory).not.toHaveBeenCalled()
  })

  it('leaves the source selection and draft intact when portable revert import fails', async () => {
    installTestWindow()
    const draft = { text: 'Unsent source', imageUrls: [], fileAttachments: [], skills: [] }
    persistDraftForThread('source', draft)
    gatewayMocks.createConversationTransfer.mockRejectedValueOnce(new Error('Incomplete destination fork; do not retry injection'))
    const state = useDesktopState()
    state.selectedThreadId.value = 'source'
    expect(await state.forkThreadById('source', 'snapshot', 'selected-model')).toBe('')
    expect(state.selectedThreadId.value).toBe('source')
    expect(loadPersistedDraftForThread('source')).toEqual(draft)
    expect(loadPersistedDraftForThread('fork')).toBeNull()
    expect(gatewayMocks.createConversationTransfer).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.forkThread).not.toHaveBeenCalled()
    expect(gatewayMocks.startThreadTurn).not.toHaveBeenCalled()
  })
  it('waits for confirmed import and never rolls back using the browser cache', async () => {
    installTestWindow()
    gatewayMocks.resumeThread.mockResolvedValue({ messages: [], turnIndexByTurnId: {} })
    gatewayMocks.getThreadDetail.mockResolvedValue({ messages: [], turnIndexByTurnId: {} })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    let finish!: (value: unknown) => void
    gatewayMocks.createConversationTransfer.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const state = useDesktopState()
    const pending = state.forkThreadFromTurn('source', 2, 'snapshot', 'selected-model')
    await vi.waitFor(() => expect(gatewayMocks.createConversationTransfer).toHaveBeenCalledWith('snapshot', 'selected-model'))
    expect(state.selectedThreadId.value).not.toBe('fork')
    finish({ threadId: 'fork', cwd: '', model: '', warnings: [], messages: [], hasMoreOlder: true, turnIndexByTurnId: {} })
    expect(await pending).toBe('fork')
    expect(state.selectedThreadId.value).toBe('fork')
    expect(gatewayMocks.revertThreadHistory).not.toHaveBeenCalled()
  })
})

describe('thread revert orchestration', () => {
  it('rejects incompatible threads before restoring files', async () => {
    installTestWindow()
    gatewayMocks.validateThreadRevert.mockRejectedValueOnce(new Error('Persisted paginated thread required'))
    const state = useDesktopState()
    state.selectedThreadId.value = 'legacy'
    await state.executeThreadRevert(state.selectedThreadId.value, 'old-turn', 'revert')
    expect(gatewayMocks.revertThreadFileChanges).not.toHaveBeenCalled()
    expect(gatewayMocks.revertThreadHistory).not.toHaveBeenCalled()
    expect(state.error.value).toContain('paginated')
  })

  it('uses the selected turn ID without requiring cached numeric indices', async () => {
    installTestWindow()
    gatewayMocks.validateThreadRevert.mockResolvedValueOnce(undefined)
    gatewayMocks.revertThreadHistory.mockRejectedValueOnce(new Error('RPC unavailable'))
    const state = useDesktopState()
    state.selectedThreadId.value = 'persisted'
    await state.executeThreadRevert(state.selectedThreadId.value, 'older-page-turn', 'revert')
    expect(gatewayMocks.revertThreadHistory).toHaveBeenCalledWith('persisted', 'older-page-turn')
    expect(state.error.value).toContain('RPC unavailable')
  })

  it('reports a refresh failure without repeating the destructive RPC', async () => {
    installTestWindow()
    gatewayMocks.validateThreadRevert.mockResolvedValueOnce(undefined)
    gatewayMocks.revertThreadHistory.mockResolvedValueOnce(undefined)
    gatewayMocks.getThreadDetail.mockRejectedValueOnce(new Error('Read unavailable'))
    const state = useDesktopState()
    state.selectedThreadId.value = 'persisted'
    await state.executeThreadRevert(state.selectedThreadId.value, 'first-turn', 'revert')
    expect(gatewayMocks.revertThreadHistory).toHaveBeenCalledTimes(1)
    expect(state.error.value).toContain('History reverted, but refresh failed')
  })
})

describe('fork and revert orchestration', () => {
  it.each(['first-turn', 'older-page-turn'])('reverts only the fork at %s', async turnId => {
    installTestWindow()
    gatewayMocks.validateThreadRevert.mockResolvedValue(undefined)
    gatewayMocks.forkThread.mockResolvedValueOnce({ threadId: 'fork', model: '' })
    gatewayMocks.revertThreadHistory.mockResolvedValueOnce(undefined)
    gatewayMocks.getThreadDetail.mockRejectedValueOnce(new Error('refresh failed'))
    const state = useDesktopState()
    state.selectedThreadId.value = 'source'
    await state.executeThreadRevert('source', turnId, 'fork-and-revert')
    expect(gatewayMocks.validateThreadRevert.mock.calls).toEqual([['source', turnId], ['fork', turnId]])
    expect(gatewayMocks.revertThreadHistory).toHaveBeenCalledExactlyOnceWith('fork', turnId)
    expect(state.error.value).toContain('Fork retained: fork')
  })

  it('stops at fork validation and blocks concurrent execution', async () => {
    installTestWindow()
    let finish!: () => void
    gatewayMocks.validateThreadRevert.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    gatewayMocks.forkThread.mockResolvedValueOnce({ threadId: 'fork', model: '' })
    gatewayMocks.validateThreadRevert.mockRejectedValueOnce(new Error('missing target'))
    const state = useDesktopState()
    state.selectedThreadId.value = 'source'
    const pending = state.executeThreadRevert('source', 'turn', 'fork-and-revert')
    expect(await state.executeThreadRevert('source', 'turn', 'fork-and-revert')).toBe('')
    finish()
    await pending
    expect(gatewayMocks.forkThread).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.revertThreadFileChanges).not.toHaveBeenCalled()
    expect(gatewayMocks.revertThreadHistory).not.toHaveBeenCalled()
    expect(state.error.value).toContain('Validate fork target')
    expect(state.isRollingBack.value).toBe(false)
  })
})

describe('fork revert stage boundaries', () => {
  it.each(['source', 'fork', 'target', 'history', 'refresh', 'success', 'navigation'])('handles %s without replaying work', async failure => {
    installTestWindow()
    for (const mock of [gatewayMocks.validateThreadRevert, gatewayMocks.forkThread, gatewayMocks.revertThreadFileChanges, gatewayMocks.revertThreadHistory, gatewayMocks.getThreadDetail]) mock.mockReset()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('source', '/tmp/disposable')] }],
      nextCursor: null,
    })
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    state.selectedThreadId.value = 'source'
    gatewayMocks.validateThreadRevert.mockResolvedValue(undefined)
    gatewayMocks.forkThread.mockImplementationOnce(async () => {
      if (failure === 'fork') throw new Error('fork failed')
      if (failure === 'navigation') state.primeSelectedThread('other')
      return { threadId: 'destination', model: '' }
    })
    gatewayMocks.revertThreadHistory.mockResolvedValueOnce(undefined)
    gatewayMocks.getThreadDetail.mockResolvedValueOnce({ messages: [], turnIndexByTurnId: {}, hasMoreOlder: false })
    if (failure === 'source') gatewayMocks.validateThreadRevert.mockRejectedValueOnce(new Error('source failed'))
    if (failure === 'target') gatewayMocks.validateThreadRevert.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('target failed'))
    if (failure === 'history') gatewayMocks.revertThreadHistory.mockReset().mockRejectedValueOnce(new Error('history failed'))
    if (failure === 'refresh') gatewayMocks.getThreadDetail.mockReset().mockRejectedValueOnce(new Error('refresh failed'))
    const result = await state.executeThreadRevert('source', 'turn-zero', 'fork-and-revert')
    expect(gatewayMocks.forkThread).toHaveBeenCalledTimes(failure === 'source' ? 0 : 1)
    const reachesFiles = !['source', 'fork', 'target'].includes(failure)
    expect(gatewayMocks.revertThreadFileChanges).not.toHaveBeenCalled()
    expect(gatewayMocks.revertThreadHistory).toHaveBeenCalledTimes(reachesFiles && failure !== 'files' ? 1 : 0)
    if (['success', 'navigation'].includes(failure)) {
      expect(result).toBe('destination')
      expect(state.selectedThreadId.value).toBe(failure === 'success' ? 'destination' : 'other')
    } else {
      expect(result).toBe('')
      expect(state.error.value).not.toBe('')
    }
    if (failure === 'refresh') expect(state.error.value).toContain('History reverted')
    expect(state.isRollingBack.value).toBe(false)
  })
})


describe('native read receipts', () => {
  async function setup(receipt?: { revision: string; firstUnread: { type: 'threadStart' } | null }) {
    installTestWindow({
      'codex-web-local.thread-read-state.v1': '{"thread-1":"2999-01-01"}',
      'codex-web-local.thread-unread-cutoff.v1': '1900-01-01',
    })
    let notify!: (notification: { method: string; params?: unknown }) => void
    gatewayMocks.subscribeCodexNotifications.mockImplementation(handler => { notify = handler; return vi.fn() })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'project', threads: [{ ...thread('thread-1', '/tmp/project'), nativeReadState: receipt }] }],
      nextCursor: null,
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: '', messages: [], inProgress: false, activeTurnId: '', hasMoreOlder: false, turnIndexByTurnId: {},
    })
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    state.startPolling()
    return { state, notify, row: () => state.projectGroups.value[0]!.threads[0]! }
  }

  it('ignores legacy timestamps and leaves unavailable receipts neutral', async () => {
    const { state, row } = await setup()
    expect(row().unread).toBe(false)
    await state.selectThread('thread-1')
    expect(gatewayMocks.markNativeThreadRead).not.toHaveBeenCalled()
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith('codex-web-local.thread-read-state.v1', expect.anything())
    expect(window.localStorage.removeItem).not.toHaveBeenCalledWith('codex-web-local.thread-read-state.v1')
    state.stopPolling()
  })

  it('synchronizes another client notification without a list request', async () => {
    const { state, notify, row } = await setup({ revision: 'r1', firstUnread: { type: 'threadStart' } })
    expect(row().unread).toBe(true)
    const calls = gatewayMocks.getThreadGroupsPage.mock.calls.length
    notify({ method: 'thread/readState/changed', params: { threadId: 'thread-1', readState: { revision: 'r2', firstUnread: null } } })
    expect(row().unread).toBe(false)
    expect(gatewayMocks.getThreadGroupsPage).toHaveBeenCalledTimes(calls)
    state.stopPolling()
  })

  it('uses the observed revision and leaves conflicts unread without retry', async () => {
    gatewayMocks.markNativeThreadRead.mockRejectedValue(new Error('revision conflict'))
    const { state, row } = await setup({ revision: 'r1', firstUnread: { type: 'threadStart' } })
    await state.selectThread('thread-1')
    await Promise.resolve()
    expect(gatewayMocks.markNativeThreadRead).toHaveBeenCalledExactlyOnceWith('thread-1', 'r1')
    expect(row().unread).toBe(true)
    expect(state.error.value).toContain('revision conflict')
    state.stopPolling()
  })

  it('does not consume unread activity arriving during a history load', async () => {
    const { state, notify, row } = await setup({ revision: 'r1', firstUnread: { type: 'threadStart' } })
    gatewayMocks.resumeThread.mockImplementationOnce(async () => {
      notify({ method: 'thread/readState/changed', params: { threadId: 'thread-1', readState: { revision: 'r2', firstUnread: { type: 'threadStart' } } } })
      return { model: '', messages: [], inProgress: false, activeTurnId: '', hasMoreOlder: false, turnIndexByTurnId: {} }
    })
    await state.selectThread('thread-1')
    expect(gatewayMocks.markNativeThreadRead).not.toHaveBeenCalled()
    expect(row().unread).toBe(true)
    state.stopPolling()
  })
})

describe('existing conversation model identity', () => {
  const key = (provider: string, model: string) => `provider-model:${JSON.stringify([provider, model])}`
  async function setup(models: Array<ReasoningModel & { id: string }>, provider?: string) {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [{ projectName: 'project', threads: [thread('existing', '/tmp/project')] }], nextCursor: null })
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({ model: 'a', modelProvider: provider, speedMode: 'standard' })
    gatewayMocks.getAvailableModelIds.mockResolvedValue({ ids: models.map(m => m.modelProvider ? key(m.modelProvider, m.id) : m.id), models })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'a', modelProvider: provider, messages: [], turnIndexByTurnId: {} })
    gatewayMocks.getThreadDetail.mockResolvedValue({ model: 'a', modelProvider: provider, messages: [], turnIndexByTurnId: {} })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-next')
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    await state.selectThread('existing')
    return state
  }

  it('preserves provider-qualified choices across turns, thread switching and reload with stale server defaults', async () => {
    const models = [{ id: 'a', modelProvider: 'openai' }, { id: 'b', modelProvider: 'openai' }, { id: 'b', modelProvider: 'local' }]
    const state = await setup(models, 'openai')
    state.setSelectedModelId(key('openai', 'b'))
    await state.sendMessageToSelectedThread('another message')
    expect(gatewayMocks.startThreadTurn.mock.calls.at(-1)?.[3]).toBe(key('openai', 'b'))
    state.setSelectedModelId(key('local', 'b'))
    expect(state.error.value).toContain('Fork')
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe(key('openai', 'b'))
    await state.selectThread('')
    await state.selectThread('existing')
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe(key('openai', 'b'))
    const restored = useDesktopState()
    await restored.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    await restored.selectThread('existing')
    expect(restored.readModelIdForThread(restored.selectedThreadId.value)).toBe(key('openai', 'b'))
    gatewayMocks.getAvailableModelIds.mockResolvedValueOnce({ ids: [], models: [] })
    await restored.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    expect(restored.readModelIdForThread(restored.selectedThreadId.value)).toBe(key('openai', 'b'))
    await restored.sendMessageToSelectedThread('after reload')
    expect(gatewayMocks.startThreadTurn.mock.calls.at(-1)?.[3]).toBe(key('openai', 'b'))
    restored.setSelectedModelId(key('openai', 'a'))
    expect(restored.readModelIdForThread(restored.selectedThreadId.value)).toBe(key('openai', 'a'))
  })

  it.each(['resume', 'read'])('keeps a choice made during pending thread/%s and submits its supported effort', async operation => {
    const state = await setup([{ id: 'a', modelProvider: 'openai' }, { id: 'b', modelProvider: 'openai', supportedReasoningEfforts: ['low'] }], 'openai')
    let finish!: (value: unknown) => void
    const pending = new Promise(resolve => { finish = resolve })
    if (operation === 'resume') {
      // A new state has no resumed subscription, but retains the stored pair.
      gatewayMocks.resumeThread.mockReturnValueOnce(pending)
    } else {
      gatewayMocks.getThreadDetail.mockReturnValueOnce(pending)
    }
    const target = operation === 'resume' ? useDesktopState() : state
    const loading = operation === 'resume' ? target.selectThread('existing') : target.loadMessages('existing', { force: true })
    await vi.waitFor(() => expect(operation === 'resume' ? gatewayMocks.resumeThread : gatewayMocks.getThreadDetail).toHaveBeenCalled())
    target.setSelectedModelIdForThread('existing', key('openai', 'b'))
    finish({ model: 'a', modelProvider: 'openai', messages: [], turnIndexByTurnId: {} })
    await loading
    expect(target.readModelIdForThread('existing')).toBe(key('openai', 'b'))
    await target.sendMessageToSelectedThread('after pending operation')
    expect(gatewayMocks.startThreadTurn.mock.calls.at(-1)?.slice(3, 5)).toEqual([key('openai', 'b'), 'low'])
  })

  it('rejects ambiguous bare IDs and unknown providers without inferring a mismatch', async () => {
    const state = await setup([{ id: 'a', modelProvider: 'openai' }, { id: 'same', modelProvider: 'openai' }, { id: 'same', modelProvider: 'local' }], 'openai')
    state.setSelectedModelId('same')
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe(key('openai', 'a'))
    expect(state.error.value).toContain('could not be confirmed')
    state.setSelectedModelId('unavailable')
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe(key('openai', 'a'))
    state.setSelectedModelId(key('openai', 'same'))
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe(key('openai', 'same'))
  })

  it('does not authorize a switch when neither thread nor catalog confirms a provider', async () => {
    const state = await setup([{ id: 'a' }, { id: 'b' }])
    state.setSelectedModelId('b')
    expect(state.readModelIdForThread(state.selectedThreadId.value)).toBe('a')
    expect(state.error.value).toContain('could not be confirmed')
  })
})


describe('history discovery across pagination and workspace removal', () => {
  it('keeps dated history after unregistering, background paging and a fresh state', async () => {
    installTestWindow()
    const cwd = '/home/user/Documents/Codex/2026-11-12/hello'
    const empty = { id: 'empty', name: 'Empty', roots: [], metadata: {}, position: 1, createdAt: 1, updatedAt: 1, recencyAt: null }
    const roots = { order: [cwd], active: [], projectOrder: ['hello', 'empty'], labels: {}, projectMode: 'native' as const, nativeProjects: [{ ...empty, id: 'hello', name: 'Hello', roots: [{ path: cwd }], position: 0 }, empty] }
    const unregistered = { ...roots, nativeProjects: [empty], projectOrder: ['empty'] }
    const first = { projectName: 'hello', threads: [thread('first', cwd)] }
    const later = { projectName: 'hello', threads: [thread('first', cwd), thread('older', cwd)] }
    gatewayMocks.getWorkspaceRootsState.mockResolvedValue(roots)
    gatewayMocks.getThreadGroupsPage.mockResolvedValueOnce({ groups: [first], nextCursor: 'older-page' })
      .mockResolvedValue({ groups: [later], nextCursor: null })
    gatewayMocks.updateWorkspaceRootsState.mockResolvedValue(unregistered)
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    await state.removeProject('hello')
    expect(gatewayMocks.updateWorkspaceRootsState).toHaveBeenCalledWith({ type: 'delete', projectId: 'hello' })
    expect(state.projectGroups.value.find(group => group.projectName === '__codexapp_unassigned__')?.threads.map(row => row.id)).toEqual(['first'])
    const timer = vi.mocked(window.setTimeout).mock.calls.find(call => call[1] === 10_000)
    expect(timer).toBeDefined()
    ;(timer![0] as () => void)()
    await vi.waitFor(() => expect(state.isThreadListFullyLoaded.value).toBe(true))
    expect(gatewayMocks.getThreadGroupsPage).toHaveBeenCalledWith('older-page', 100)
    expect(state.projectGroups.value.find(group => group.projectName === '__codexapp_unassigned__')?.threads.map(row => row.id)).toEqual(['first', 'older'])
    await state.removeProject('hello') // Unregistered history is not removable as a workspace.
    expect(gatewayMocks.updateWorkspaceRootsState).toHaveBeenCalledTimes(1)
    expect(state.projectGroups.value.flatMap(group => group.threads)).toHaveLength(2)
    gatewayMocks.getWorkspaceRootsState.mockResolvedValue(unregistered)
    const restored = useDesktopState()
    await restored.refreshAll({ includeSelectedThreadMessages: false })
    expect(restored.projectGroups.value.map(group => group.projectName)).toEqual(['empty', '__codexapp_unassigned__'])
    expect(restored.projectGroups.value.flatMap(group => group.threads).map(row => row.id)).toEqual(['first', 'older'])
    expect(gatewayMocks.getThreadDetail).not.toHaveBeenCalled()
    state.stopPolling()
    restored.stopPolling()
  })
})

it('preserves inactive legacy project preference data during startup', () => {
  const original = {
    'codex-web-local.project-order.v1': '["/old-b","/old-a"]',
    'codex-web-local.project-display-name.v1': '{"/old-a":"Original project name"}',
  }
  installTestWindow(original)
  const state = useDesktopState()
  for (const [key, value] of Object.entries(original)) expect(window.localStorage.getItem(key)).toBe(value)
  expect(window.localStorage.removeItem).not.toHaveBeenCalledWith('codex-web-local.project-order.v1')
  expect(window.localStorage.removeItem).not.toHaveBeenCalledWith('codex-web-local.project-display-name.v1')
  state.stopPolling()
})


describe('native archive restore', () => {
  it('reconciles the acknowledged identity into its native project without changing selection', async () => {
    const state = useDesktopState()
    gatewayMocks.unarchiveThread.mockResolvedValue({ ...thread('restored', '/remote'), projectName: 'project-id', projectId: 'project-id' })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getWorkspaceRootsState.mockResolvedValue({ order: [], active: [], labels: {}, projectOrder: ['project-id'], projectMode: 'native', nativeProjects: [{ id: 'project-id', name: 'Project', roots: [] }] })
    await state.restoreThreadById('restored')
    expect(state.projectGroups.value.flatMap(group => group.threads).some(row => row.id === 'restored' && row.projectId === 'project-id')).toBe(true)
  })
  it('retains fresher native metadata and read receipts from the post-restore list', async () => {
    const state = useDesktopState()
    const restored = { ...thread('restored', '/remote'), projectName: 'project-id', projectId: 'project-id' }
    const refreshed = { ...restored, title: 'Fresh native title', nativeReadState: { revision: 'new-revision', firstUnread: { type: 'threadStart' as const } } }
    gatewayMocks.unarchiveThread.mockResolvedValue(restored)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [{ projectName: 'project-id', threads: [refreshed] }], nextCursor: null })
    await state.restoreThreadById('restored')
    const row = state.projectGroups.value.flatMap(group => group.threads).find(row => row.id === 'restored')
    expect(row?.title).toBe('Fresh native title')
    expect(row?.nativeReadState).toEqual(refreshed.nativeReadState)
  })
  it('does not add a rejected restore to active lists', async () => {
    const state = useDesktopState()
    gatewayMocks.unarchiveThread.mockRejectedValue(new Error('Restore rejected'))
    await expect(state.restoreThreadById('rejected')).rejects.toThrow('Restore rejected')
    expect(state.projectGroups.value.flatMap(group => group.threads)).toEqual([])
  })
})

describe('diagnostic event ownership', () => {
  it('uses the existing single subscription and clears bounded warnings on disconnect', () => {
    installTestWindow()
    let notify!: (notification: { method: string; params: unknown; atIso: string }) => void
    gatewayMocks.subscribeCodexNotifications.mockImplementation(handler => { notify = handler; return vi.fn() })
    const state = useDesktopState()
    state.startPolling(); state.startPolling()
    expect(gatewayMocks.subscribeCodexNotifications).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 25; i++) notify({ method: 'warning', params: { message: `warning ${i}` }, atIso: '2026-11-15T00:00:00Z' })
    expect(state.diagnosticWarnings.value).toHaveLength(20)
    expect(state.diagnosticWarnings.value[0]?.message).toBe('warning 5')
    notify({ method: 'app-server/disconnected', params: {}, atIso: '2026-11-15T00:00:00Z' })
    expect(state.operationEpoch.value).toBe(1)
    expect(state.diagnosticWarnings.value).toEqual([])
    state.stopPolling()
  })
})


it('does not restore stale durable token usage or write navigation/usage caches', () => {
  installTestWindow({ 'codex-web-local.thread-token-usage.v1': JSON.stringify({ t: { total: {}, last: {}, modelContextWindow: 100 } }) })
  const state = useDesktopState()
  state.primeSelectedThread('t')
  expect(state.selectedThreadTokenUsage.value).toBeNull()
  expect(window.localStorage.setItem).not.toHaveBeenCalled()
})
