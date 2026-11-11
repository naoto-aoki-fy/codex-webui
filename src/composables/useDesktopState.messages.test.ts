import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesktopState } from './useDesktopState'
import { reasoningCatalog } from '../api/codexGateway'
import type { ResumedThread, RpcNotification } from '../api/codexGateway'
import type { UiMessage, UiThread } from '../types/codex'

const gateway = vi.hoisted(() => ({
  getThreadGroupsPage: vi.fn(),
  getThreadDetail: vi.fn(),
  getOlderThreadMessages: vi.fn(),
  resumeThread: vi.fn(),
  startThreadTurn: vi.fn(),
  interruptThreadTurn: vi.fn(),
  startThread: vi.fn(),
  subscribeCodexNotifications: vi.fn(),
  getPendingServerRequests: vi.fn(),
  replyToServerRequest: vi.fn(),
  getThreadTitleCache: vi.fn(),
  getWorkspaceRootsState: vi.fn(),
  getAvailableModelIds: vi.fn(),
  getCurrentModelConfig: vi.fn(),
  getAvailableCollaborationModes: vi.fn(),
  getSkillsList: vi.fn(),
  getAccountRateLimits: vi.fn(),
}))

vi.mock('../api/codexGateway', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/codexGateway')>(),
  ...gateway,
}))

const oldUser: UiMessage = {
  id: 'user-1', role: 'user', text: 'hello', messageType: 'userMessage', turnId: 'turn-1', turnIndex: 0,
}
const nextUser: UiMessage = {
  id: 'user-2', role: 'user', text: 'sent-now', messageType: 'userMessage', turnId: 'turn-2', turnIndex: 1,
}
const reply: UiMessage = {
  id: 'assistant-2', role: 'assistant', text: 'visible reply', messageType: 'agentMessage', turnId: 'turn-2', turnIndex: 1,
}
const thread: UiThread = {
  id: 'thread-1', title: 'Test chat', cwd: '/tmp/project', projectName: 'project',
  createdAtIso: '2026-10-30T00:00:00Z', updatedAtIso: '2026-10-30T00:00:00Z',
  preview: '', unread: false, inProgress: false, hasWorktree: false,
}
const oldDetail: ResumedThread = {
  model: 'gpt-5.5', modelProvider: 'openai', messages: [oldUser],
  inProgress: false, activeTurnId: '', hasMoreOlder: false, turnIndexByTurnId: { 'turn-1': 0 },
}
const completedDetail: ResumedThread = {
  ...oldDetail, messages: [oldUser, nextUser, reply], turnIndexByTurnId: { 'turn-1': 0, 'turn-2': 1 },
}
const activeDetail: ResumedThread = {
  ...completedDetail, messages: [oldUser, nextUser], inProgress: true, activeTurnId: 'turn-2',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

let notificationHandler: (notification: RpcNotification) => void

function notify(notification: Omit<RpcNotification, 'atIso'>) {
  notificationHandler({ ...notification, atIso: new Date().toISOString() })
}
const states: Array<ReturnType<typeof useDesktopState>> = []

function createState() {
  const state = useDesktopState()
  states.push(state)
  state.primeSelectedThread(thread.id)
  return state
}

async function loadState() {
  const state = createState()
  await state.refreshAll({ includeSelectedThreadMessages: true, awaitAncillaryRefreshes: true })
  state.startPolling()
  return state
}

function turnStarted() {
  notify({ method: 'turn/started', params: { threadId: thread.id, turn: { id: 'turn-2', status: 'inProgress' } } })
}

function turnCompleted() {
  notify({ method: 'turn/completed', params: { threadId: thread.id, turn: { id: 'turn-2', status: 'completed' } } })
}

function streamReply(text = reply.text) {
  notify({ method: 'item/agentMessage/delta', params: { threadId: thread.id, turnId: 'turn-2', itemId: reply.id, delta: text } })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-30T00:00:00Z'))
  const storage = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
  gateway.getThreadGroupsPage.mockResolvedValue({ groups: [{ projectName: 'project', threads: [thread] }], nextCursor: null })
  gateway.getThreadTitleCache.mockResolvedValue({ titles: {} })
  gateway.getWorkspaceRootsState.mockRejectedValue(new Error('no workspace roots'))
  gateway.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: [] })
  gateway.getCurrentModelConfig.mockResolvedValue({ model: 'gpt-5.5', reasoningEffort: '', speedMode: 'standard' })
  gateway.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
  gateway.getSkillsList.mockResolvedValue([])
  gateway.getAccountRateLimits.mockResolvedValue(null)
  gateway.getPendingServerRequests.mockResolvedValue([])
  gateway.resumeThread.mockResolvedValue(oldDetail)
  gateway.getThreadDetail.mockResolvedValue(activeDetail)
  gateway.startThreadTurn.mockResolvedValue('turn-2')
  gateway.startThread.mockResolvedValue({ threadId: thread.id, model: 'gpt-5.5', modelProvider: 'openai' })
  gateway.subscribeCodexNotifications.mockImplementation((handler) => { notificationHandler = handler; return vi.fn() })
})

afterEach(() => {
  for (const state of states.splice(0)) state.stopPolling()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('message visibility during sends and history synchronization', () => {
  it('keeps the first optimistic message in a new thread and replaces it without duplication', async () => {
    const state = createState()
    state.startPolling()
    const started = deferred<string>()
    gateway.startThreadTurn.mockImplementation(() => { turnStarted(); return started.promise })
    const newThreadUser = { ...nextUser, turnIndex: 0 }
    gateway.getThreadDetail.mockResolvedValue({ ...activeDetail, messages: [newThreadUser], turnIndexByTurnId: { 'turn-2': 0 } })
    expect(await state.sendMessageToNewThread(nextUser.text, '/tmp/project')).toBe(thread.id)
    expect(state.messages.value.filter((message) => message.role === 'user')).toMatchObject([
      { text: nextUser.text, messageType: 'userMessage.optimistic', turnIndex: 0 },
    ])
    started.resolve('turn-2')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.messages.value.filter((message) => message.role === 'user')).toEqual([newThreadUser])
  })

  it('shows an existing-thread send before the turn request resolves', async () => {
    const state = await loadState()
    const started = deferred<string>()
    gateway.startThreadTurn.mockReturnValue(started.promise)
    const sending = state.sendMessageToSelectedThread(nextUser.text)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.messages.value.filter((message) => message.text === nextUser.text)).toHaveLength(1)
    started.resolve('turn-2')
    await sending
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.messages.value.filter((message) => message.text === nextUser.text)).toEqual([nextUser])
  })

  it('fetches completion inside the two-second cache window and survives reload', async () => {
    const state = await loadState()
    gateway.startThreadTurn.mockImplementation(async () => { turnStarted(); return 'turn-2' })
    await state.sendMessageToSelectedThread(nextUser.text)
    gateway.getThreadDetail.mockResolvedValue(completedDetail)
    turnCompleted()
    await vi.advanceTimersByTimeAsync(5000)
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(2)
    expect(state.messages.value.filter((message) => message.role !== 'system')).toEqual(completedDetail.messages)
    expect(state.selectedLiveOverlay.value).toBeNull()
    // Unchanged navigation still reuses the cache and adds no history request.
    await state.loadMessages(thread.id)
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(2)
    gateway.resumeThread.mockResolvedValue(completedDetail)
    const reloaded = createState()
    await reloaded.loadMessages(thread.id)
    expect(reloaded.messages.value).toEqual(completedDetail.messages)
  })

  it('refreshes a changed thread version even within two seconds', async () => {
    const state = await loadState()
    gateway.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'project', threads: [{ ...thread, updatedAtIso: '2026-10-30T00:00:01Z' }] }], nextCursor: null,
    })
    gateway.getThreadDetail.mockResolvedValue(completedDetail)
    await state.refreshAll({ forceThreadRefresh: true })
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.messages.value).toEqual(completedDetail.messages)
  })

  it('retains the submitted message alongside an error when sending fails', async () => {
    const state = await loadState()
    gateway.startThreadTurn.mockRejectedValue(new Error('send failed'))
    await expect(state.sendMessageToSelectedThread(nextUser.text)).rejects.toThrow('send failed')
    expect(state.messages.value.filter((message) => message.text === nextUser.text)).toHaveLength(1)
    expect(state.selectedLiveOverlay.value?.errorText).toBe('send failed')
  })

  it('retries a transient history failure when a completion notification arrives', async () => {
    const state = await loadState()
    gateway.getThreadDetail.mockRejectedValueOnce(new Error('temporary read failure'))
    await expect(state.loadMessages(thread.id, { force: true })).rejects.toThrow('temporary read failure')
    gateway.getThreadDetail.mockResolvedValue(completedDetail)
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.filter((message) => message.role !== 'system')).toEqual(completedDetail.messages)
    expect(state.selectedLiveOverlay.value).toBeNull()
  })

  it('keeps a live reply when a stale completed snapshot arrives, then reconciles it once', async () => {
    const state = await loadState()
    const pending = deferred<ResumedThread>()
    gateway.getThreadDetail.mockReturnValueOnce(pending.promise)
    turnStarted()
    await vi.advanceTimersByTimeAsync(220)
    streamReply()
    expect(state.messages.value.some((message) => message.text === reply.text)).toBe(true)
    pending.resolve(oldDetail)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.messages.value.some((message) => message.text === reply.text)).toBe(true)
    expect(state.selectedLiveOverlay.value).not.toBeNull()
    gateway.getThreadDetail.mockResolvedValue(completedDetail)
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.filter((message) => message.id === reply.id)).toEqual([reply])
    expect(state.selectedLiveOverlay.value).toBeNull()
  })

  it('does not let a history read begun after turn start reset a newer active turn', async () => {
    const state = await loadState()
    gateway.getThreadDetail.mockResolvedValue(oldDetail)
    turnStarted()
    await vi.advanceTimersByTimeAsync(220)
    expect(state.selectedLiveOverlay.value).not.toBeNull()
    expect(state.messages.value).toEqual([oldUser])
  })

  it('keeps a completed live reply until history contains it', async () => {
    const state = await loadState()
    turnStarted()
    notify({ method: 'item/completed', params: { threadId: thread.id, item: { id: reply.id, type: 'agentMessage', text: reply.text } } })
    gateway.getThreadDetail.mockResolvedValue(oldDetail)
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.filter((message) => message.id === reply.id)).toHaveLength(1)
    gateway.getThreadDetail.mockResolvedValue(completedDetail)
    await state.loadMessages(thread.id, { silent: true, force: true })
    expect(state.messages.value.filter((message) => message.id === reply.id)).toEqual([reply])
  })

  it('does not truncate or duplicate live text when history has an earlier prefix', async () => {
    const state = await loadState()
    turnStarted()
    streamReply()
    gateway.getThreadDetail.mockResolvedValue({ ...activeDetail, messages: [oldUser, nextUser, { ...reply, text: 'visible' }] })
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.filter((message) => message.id === reply.id).map((message) => message.text)).toEqual([reply.text])
    streamReply(' continued')
    expect(state.messages.value.filter((message) => message.id === reply.id).map((message) => message.text)).toEqual([reply.text + ' continued'])
    gateway.getThreadDetail.mockResolvedValue({ ...completedDetail, messages: [oldUser, nextUser, { ...reply, text: reply.text + ' continued' }] })
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.filter((message) => message.id === reply.id).map((message) => message.text)).toEqual([reply.text + ' continued'])
  })

  it('performs one follow-up read for completion arriving during a pending history read', async () => {
    const state = await loadState()
    await vi.advanceTimersByTimeAsync(2500)
    const pending = deferred<ResumedThread>()
    gateway.getThreadDetail.mockReturnValueOnce(pending.promise).mockResolvedValue(completedDetail)
    turnStarted()
    const loading = state.loadMessages(thread.id)
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    pending.resolve(activeDetail)
    await loading
    await vi.advanceTimersByTimeAsync(220)
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(2)
    expect(state.messages.value.filter((message) => message.role !== 'system')).toEqual(completedDetail.messages)
    expect(state.selectedLiveOverlay.value).toBeNull()
  })

  it('continues streaming from the persisted prefix after history catches up mid-turn', async () => {
    const state = await loadState()
    turnStarted()
    streamReply('visible')
    gateway.getThreadDetail.mockResolvedValue({ ...activeDetail, messages: [oldUser, nextUser, { ...reply, text: 'visible' }] })
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.filter((message) => message.id === reply.id).map((message) => message.text)).toEqual(['visible'])
    streamReply(' reply')
    expect(state.messages.value.filter((message) => message.id === reply.id).map((message) => message.text)).toEqual([reply.text])
  })

  it('does not deduplicate a repeated prompt against a previous turn', async () => {
    const state = await loadState()
    gateway.getThreadDetail.mockResolvedValue(oldDetail)
    await state.sendMessageToSelectedThread(oldUser.text)
    expect(state.messages.value.filter((message) => message.text === oldUser.text)).toHaveLength(2)
    gateway.getThreadDetail.mockResolvedValue({ ...activeDetail, messages: [oldUser, { ...nextUser, text: oldUser.text }] })
    await state.loadMessages(thread.id, { force: true, silent: true })
    expect(state.messages.value.filter((message) => message.text === oldUser.text)).toHaveLength(2)
    expect(state.messages.value.some((message) => message.messageType === 'userMessage.optimistic')).toBe(false)
  })

  it.each(['queue', '"queue"'])('ignores legacy Queue preference %s across state recreation', async (legacy) => {
    window.localStorage.setItem('codex-web-local.in-progress-send-mode.v1', legacy)
    for (let reload = 0; reload < 2; reload++) {
      const state = await loadState()
      turnStarted()
      const started = deferred<string>()
      gateway.startThreadTurn.mockReturnValueOnce(started.promise)
      await state.sendMessageToSelectedThread(`immediate-${reload}`)
      await vi.advanceTimersByTimeAsync(0)
      expect(gateway.startThreadTurn).toHaveBeenCalledTimes(reload + 1)
      expect(gateway.startThreadTurn.mock.calls[reload]?.[1]).toBe(`immediate-${reload}`)
      // Completion while the submission is awaiting RPC must not replay it.
      turnCompleted()
      started.resolve('turn-2')
      await vi.advanceTimersByTimeAsync(15000)
      expect(gateway.startThreadTurn).toHaveBeenCalledTimes(reload + 1)
      state.stopPolling()
    }
  })

  it('interrupts an active turn without replaying an in-flight steering submission', async () => {
    const state = await loadState()
    turnStarted()
    const started = deferred<string>()
    gateway.startThreadTurn.mockReturnValueOnce(started.promise)
    await state.sendMessageToSelectedThread('steer before stop')
    await vi.advanceTimersByTimeAsync(0)
    await state.interruptSelectedThreadTurn()
    expect(gateway.interruptThreadTurn).toHaveBeenCalledWith(thread.id, 'turn-2')
    turnCompleted()
    started.resolve('turn-2')
    await vi.advanceTimersByTimeAsync(15000)
    expect(gateway.startThreadTurn).toHaveBeenCalledOnce()
  })

  it('shows steering submissions immediately with unique IDs for rapid sends', async () => {
    const state = await loadState()
    turnStarted()
    const started = deferred<string>()
    gateway.startThreadTurn.mockReturnValue(started.promise)
    await state.sendMessageToSelectedThread('first', [], [])
    await state.sendMessageToSelectedThread('second', [], [])
    await vi.waitFor(() => expect(gateway.startThreadTurn).toHaveBeenCalledTimes(2))
    expect(gateway.startThreadTurn.mock.calls.map((call) => call[1])).toEqual(['first', 'second'])
    const optimistic = state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic')
    expect(optimistic.map((message) => message.text)).toEqual(['first', 'second'])
    expect(new Set(optimistic.map((message) => message.id)).size).toBe(2)
    started.resolve('turn-2')
    await vi.advanceTimersByTimeAsync(0)
  })
})

const pastedFile = {
  label: 'pasted-text-2026-11-04-12-00-00.txt',
  path: '/api/uploads/pasted-text-2026-11-04-12-00-00.txt',
  fsPath: '/tmp/codex-web-uploads/pasted-text-2026-11-04-12-00-00.txt',
}
const secondFile = {
  label: 'notes.txt', path: '/api/uploads/notes.txt', fsPath: '/tmp/codex-web-uploads/notes.txt',
}

function attachmentUser(files = [pastedFile], text = ''): UiMessage {
  return { ...nextUser, text, fileAttachments: files.map(({ label, path }) => ({ label, path })) }
}

function attachmentDetail(user: UiMessage, previous: UiMessage[] = [oldUser]): ResumedThread {
  return {
    ...activeDetail,
    messages: [...previous, user],
    turnIndexByTurnId: { ...oldDetail.turnIndexByTurnId, [user.turnId!]: user.turnIndex! },
    activeTurnId: user.turnId!,
  }
}

function expectConfirmedAttachment(state: ReturnType<typeof useDesktopState>, expected: UiMessage[]) {
  expect(state.messages.value.filter((message) => message.role === 'user')).toEqual(expected)
  expect(state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic')).toEqual([])
}

describe('optimistic attachment reconciliation', () => {
  it.each([
    { context: 'new', prompt: '', files: [pastedFile] },
    { context: 'new', prompt: 'Read these notes', files: [pastedFile] },
    { context: 'existing', prompt: '', files: [pastedFile] },
    { context: 'existing', prompt: 'Read these notes', files: [pastedFile] },
    { context: 'new', prompt: '', files: [pastedFile, secondFile] },
    { context: 'existing', prompt: '', files: [pastedFile, secondFile] },
  ])('replaces $context-thread optimistic attachments (prompt: "$prompt", files: $files.length)', async ({ context, prompt, files }) => {
    const isNew = context === 'new'
    const state = isNew ? createState() : await loadState()
    if (isNew) state.startPolling()
    const started = deferred<string>()
    gateway.startThreadTurn.mockReturnValue(started.promise)
    const persisted = {
      ...attachmentUser(files, prompt),
      turnIndex: isNew ? 0 : 1,
    }
    gateway.getThreadDetail.mockResolvedValue(attachmentDetail(persisted, isNew ? [] : [oldUser]))
    const sending = isNew
      ? state.sendMessageToNewThread(prompt, '/tmp/project', [], [], files)
      : state.sendMessageToSelectedThread(prompt, [], [], files)
    await vi.advanceTimersByTimeAsync(0)
    const optimistic = state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic')
    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({ text: prompt, fileAttachments: files })
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    expect(gateway.startThreadTurn.mock.calls[0]?.[6]).toEqual(files)
    started.resolve('turn-2')
    await sending
    await vi.advanceTimersByTimeAsync(0)
    expectConfirmedAttachment(state, isNew ? [persisted] : [oldUser, persisted])
    expect(state.messages.value.find((message) => message.id === persisted.id)?.fileAttachments)
      .toEqual(files.map(({ label, path }) => ({ label, path })))
    // A repeated notification/history snapshot must remain idempotent.
    await state.loadMessages(thread.id, { force: true, silent: true })
    expectConfirmedAttachment(state, isNew ? [persisted] : [oldUser, persisted])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('keeps separate submissions with the same filename (different path: %s)', async (differentPath) => {
    const first = { ...attachmentUser(), id: 'user-1', turnId: 'turn-1', turnIndex: 0 }
    const previous = { ...oldDetail, messages: [first] }
    gateway.resumeThread.mockResolvedValue(previous)
    gateway.getThreadDetail.mockResolvedValue(previous)
    const state = await loadState()
    const files = [{ ...pastedFile, ...(differentPath ? {
      path: '/api/uploads/second/pasted-text-2026-11-04-12-00-00.txt',
      fsPath: '/tmp/codex-web-uploads/second/pasted-text-2026-11-04-12-00-00.txt',
    } : {}) }]
    await state.sendMessageToSelectedThread('', [], [], files)
    expect(state.messages.value.filter((message) => message.role === 'user')).toHaveLength(2)
    expect(state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic'))
      .toMatchObject([{ turnId: 'turn-2', fileAttachments: files }])
    const persisted = attachmentUser(files)
    gateway.getThreadDetail.mockResolvedValue(attachmentDetail(persisted, [first]))
    await state.loadMessages(thread.id, { force: true, silent: true })
    expectConfirmedAttachment(state, [first, persisted])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it('retains an accepted attachment through stale reads until completion provides its persisted row', async () => {
    const state = await loadState()
    gateway.getThreadDetail.mockResolvedValue(oldDetail)
    await state.sendMessageToSelectedThread('', [], [], [pastedFile])
    expect(state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic'))
      .toMatchObject([{ text: '', turnId: 'turn-2', fileAttachments: [pastedFile] }])
    const persisted = attachmentUser()
    gateway.getThreadDetail.mockResolvedValue({ ...attachmentDetail(persisted), inProgress: false, activeTurnId: '' })
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    expectConfirmedAttachment(state, [oldUser, persisted])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it('reconciles history delivered before the turn-start response once its identity is known', async () => {
    const state = await loadState()
    const started = deferred<string>()
    gateway.startThreadTurn.mockReturnValue(started.promise)
    const sending = state.sendMessageToSelectedThread('', [], [], [pastedFile])
    await vi.advanceTimersByTimeAsync(0)
    const persisted = attachmentUser()
    gateway.getThreadDetail.mockResolvedValue(attachmentDetail(persisted))
    turnStarted()
    await vi.advanceTimersByTimeAsync(220)
    expect(state.messages.value.some((message) => message.id === persisted.id)).toBe(true)
    started.resolve('turn-2')
    await sending
    expectConfirmedAttachment(state, [oldUser, persisted])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it('recovers from a disconnected history read without submitting the attachment again', async () => {
    const state = await loadState()
    gateway.getThreadDetail.mockResolvedValue(oldDetail)
    await state.sendMessageToSelectedThread('', [], [], [pastedFile])
    gateway.getThreadDetail.mockRejectedValueOnce(new Error('connection interrupted'))
    await expect(state.loadMessages(thread.id, { force: true })).rejects.toThrow('connection interrupted')
    expect(state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic')).toHaveLength(1)
    const persisted = attachmentUser()
    gateway.getThreadDetail.mockResolvedValue({ ...attachmentDetail(persisted), inProgress: false, activeTurnId: '' })
    turnCompleted()
    await vi.advanceTimersByTimeAsync(220)
    expectConfirmedAttachment(state, [oldUser, persisted])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it('retains a failed attachment submission and its error without automatically retrying', async () => {
    const state = await loadState()
    gateway.startThreadTurn.mockRejectedValue(new Error('Model is not supported for this account'))
    await expect(state.sendMessageToSelectedThread('', [], [], [pastedFile]))
      .rejects.toThrow('Model is not supported for this account')
    expect(state.messages.value.filter((message) => message.messageType === 'userMessage.optimistic'))
      .toMatchObject([{ text: '', fileAttachments: [pastedFile] }])
    expect(state.selectedLiveOverlay.value?.errorText).toBe('Model is not supported for this account')
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    expect(state.readModelIdForThread(thread.id)).toBe('gpt-5.5')
  })

  it('shows terminal unsupported-model turn errors without resubmitting', async () => {
    const state = await loadState()
    gateway.startThreadTurn.mockImplementation(async () => { turnStarted(); return 'turn-2' })
    gateway.getThreadDetail.mockResolvedValue({ ...activeDetail, messages: [oldUser, nextUser] })
    await state.sendMessageToSelectedThread('keep this prompt', [], [], [pastedFile])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    notify({
      method: 'turn/completed',
      params: {
        threadId: thread.id,
        turn: {
          id: 'turn-2',
          status: 'failed',
          error: { message: 'Model is not supported for this account' },
        },
      },
    })
    await vi.advanceTimersByTimeAsync(220)
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    expect(state.readModelIdForThread(thread.id)).toBe('gpt-5.5')
    expect(state.selectedLiveOverlay.value?.errorText).toBe('Model is not supported for this account')
  })

  it('restores exactly the same persisted attachments in a fresh state after successful submission', async () => {
    const state = await loadState()
    const persisted = attachmentUser([pastedFile, secondFile], 'Read both files')
    const detail = { ...attachmentDetail(persisted), inProgress: false, activeTurnId: '' }
    gateway.getThreadDetail.mockResolvedValue(detail)
    await state.sendMessageToSelectedThread('Read both files', [], [], [pastedFile, secondFile])
    expectConfirmedAttachment(state, [oldUser, persisted])
    gateway.resumeThread.mockResolvedValue(detail)
    const reloaded = createState()
    await reloaded.loadMessages(thread.id)
    expectConfirmedAttachment(reloaded, [oldUser, persisted])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })
})

// These tests intentionally assert observed behavior, including defects. A future
// fix should update the affected assertion rather than preserve the defect.
// Disposal should invalidate continuations; restarting should reload cleared history.
describe('async request and lifecycle characterization (current behavior)', () => {
  const refreshOptions = { includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true }
  const catalog = [{ id: 'gpt-5.5', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }]

  it('keeps selected B loading when A finishes first', async () => {
    const a = deferred<ResumedThread>()
    const b = deferred<ResumedThread>()
    gateway.resumeThread.mockImplementation((id) => id === thread.id ? a.promise : b.promise)
    const state = createState()
    const loadA = state.ensureThreadMessagesLoaded(thread.id)
    state.primeSelectedThread('B')
    const loadB = state.ensureThreadMessagesLoaded('B')
    expect(state.isLoadingMessages.value).toBe(true)
    expect(gateway.resumeThread.mock.calls).toEqual([[thread.id], ['B']])
    a.resolve(oldDetail)
    await loadA
    expect(state.isLoadingMessages.value).toBe(true)
    expect(state.messages.value).toEqual([])
    b.resolve(completedDetail)
    await loadB
    expect(state.messages.value).toEqual(completedDetail.messages)
    expect(state.isLoadingMessages.value).toBe(false)
  })

  it.each(['failure', 'B-first'] as const)('preserves selected ownership when A overlaps B: %s', async (outcome) => {
    const a = deferred<ResumedThread>()
    const b = deferred<ResumedThread>()
    gateway.resumeThread.mockImplementation((id) => id === thread.id ? a.promise : b.promise)
    const state = createState()
    const loadA = state.loadMessages(thread.id).catch((error: Error) => error.message)
    state.primeSelectedThread('B')
    expect(state.isLoadingMessages.value).toBe(false)
    const loadB = state.loadMessages('B')
    expect(state.isLoadingMessages.value).toBe(true)
    if (outcome === 'failure') {
      a.reject(new Error('A failed'))
      expect(await loadA).toBe('A failed')
      expect(state.isLoadingMessages.value).toBe(true)
      b.resolve(completedDetail)
      await loadB
    } else {
      b.resolve(completedDetail)
      await loadB
      expect(state.isLoadingMessages.value).toBe(false)
      state.primeSelectedThread(thread.id)
      expect(state.isLoadingMessages.value).toBe(true)
      state.primeSelectedThread('B')
      expect(state.isLoadingMessages.value).toBe(false)
      a.resolve(oldDetail)
      await loadA
    }
    expect(state.isLoadingMessages.value).toBe(false)
  })

  it.each([true, false])('keeps background initial reads scoped to their thread (silent=%s)', async (silent) => {
    const background = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(background.promise)
    const state = createState()
    const loadingRef = state.isLoadingMessages
    const loading = state.loadMessages('B', { silent })
    expect(loadingRef.value).toBe(false)
    state.primeSelectedThread('B')
    expect(loadingRef.value).toBe(!silent)
    const coalesced = state.ensureThreadMessagesLoaded('B')
    expect(loadingRef.value).toBe(!silent)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(1)
    background.resolve(oldDetail)
    await Promise.all([loading, coalesced])
    expect(state.isLoadingMessages).toBe(loadingRef)
    expect(loadingRef.value).toBe(false)
  })

  it('does not let a forced background refresh clear the selected initial load', async () => {
    const state = createState()
    await state.loadMessages(thread.id)
    const refresh = deferred<ResumedThread>()
    const selected = deferred<ResumedThread>()
    gateway.getThreadDetail.mockReturnValueOnce(refresh.promise)
    gateway.resumeThread.mockReturnValueOnce(selected.promise)
    state.primeSelectedThread('B')
    const refreshing = state.loadMessages(thread.id, { force: true })
    expect(state.isLoadingMessages.value).toBe(false)
    const loading = state.loadMessages('B')
    expect(state.isLoadingMessages.value).toBe(true)
    refresh.resolve(completedDetail)
    await refreshing
    expect(state.isLoadingMessages.value).toBe(true)
    selected.resolve(oldDetail)
    await loading
    expect(state.isLoadingMessages.value).toBe(false)
    expect(gateway.getThreadDetail.mock.calls).toEqual([[thread.id]])
    expect(gateway.resumeThread.mock.calls).toEqual([[thread.id], ['B']])
  })

  it('queues forced history after a coalesced initial load without showing cached-refresh loading', async () => {
    const initial = deferred<ResumedThread>()
    const fresh = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(initial.promise)
    gateway.getThreadDetail.mockReturnValueOnce(fresh.promise)
    const state = createState()
    const loading = state.loadMessages(thread.id)
    const forced = state.loadMessages(thread.id, { force: true })
    expect(state.isLoadingMessages.value).toBe(true)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(1)
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
    initial.resolve(oldDetail)
    await loading
    expect(state.isLoadingMessages.value).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getThreadDetail.mock.calls).toEqual([[thread.id]])
    expect(state.isLoadingMessages.value).toBe(false)
    fresh.resolve(completedDetail)
    await forced
    expect(state.messages.value).toEqual(completedDetail.messages)
    expect(state.isLoadingMessages.value).toBe(false)
  })

  it('coalesces rapid A→B→A history selection by thread key', async () => {
    const a = deferred<ResumedThread>()
    const b = deferred<ResumedThread>()
    gateway.resumeThread.mockImplementation((id) => id === thread.id ? a.promise : b.promise)
    const state = createState()
    const first = state.selectThread(thread.id)
    const second = state.selectThread('B')
    expect(state.isLoadingMessages.value).toBe(true)
    const third = state.selectThread(thread.id)
    expect(state.isLoadingMessages.value).toBe(true)
    expect(gateway.resumeThread.mock.calls).toEqual([[thread.id], ['B']])
    b.resolve(completedDetail)
    await second
    expect(state.isLoadingMessages.value).toBe(true)
    expect(state.selectedThreadId.value).toBe(thread.id)
    expect(state.messages.value).toEqual([])
    a.resolve(oldDetail)
    expect(await Promise.all([first, third])).toEqual(['ok', 'ok'])
    expect(state.isLoadingMessages.value).toBe(false)
    expect(state.messages.value).toEqual(oldDetail.messages)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(2)
  })

  it('ignores a late history selection failure after successful navigation', async () => {
    const a = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(a.promise)
    const state = createState()
    const first = state.selectThread(thread.id)
    expect(await state.selectThread('B')).toBe('ok')
    expect(state.error.value).toBe('')
    a.reject(new Error('late A history failure'))
    expect(await first).toBe('error')
    expect(state.selectedThreadId.value).toBe('B')
    expect(state.messages.value).toEqual(oldDetail.messages)
    expect(state.error.value).toBe('')
  })

  it.each(['ordinary failure', 'Thread not found'])('preserves current selection failure results: %s', async (message) => {
    const pending = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(pending.promise)
    const state = createState()
    const selecting = state.selectThread('B')
    expect(state.isLoadingMessages.value).toBe(true)
    expect(state.error.value).toBe('')
    state.primeSelectedThread('B')
    expect(state.selectedThreadId.value).toBe('B')
    pending.reject(new Error(message))
    expect(await selecting).toBe(message === 'Thread not found' ? 'not-found' : 'error')
    expect(state.error.value).toBe(message)
    expect(state.isLoadingMessages.value).toBe(false)
  })

  it.each(['B', '', 'return-to-A', 'dispose'])('invalidates pending selection errors on %s navigation', async (navigation) => {
    const pending = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(pending.promise)
    const state = createState()
    const selecting = state.selectThread(thread.id)
    expect(state.isLoadingMessages.value).toBe(true)
    if (navigation === 'dispose') state.stopPolling()
    else {
      // Route/workspace navigation primes the next selection before loading it.
      state.primeSelectedThread(navigation === 'B' ? 'B' : '', { persist: false })
      if (navigation === 'return-to-A') state.primeSelectedThread(thread.id)
    }
    state.error.value = 'independent action failure'
    pending.reject(new Error('obsolete selection failure'))
    expect(await selecting).toBe('error')
    expect(state.error.value).toBe('independent action failure')
  })

  it('retains failure ownership for the latest A selection sharing the first A history request', async () => {
    const pending = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(pending.promise)
    const state = createState()
    const first = state.selectThread(thread.id)
    expect(await state.selectThread('B')).toBe('ok')
    const latest = state.selectThread(thread.id)
    expect(state.selectedThreadId.value).toBe(thread.id)
    expect(state.isLoadingMessages.value).toBe(true)
    expect(state.error.value).toBe('')
    expect(gateway.resumeThread.mock.calls).toEqual([[thread.id], ['B']])
    pending.reject(new Error('current shared history failure'))
    expect(await Promise.all([first, latest])).toEqual(['error', 'error'])
    expect(state.error.value).toBe('current shared history failure')
    expect(state.isLoadingMessages.value).toBe(false)
  })

  it.each(['success', 'failure'] as const)('fetches B independently and ignores late A %s', async (outcome) => {
    gateway.getThreadGroupsPage.mockResolvedValue({ groups: [{ projectName: 'project', threads: [thread, { ...thread, id: 'B', cwd: '/tmp/B' }] }], nextCursor: null })
    const skillsA = deferred<unknown[]>()
    const skillsB = deferred<unknown[]>()
    gateway.getSkillsList.mockReturnValueOnce(skillsA.promise).mockReturnValueOnce(skillsB.promise)
    const state = createState()
    const a = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getSkillsList.mock.calls).toEqual([[['/tmp/project']]])
    const sameA = state.refreshSkills({ force: true })
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(1)
    state.primeSelectedThread('B')
    const b = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getSkillsList.mock.calls).toEqual([[['/tmp/project']], [['/tmp/B']]])
    expect(state.installedSkills.value).toEqual([])
    const rowsB = [{ name: 'B-only', path: '/tmp/B/SKILL.md' }]
    skillsB.resolve(rowsB)
    await b
    expect(state.installedSkills.value).toEqual(rowsB)
    if (outcome === 'success') skillsA.resolve([{ name: 'A-only', path: '/tmp/project/SKILL.md' }])
    else skillsA.reject(new Error('obsolete A failure'))
    await Promise.all([a, sameA])
    expect(state.selectedThreadId.value).toBe('B')
    expect(state.installedSkills.value).toEqual(rowsB)
    expect(state.error.value).toBe('')
    await state.refreshSkills()
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(2)
  })

  it('keeps B coalescing after A cleanup and preserves cache reuse, expiry, and forced refresh', async () => {
    gateway.getThreadGroupsPage.mockResolvedValue({ groups: [{ projectName: 'project', threads: [thread, { ...thread, id: 'B', cwd: '  /tmp/B  ' }] }], nextCursor: null })
    const skillsA = deferred<unknown[]>()
    const skillsB = deferred<unknown[]>()
    gateway.getSkillsList.mockReturnValueOnce(skillsA.promise).mockReturnValueOnce(skillsB.promise)
    const state = createState()
    const a = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    state.primeSelectedThread('B')
    const b = state.refreshSkills()
    expect(gateway.getSkillsList.mock.calls).toEqual([[['/tmp/project']], [['/tmp/B']]])
    skillsA.resolve([{ name: 'A-only' }])
    await a
    expect(state.installedSkills.value).toEqual([])
    const sameB = state.refreshSkills({ force: true })
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(2)
    skillsB.resolve([{ name: 'B-only' }])
    await Promise.all([b, sameB])
    expect(state.installedSkills.value).toEqual([{ name: 'B-only' }])
    await state.refreshSkills()
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(2)
    await state.refreshSkills({ force: true })
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(60_000)
    await state.refreshSkills()
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['config', 'ordinary failure'], ['config', 'Codex CLI is not available'],
    ['catalog', 'ordinary failure'], ['catalog', 'Codex CLI is not available'],
  ])('ignores stale %s failure %s after a newer catalog succeeds', async (stage, message) => {
    const stale = deferred<unknown>()
    gateway.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: catalog })
    if (stage === 'config') gateway.getCurrentModelConfig.mockReturnValueOnce(stale.promise)
    else gateway.getAvailableModelIds.mockReturnValueOnce(stale.promise)
    const state = createState()
    const older = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    const newer = state.refreshAll(refreshOptions)
    await newer
    expect(reasoningCatalog.value).toEqual(catalog)
    expect(state.codexCliMissingError.value).toBe('')
    stale.reject(new Error(message))
    await older
    expect(reasoningCatalog.value).toEqual(catalog)
    expect(state.availableModelIds.value).toEqual(['gpt-5.5'])
    expect(state.readModelIdForThread(thread.id)).toBe('gpt-5.5')
    expect(state.readReasoningEffortForThread(thread.id)).toBe('low')
    expect(state.codexCliMissingError.value).toBe('')
    expect(state.error.value).toBe('')
  })

  it.each(['config', 'catalog'] as const)('preserves current %s failure behavior and saved preferences', async (stage) => {
    const state = createState()
    gateway.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: catalog })
    await state.refreshAll(refreshOptions)
    state.setSelectedReasoningEffort('low', thread.id)
    const failure = deferred<unknown>()
    if (stage === 'config') gateway.getCurrentModelConfig.mockReturnValueOnce(failure.promise)
    else gateway.getAvailableModelIds.mockReturnValueOnce(failure.promise)
    const refreshing = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(reasoningCatalog.value).toEqual(catalog)
    failure.reject(new Error(stage === 'config' ? 'Codex CLI is not available' : 'catalog failed'))
    await refreshing
    expect(reasoningCatalog.value).toEqual([])
    expect(state.availableModelIds.value).toEqual(['gpt-5.5'])
    expect(state.readModelIdForThread(thread.id)).toBe('gpt-5.5')
    expect(Boolean(state.codexCliMissingError.value)).toBe(stage === 'config')
    expect(state.error.value).toBe('')
    await state.refreshAll(refreshOptions)
    expect(reasoningCatalog.value).toEqual(catalog)
    expect(state.readReasoningEffortForThread(thread.id)).toBe('low')
    expect(state.codexCliMissingError.value).toBe('')
  })

  it('ignores a catalog failure after selection changes without a newer refresh', async () => {
    const state = createState()
    gateway.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: catalog })
    await state.refreshAll(refreshOptions)
    const failure = deferred<unknown>()
    gateway.getAvailableModelIds.mockReturnValueOnce(failure.promise)
    const refreshing = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(2)
    state.primeSelectedThread('B')
    expect(reasoningCatalog.value).toEqual(catalog)
    failure.reject(new Error('Codex CLI is not available'))
    await refreshing
    expect(state.selectedThreadId.value).toBe('B')
    expect(reasoningCatalog.value).toEqual(catalog)
    expect(state.codexCliMissingError.value).toBe('')
    expect(state.error.value).toBe('')
  })

  it('keeps a current CLI banner when an older catalog failure arrives', async () => {
    const failure = deferred<unknown>()
    gateway.getAvailableModelIds.mockReturnValueOnce(failure.promise)
    const state = createState()
    const older = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    gateway.getCurrentModelConfig.mockRejectedValueOnce(new Error('Codex CLI is not available'))
    await state.refreshAll(refreshOptions)
    const banner = state.codexCliMissingError.value
    expect(banner).not.toBe('')
    failure.reject(new Error('older catalog failed'))
    await older
    expect(state.codexCliMissingError.value).toBe(banner)
    expect(reasoningCatalog.value).toEqual([])
    expect(state.error.value).toBe('')
  })

  it('ignores history when an in-flight read completes after stopPolling', async () => {
    const detail = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(detail.promise)
    const state = createState()
    const loading = state.ensureThreadMessagesLoaded(thread.id)
    state.stopPolling()
    expect(state.messages.value).toEqual([])
    detail.resolve(oldDetail)
    await loading
    expect(state.messages.value).toEqual([])
    expect(state.isLoadingMessages.value).toBe(false)
  })

  it('ignores in-flight skills and quota snapshots after stopPolling', async () => {
    const skills = deferred<unknown[]>()
    const quota = deferred<unknown>()
    gateway.getSkillsList.mockReturnValueOnce(skills.promise)
    gateway.getAccountRateLimits.mockReturnValueOnce(quota.promise)
    const state = createState()
    const refreshing = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(1)
    expect(gateway.getAccountRateLimits).toHaveBeenCalledTimes(1)
    state.stopPolling()
    expect(state.installedSkills.value).toEqual([])
    expect(state.accountRateLimitSnapshots.value).toEqual([])
    const rows = [{ name: 'late', path: '/tmp/SKILL.md' }]
    const snapshot = { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 123 } }
    skills.resolve(rows)
    quota.resolve(snapshot)
    await refreshing
    expect(state.installedSkills.value).toEqual([])
    expect(state.accountRateLimitSnapshots.value).toEqual([])
  })

  it('ignores a pending-request response after unsubscribing', async () => {
    const requests = deferred<unknown[]>()
    gateway.getPendingServerRequests.mockReturnValueOnce(requests.promise)
    const unsubscribe = vi.fn()
    gateway.subscribeCodexNotifications.mockReturnValueOnce(unsubscribe)
    const state = createState()
    state.startPolling()
    state.stopPolling()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(state.selectedThreadServerRequests.value).toEqual([])
    requests.resolve([{ id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id } }])
    await vi.advanceTimersByTimeAsync(0)
    expect(state.selectedThreadServerRequests.value).toEqual([])
    expect(gateway.getPendingServerRequests).toHaveBeenCalledTimes(1)
  })

  it('ignores model success and failure after stopPolling', async () => {
    const success = deferred<unknown>()
    const failure = deferred<unknown>()
    gateway.getCurrentModelConfig.mockReturnValueOnce(success.promise).mockReturnValueOnce(failure.promise)
    gateway.getAvailableModelIds.mockResolvedValue({ ids: ['late-model'], models: catalog })
    const state = createState()
    const first = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    const second = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    state.stopPolling()
    success.resolve({ model: 'late-model', speedMode: 'standard' })
    await first
    expect(state.availableModelIds.value).toEqual([])
    expect(reasoningCatalog.value).toEqual([])
    expect(state.codexCliMissingError.value).toBe('')
    failure.reject(new Error('Codex CLI is not available'))
    await second
    expect(state.codexCliMissingError.value).toBe('')
  })

  it('lets submission complete without UI synchronization or timers after stopPolling', async () => {
    const state = await loadState()
    const turn = deferred<string>()
    gateway.startThreadTurn.mockReturnValueOnce(turn.promise)
    gateway.getThreadDetail.mockResolvedValueOnce(completedDetail)
    const sending = state.sendMessageToSelectedThread('late successful send')
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    state.stopPolling()
    expect(state.messages.value).toEqual([])
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
    turn.resolve('turn-2')
    await sending
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
    expect(state.messages.value).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it('rejects a failed submission without publishing an error after stopPolling', async () => {
    const state = await loadState()
    const turn = deferred<string>()
    gateway.startThreadTurn.mockReturnValueOnce(turn.promise)
    const sending = state.sendMessageToSelectedThread('late send')
    const rejected = expect(sending).rejects.toThrow('late submission failure')
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    state.stopPolling()
    expect(state.error.value).toBe('')
    turn.reject(new Error('late submission failure'))
    await rejected
    expect(state.error.value).toBe('')
  })

  it.each(['ensure', 'select'] as const)('reloads cleared history through %s after stop/restart without duplicate reads', async (method) => {
    gateway.resumeThread.mockResolvedValueOnce({ ...oldDetail, hasMoreOlder: true })
    const state = await loadState()
    expect(state.messages.value).toEqual(oldDetail.messages)
    expect(state.hasMoreOlderMessages.value).toBe(true)
    state.stopPolling()
    expect(state.messages.value).toEqual([])
    expect(state.hasMoreOlderMessages.value).toBe(false)
    expect(state.isLoadingMessages.value).toBe(false)
    state.startPolling()
    const detail = deferred<ResumedThread>()
    gateway.getThreadDetail.mockReturnValueOnce(detail.promise)
    const reload = method === 'ensure'
      ? state.ensureThreadMessagesLoaded(thread.id)
      : state.selectThread(thread.id)
    const concurrent = state.ensureThreadMessagesLoaded(thread.id)
    expect(state.isLoadingMessages.value).toBe(true)
    expect(state.messages.value).toEqual([])
    expect(gateway.getThreadDetail.mock.calls).toEqual([[thread.id]])
    detail.resolve(completedDetail)
    await Promise.all([reload, concurrent])
    expect(state.isLoadingMessages.value).toBe(false)
    expect(state.messages.value).toEqual(completedDetail.messages)
    expect(state.hasMoreOlderMessages.value).toBe(false)
    // Successful reload restores cache reuse for both public entry points.
    await state.ensureThreadMessagesLoaded(thread.id)
    expect(await state.selectThread(thread.id)).toBe('ok')
    expect(state.messages.value).toEqual(completedDetail.messages)
    expect(gateway.resumeThread.mock.calls).toEqual([[thread.id]])
    expect(gateway.getThreadDetail.mock.calls).toEqual([[thread.id]])
    expect(gateway.subscribeCodexNotifications).toHaveBeenCalledTimes(2)
    // Forced reads still bypass the newly populated cache.
    gateway.getThreadDetail.mockResolvedValueOnce(oldDetail)
    await state.loadMessages(thread.id, { force: true })
    expect(state.messages.value).toEqual(oldDetail.messages)
    expect(gateway.getThreadDetail.mock.calls).toEqual([[thread.id], [thread.id]])
  })

  it('preserves normal transient failure throttling and retries after stop/restart', async () => {
    const state = createState()
    gateway.resumeThread.mockRejectedValueOnce(new Error('temporary history failure'))
    await expect(state.loadMessages(thread.id)).rejects.toThrow('temporary history failure')
    expect(state.isLoadingMessages.value).toBe(false)
    await state.loadMessages(thread.id)
    await state.ensureThreadMessagesLoaded(thread.id, { silent: true })
    expect(gateway.resumeThread).toHaveBeenCalledTimes(1)
    state.stopPolling()
    state.startPolling()
    await state.ensureThreadMessagesLoaded(thread.id)
    expect(state.messages.value).toEqual(oldDetail.messages)
    expect(state.isLoadingMessages.value).toBe(false)
    expect(gateway.resumeThread.mock.calls).toEqual([[thread.id], [thread.id]])
  })
})


describe('lifecycle generation ownership across restart', () => {
  const refreshOptions = { includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true }

  it.each(['success', 'failure'] as const)('keeps fresh history loading and coalescing intact after stale %s', async (outcome) => {
    const old = deferred<ResumedThread>()
    const fresh = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const state = createState()
    const previous = state.selectThread(thread.id)
    const forced = state.loadMessages(thread.id, { force: true })
    const forcedResult = forced.catch((error: Error) => error.message)
    state.stopPolling()
    state.startPolling()
    const current = state.ensureThreadMessagesLoaded(thread.id)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(2)
    expect(state.isLoadingMessages.value).toBe(true)
    if (outcome === 'success') old.resolve(oldDetail)
    else old.reject(new Error('obsolete history failure'))
    await previous
    await forcedResult
    expect(state.error.value).toBe('')
    expect(state.messages.value).toEqual([])
    expect(state.isLoadingMessages.value).toBe(true)
    const coalesced = state.ensureThreadMessagesLoaded(thread.id)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(2)
    fresh.resolve(completedDetail)
    await Promise.all([current, coalesced])
    expect(state.messages.value).toEqual(completedDetail.messages)
    expect(state.isLoadingMessages.value).toBe(false)
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
  })

  it('does not overwrite a completed new-lifecycle history reload with an older response', async () => {
    const old = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(old.promise).mockResolvedValueOnce(completedDetail)
    const state = createState()
    const previous = state.ensureThreadMessagesLoaded(thread.id)
    state.stopPolling()
    state.startPolling()
    await state.ensureThreadMessagesLoaded(thread.id)
    expect(state.messages.value).toEqual(completedDetail.messages)
    old.resolve(oldDetail)
    await previous
    expect(state.messages.value).toEqual(completedDetail.messages)
    await state.ensureThreadMessagesLoaded(thread.id)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure'] as const)('detaches old skills %s and quota promises without breaking new coalescing', async (outcome) => {
    const oldSkills = deferred<unknown[]>()
    const newSkills = deferred<unknown[]>()
    const oldQuota = deferred<unknown>()
    const newQuota = deferred<unknown>()
    gateway.getSkillsList.mockReturnValueOnce(oldSkills.promise).mockReturnValueOnce(newSkills.promise)
    gateway.getAccountRateLimits.mockReturnValueOnce(oldQuota.promise).mockReturnValueOnce(newQuota.promise)
    const state = createState()
    const old = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    state.stopPolling()
    state.startPolling()
    const current = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(2)
    expect(gateway.getAccountRateLimits).toHaveBeenCalledTimes(2)
    if (outcome === 'success') oldSkills.resolve([{ name: 'obsolete' }])
    else oldSkills.reject(new Error('obsolete skills failure'))
    oldQuota.resolve({ primary: { usedPercent: 99 } })
    await old
    expect(state.installedSkills.value).toEqual([])
    expect(state.accountRateLimitSnapshots.value).toEqual([])
    const coalesced = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(2)
    expect(gateway.getAccountRateLimits).toHaveBeenCalledTimes(2)
    const skills = [{ name: 'current', path: '/tmp/SKILL.md' }]
    const quota = { primary: { usedPercent: 20 } }
    newSkills.resolve(skills)
    newQuota.resolve(quota)
    await Promise.all([current, coalesced])
    expect(state.installedSkills.value).toEqual(skills)
    expect(state.accountRateLimitSnapshots.value).toEqual([quota])
  })

  it('preserves fresh skills, quota, and pending requests when old results arrive last', async () => {
    const skills = deferred<unknown[]>()
    const quota = deferred<unknown>()
    const pending = deferred<unknown[]>()
    gateway.getSkillsList.mockReturnValueOnce(skills.promise).mockResolvedValue([{ name: 'fresh' }])
    gateway.getAccountRateLimits.mockReturnValueOnce(quota.promise).mockResolvedValue({ primary: { usedPercent: 10 } })
    gateway.getPendingServerRequests.mockReturnValueOnce(pending.promise).mockResolvedValue([{ id: 8, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id } }])
    const state = createState()
    state.startPolling()
    const previousHandler = notificationHandler
    const old = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    state.stopPolling()
    state.startPolling()
    await state.refreshAll(refreshOptions)
    expect(state.selectedThreadServerRequests.value).toMatchObject([{ id: 8 }])
    skills.resolve([{ name: 'old' }])
    quota.resolve(null)
    pending.resolve([])
    await old
    await vi.advanceTimersByTimeAsync(0)
    expect(state.installedSkills.value).toEqual([{ name: 'fresh' }])
    expect(state.accountRateLimitSnapshots.value).toEqual([{ primary: { usedPercent: 10 } }])
    expect(state.selectedThreadServerRequests.value).toMatchObject([{ id: 8 }])
    previousHandler({ method: 'ready', params: {}, atIso: new Date().toISOString() })
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getPendingServerRequests).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure'] as const)('does not let a stale pending-request reply %s modify fresh requests or errors', async (outcome) => {
    const replyResult = deferred<void>()
    gateway.replyToServerRequest.mockReturnValueOnce(replyResult.promise)
    gateway.getPendingServerRequests.mockResolvedValue([{ id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id } }])
    const state = createState()
    state.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    const replying = state.respondToPendingServerRequest({ id: 7, result: {} })
    state.stopPolling()
    state.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    if (outcome === 'success') replyResult.resolve()
    else replyResult.reject(new Error('obsolete reply failure'))
    expect(await replying).toBe(outcome === 'success')
    expect(state.selectedThreadServerRequests.value).toMatchObject([{ id: 7 }])
    expect(state.error.value).toBe('')
    expect(gateway.replyToServerRequest).toHaveBeenCalledTimes(1)
  })

  it('does not run a scheduled ancillary refresh after stop', async () => {
    const state = createState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    state.stopPolling()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(gateway.getSkillsList).not.toHaveBeenCalled()
    expect(gateway.getAccountRateLimits).not.toHaveBeenCalled()
    expect(gateway.getCurrentModelConfig).not.toHaveBeenCalled()
  })

  it('does not schedule a submission follow-up after stop during its history synchronization', async () => {
    const state = await loadState()
    const detail = deferred<ResumedThread>()
    gateway.getThreadDetail.mockReturnValueOnce(detail.promise)
    const sending = state.sendMessageToSelectedThread('sync in flight')
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(1)
    state.stopPolling()
    detail.resolve(completedDetail)
    await sending
    await vi.advanceTimersByTimeAsync(10_000)
    expect(gateway.getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.messages.value).toEqual([])
  })

  it('still submits once after stop during resume without publishing UI state', async () => {
    const resumed = deferred<ResumedThread>()
    gateway.resumeThread.mockReturnValueOnce(resumed.promise)
    const state = createState()
    const sending = state.sendMessageToSelectedThread('preserve submission')
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.resumeThread).toHaveBeenCalledTimes(1)
    state.stopPolling()
    state.startPolling()
    resumed.resolve(oldDetail)
    await sending
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    expect(gateway.startThreadTurn.mock.calls[0]?.slice(0, 2)).toEqual([thread.id, 'preserve submission'])
    expect(state.messages.value).toEqual([])
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
  })

  it('still submits a newly created thread after stop without selecting it or publishing UI state', async () => {
    const created = deferred<{ threadId: string; model: string; modelProvider: string }>()
    gateway.startThread.mockReturnValueOnce(created.promise)
    const state = createState()
    const sending = state.sendMessageToNewThread('new submission', '/tmp/project')
    expect(state.isSendingMessage.value).toBe(true)
    state.stopPolling()
    state.startPolling()
    created.resolve({ threadId: 'new-thread', model: 'gpt-5.5', modelProvider: 'openai' })
    expect(await sending).toBe('new-thread')
    expect(state.selectedThreadId.value).toBe(thread.id)
    expect(state.isSendingMessage.value).toBe(false)
    expect(state.messages.value).toEqual([])
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
    expect(gateway.startThreadTurn.mock.calls[0]?.slice(0, 2)).toEqual(['new-thread', 'new submission'])
    expect(gateway.resumeThread).not.toHaveBeenCalled()
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)('does not let an old new-thread submission %s clear a fresh send indicator', async (outcome) => {
    const oldTurn = deferred<string>()
    const freshTurn = deferred<string>()
    gateway.startThreadTurn.mockReturnValueOnce(oldTurn.promise).mockReturnValueOnce(freshTurn.promise)
    const state = createState()
    await state.sendMessageToNewThread('old send', '/tmp/project')
    state.stopPolling()
    state.startPolling()
    gateway.startThread.mockResolvedValueOnce({ threadId: 'fresh-thread', model: 'gpt-5.5' })
    await state.sendMessageToNewThread('fresh send', '/tmp/project')
    expect(state.isSendingMessage.value).toBe(true)
    const freshMessages = [...state.messages.value]
    if (outcome === 'success') oldTurn.resolve('old-turn')
    else oldTurn.reject(new Error('obsolete submission error'))
    await vi.advanceTimersByTimeAsync(0)
    expect(state.isSendingMessage.value).toBe(true)
    expect(state.error.value).toBe('')
    expect(state.messages.value).toEqual(freshMessages)
    expect(gateway.getThreadDetail).not.toHaveBeenCalled()
    freshTurn.reject(new Error('current submission error'))
    await vi.advanceTimersByTimeAsync(0)
    expect(state.isSendingMessage.value).toBe(false)
    expect(state.error.value).toBe('current submission error')
    expect(gateway.startThreadTurn).toHaveBeenCalledTimes(2)
  })

  it('keeps the fresh catalog and banner when an old lifecycle model refresh fails', async () => {
    const config = deferred<unknown>()
    gateway.getCurrentModelConfig.mockReturnValueOnce(config.promise)
    const state = createState()
    const old = state.refreshAll(refreshOptions)
    await vi.advanceTimersByTimeAsync(0)
    state.stopPolling()
    state.startPolling()
    const catalog = [{ id: 'gpt-5.5', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }]
    gateway.getAvailableModelIds.mockResolvedValue({ ids: ['gpt-5.5'], models: catalog })
    await state.refreshAll(refreshOptions)
    config.reject(new Error('Codex CLI is not available'))
    await old
    expect(reasoningCatalog.value).toEqual(catalog)
    expect(state.codexCliMissingError.value).toBe('')
  })

  it('starts a fresh refresh without waiting for a stopped thread-list request', async () => {
    const page = deferred<unknown>()
    gateway.getThreadGroupsPage.mockReturnValueOnce(page.promise)
    const state = createState()
    const old = state.refreshAll(refreshOptions)
    state.stopPolling()
    state.startPolling()
    await state.refreshAll(refreshOptions)
    expect(gateway.getThreadGroupsPage).toHaveBeenCalledTimes(2)
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(1)
    expect(state.isLoadingThreads.value).toBe(false)
    page.resolve({ groups: [], nextCursor: null })
    await old
    expect(gateway.getSkillsList).toHaveBeenCalledTimes(1)
    expect(state.projectGroups.value.flatMap((group) => group.threads).map((row) => row.id)).toContain(thread.id)
  })

  it.each(['success', 'failure'] as const)('ignores obsolete older-history %s during a new pagination request', async (outcome) => {
    gateway.getWorkspaceRootsState.mockResolvedValue({ order: [], labels: {}, active: [], projectOrder: [] })
    gateway.resumeThread.mockResolvedValueOnce({ ...oldDetail, hasMoreOlder: true })
    const state = await loadState()
    const oldPage = deferred<unknown>()
    const freshPage = deferred<unknown>()
    gateway.getOlderThreadMessages.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(freshPage.promise)
    const old = state.loadOlderMessages().catch((error: Error) => error.message)
    state.stopPolling()
    state.startPolling()
    gateway.getThreadDetail.mockResolvedValueOnce({ ...completedDetail, hasMoreOlder: true })
    await state.ensureThreadMessagesLoaded(thread.id)
    const fresh = state.loadOlderMessages()
    expect(state.isLoadingOlderMessages.value).toBe(true)
    expect(state.isLoadingMessages.value).toBe(false)
    if (outcome === 'success') oldPage.resolve({ messages: [oldUser], hasMoreOlder: false, turnIndexByTurnId: {} })
    else oldPage.reject(new Error('old pagination failure'))
    await old
    expect(state.isLoadingOlderMessages.value).toBe(true)
    expect(state.isLoadingMessages.value).toBe(false)
    expect(state.hasMoreOlderMessages.value).toBe(true)
    expect(state.error.value).toBe('')
    freshPage.resolve({ messages: [], hasMoreOlder: false, turnIndexByTurnId: {} })
    await fresh
    expect(state.isLoadingOlderMessages.value).toBe(false)
    expect(state.hasMoreOlderMessages.value).toBe(false)
    expect(state.messages.value).toEqual(completedDetail.messages)
    expect(gateway.getOlderThreadMessages).toHaveBeenCalledTimes(2)
  })
})

// These tests intentionally preserve current ownership and snapshot behavior.
describe('shared catalog ownership and deferred submission characterization', () => {
  const options = { includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true }
  const a = [{ id: 'A', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]
  const b = [{ id: 'B', supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' }]
  const result = (models: typeof a) => ({ ids: models.map((model) => model.id), models })

  it('preserves another active consumer capabilities on stop and repeated stop', async () => {
    gateway.getAvailableModelIds.mockResolvedValue(result(a))
    const first = createState()
    const second = createState()
    await first.refreshAll(options)
    await second.refreshAll(options)
    second.setSelectedModelIdForThread(thread.id, 'A')
    expect(second.readReasoningEffortForThread(thread.id)).toBe('low')
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(2)
    first.stopPolling()
    first.stopPolling()
    expect(reasoningCatalog.value).toEqual(a)
    expect(second.readModelIdForThread(thread.id)).toBe('A')
    expect(second.readReasoningOptionsForThread(thread.id).map((option) => option.value)).toEqual(['low', 'high'])
    await second.refreshAll(options)
    expect(second.readReasoningEffortForThread(thread.id)).toBe('low')
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(3)
  })

  it.each([false, true])('reverse catalog success order across independent instances=%s', async (independent) => {
    const old = deferred<ReturnType<typeof result>>()
    const fresh = deferred<ReturnType<typeof result>>()
    gateway.getAvailableModelIds.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const first = createState()
    const second = independent ? createState() : first
    const older = first.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    const newer = second.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(2)
    fresh.resolve(result(b))
    await newer
    expect(reasoningCatalog.value).toEqual(b)
    old.resolve(result(a))
    await older
    // Refresh initiation orders successful publication across instances as well.
    expect(reasoningCatalog.value).toEqual(b)
    expect(second.availableModelIds.value).toContain('B')
    second.setSelectedModelIdForThread(thread.id, 'B')
    expect(second.readReasoningEffortForThread(thread.id)).toBe('medium')
  })

  it.each(['success', 'failure'] as const)('keeps B authoritative across A stop/restart and late %s', async (outcome) => {
    const originalRef = reasoningCatalog
    const old = deferred<ReturnType<typeof result>>()
    gateway.getAvailableModelIds.mockReturnValueOnce(old.promise).mockResolvedValue(result(b))
    const first = createState()
    const second = createState()
    const older = first.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    await second.refreshAll(options)
    if (outcome === 'failure') {
      old.reject(new Error('obsolete failure'))
      await older
      expect(reasoningCatalog.value).toEqual(b)
    }
    first.stopPolling()
    expect(reasoningCatalog.value).toEqual(b)
    first.startPolling()
    gateway.getAvailableModelIds.mockResolvedValue(result(a))
    await first.refreshAll(options)
    second.stopPolling()
    if (outcome === 'success') {
      old.resolve(result(b))
      await older
    }
    expect(reasoningCatalog).toBe(originalRef)
    expect(reasoningCatalog.value).toEqual(a)
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(3)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(3)
  })

  it('publishes earlier success while newer work is pending, then accepts newer success', async () => {
    const old = deferred<ReturnType<typeof result>>()
    const fresh = deferred<ReturnType<typeof result>>()
    gateway.getAvailableModelIds.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const first = createState()
    const second = createState()
    const older = first.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    const newer = second.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    old.resolve(result(a))
    await older
    expect(reasoningCatalog.value).toEqual(a)
    fresh.resolve(result(b))
    await newer
    expect(reasoningCatalog.value).toEqual(b)
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(2)
  })

  it.each(['config', 'catalog'] as const)('another instance %s failure preserves a valid shared catalog and can recover', async (stage) => {
    gateway.getAvailableModelIds.mockResolvedValue(result(a))
    const first = createState()
    const second = createState()
    await first.refreshAll(options)
    await second.refreshAll(options)
    second.setSelectedModelIdForThread(thread.id, 'A')
    const failure = deferred<unknown>()
    if (stage === 'config') gateway.getCurrentModelConfig.mockReturnValueOnce(failure.promise)
    else gateway.getAvailableModelIds.mockReturnValueOnce(failure.promise)
    const refreshing = first.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(reasoningCatalog.value).toEqual(a)
    failure.reject(new Error('temporary failure'))
    await refreshing
    expect(reasoningCatalog.value).toEqual(a)
    expect(second.readReasoningEffortForThread(thread.id)).toBe('low')
    await first.refreshAll(options)
    expect(second.readReasoningEffortForThread(thread.id)).toBe('low')
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(4)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(stage === 'config' ? 3 : 4)
  })

  it.each(['config', 'catalog'] as const)('ignores old lifecycle %s failure after restart and releases the new lease once', async (stage) => {
    const originalRef = reasoningCatalog
    const failure = deferred<unknown>()
    gateway.getAvailableModelIds.mockResolvedValue(result(a))
    const state = createState()
    await state.refreshAll(options)
    if (stage === 'config') gateway.getCurrentModelConfig.mockReturnValueOnce(failure.promise)
    else gateway.getAvailableModelIds.mockReturnValueOnce(failure.promise)
    const older = state.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    state.stopPolling()
    expect(reasoningCatalog.value).toEqual([])
    state.startPolling()
    await state.refreshAll(options)
    failure.reject(new Error('Codex CLI is not available'))
    await older
    expect(reasoningCatalog).toBe(originalRef)
    expect(reasoningCatalog.value).toEqual(a)
    expect(state.codexCliMissingError.value).toBe('')
    state.stopPolling()
    state.stopPolling()
    expect(reasoningCatalog.value).toEqual([])
  })

  it('does duplicate catalog work for a superseded config read but suppresses its publication', async () => {
    const config = deferred<unknown>()
    gateway.getCurrentModelConfig.mockReturnValueOnce(config.promise)
    gateway.getAvailableModelIds.mockResolvedValueOnce(result(b)).mockResolvedValueOnce(result(a))
    const state = createState()
    const older = state.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    await state.refreshAll(options)
    expect(reasoningCatalog.value).toEqual(b)
    config.resolve({ model: 'A', speedMode: 'standard' })
    await older
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(2)
    expect(reasoningCatalog.value).toEqual(b)
  })

  it('invalidates an old catalog success across stop/restart without suppressing fresh refresh work', async () => {
    const old = deferred<ReturnType<typeof result>>()
    gateway.getAvailableModelIds.mockReturnValueOnce(old.promise).mockResolvedValue(result(b))
    const state = createState()
    const older = state.refreshAll(options)
    await vi.advanceTimersByTimeAsync(0)
    state.stopPolling()
    state.startPolling()
    await state.refreshAll(options)
    expect(reasoningCatalog.value).toEqual(b)
    old.resolve(result(a))
    await older
    expect(reasoningCatalog.value).toEqual(b)
    expect(gateway.getCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(gateway.getAvailableModelIds).toHaveBeenCalledTimes(2)
  })

  it.each(['unchanged', 'selection', 'selection-no-resume-model', 'resume-B', 'replace', 'clear', 'unknown', 'dispose'] as const)(
    'submits exact RPC model/effort once after deferred resume: %s', async (change) => {
      const actual = await vi.importActual<typeof import('../api/codexGateway')>('../api/codexGateway')
      gateway.startThreadTurn.mockImplementation(actual.startThreadTurn)
      const resumed = deferred<ResumedThread>()
      const submitted = deferred<Response>()
      const requests: Array<{ method: string; params: Record<string, unknown> }> = []
      vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string))
        return submitted.promise
      }))
      gateway.resumeThread.mockReturnValueOnce(resumed.promise)
      reasoningCatalog.value = [...a, ...b]
      const state = createState()
      state.setSelectedModelIdForThread(thread.id, 'A')
      state.setSelectedReasoningEffort('high', thread.id)
      expect(state.readReasoningEffortForThread(thread.id)).toBe('high')
      const sending = state.sendMessageToSelectedThread('race marker')
      await vi.advanceTimersByTimeAsync(0)
      expect(requests).toEqual([])
      expect(gateway.resumeThread).toHaveBeenCalledTimes(1)
      if (change === 'selection' || change === 'selection-no-resume-model') {
        state.setSelectedModelIdForThread(thread.id, 'B')
        state.setSelectedReasoningEffort('medium', thread.id)
      }
      if (change === 'replace') reasoningCatalog.value = [{ ...a[0]!, supportedReasoningEfforts: ['low'] }]
      if (change === 'clear') reasoningCatalog.value = []
      if (change === 'unknown') state.setSelectedModelIdForThread(thread.id, 'unknown')
      if (change === 'dispose') state.stopPolling()
      resumed.resolve({ ...oldDetail, model: change === 'selection-no-resume-model' || change === 'unknown' ? '' : change === 'resume-B' ? 'B' : 'A' })
      await vi.advanceTimersByTimeAsync(0)
      const model = change === 'selection-no-resume-model' || change === 'resume-B' ? 'B' : change === 'unknown' ? 'unknown' : 'A'
      const effort = change === 'selection-no-resume-model' || change === 'resume-B' ? 'medium' : change === 'replace' ? 'low'
        : ['clear', 'unknown', 'dispose'].includes(change) ? undefined : 'high'
      // Effort is captured before resume. A nonempty resume model overwrites a pending selection change.
      expect(gateway.startThreadTurn.mock.calls[0]?.slice(3, 5)).toEqual([model, 'high'])
      expect(requests).toEqual([{
        method: 'turn/start', params: {
          threadId: thread.id, input: [{ type: 'text', text: 'race marker' }], model,
          ...(effort ? { effort } : {}),
          collaborationMode: { mode: 'default', settings: { model, reasoning_effort: effort ?? null, developer_instructions: null } },
        },
      }])
      // Once serialized, even clearing the catalog cannot mutate the in-flight payload.
      reasoningCatalog.value = []
      submitted.resolve(new Response(JSON.stringify({ result: { turn: { id: 'race-turn' } } })))
      await sending
      expect(requests).toHaveLength(1)
      expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
      if (change === 'dispose') expect(state.messages.value).toEqual([])
    },
  )
})

// Characterization only: these expectations describe current submission semantics,
// including the selected-thread effort leak and active empty-model fallback reread.
describe('new-thread preference context across deferred creation', () => {
  const cases = ['', 'B', 'C'].flatMap((creationModel) =>
    [false, true].flatMap((changeDefault) =>
      [false, true].flatMap((changeSelection) =>
        [false, true].map((dispose) => ({ creationModel, changeDefault, changeSelection, dispose })),
      ),
    ),
  )

  it.each(cases)('serializes once for %j', async ({ creationModel, changeDefault, changeSelection, dispose }) => {
    const actual = await vi.importActual<typeof import('../api/codexGateway')>('../api/codexGateway')
    gateway.startThreadTurn.mockImplementation(actual.startThreadTurn)
    // Another live desktop keeps capabilities available when this desktop disposes.
    const owner = actual.acquireReasoningCatalog()
    const catalog = ['A', 'B', 'C'].map((id) => ({
      id, supportedReasoningEfforts: ['medium', 'high'], defaultReasoningEffort: 'medium',
    }))
    owner.publish(catalog)
    try {
      const created = deferred<{ threadId: string; model: string; modelProvider: string }>()
      const submitted = deferred<Response>()
      gateway.startThread.mockReturnValueOnce(created.promise)
      const requests: Array<{ method: string; params: Record<string, unknown> }> = []
      vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
        const request = JSON.parse(init.body as string)
        requests.push(request)
        if (request.method === 'config/read') return Promise.resolve(new Response(JSON.stringify({ result: { config: { model: 'A' } } })))
        return submitted.promise
      }))
      const state = createState()
      state.setSelectedModelIdForThread(thread.id, 'A')
      state.setSelectedReasoningEffort('high', thread.id)
      state.setSelectedModelIdForThread('__new-thread__', 'B')
      state.setSelectedReasoningEffort('medium', '__new-thread__')
      const effortKey = 'codex-web-local.reasoning-by-provider-model.v1'
      const savedEfforts = window.localStorage.getItem(effortKey)
      expect(state.readModelIdForThread('__new-thread__')).toBe('B')
      expect(state.readReasoningEffortForThread('__new-thread__')).toBe('medium')
      expect(state.selectedReasoningEffort.value).toBe('high')
      const sending = state.sendMessageToNewThread('new context marker', '/tmp/project')
      expect(gateway.startThread.mock.calls).toEqual([['/tmp/project', 'B']])
      expect(gateway.startThreadTurn).not.toHaveBeenCalled()
      expect(requests).toEqual([])
      expect(state.isSendingMessage.value).toBe(true)
      if (changeDefault) state.setSelectedModelIdForThread('__new-thread__', 'C')
      if (changeSelection) state.primeSelectedThread('other-thread')
      if (dispose) state.stopPolling()
      const beforeCompletionSelection = state.selectedThreadId.value
      const savedModels = JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1')!)
      // Empty creation responses retain B in submissionContext, but the active
      // startTurnForThread path rereads an empty thread preference instead.
      const gatewayModel = creationModel || (dispose ? 'B' : undefined)
      const model = gatewayModel || 'A'
      const result = { threadId: 'new-context-thread', model: creationModel, modelProvider: 'openai' }
      created.resolve(result)
      expect(await sending).toBe(result.threadId)
      await vi.advanceTimersByTimeAsync(0)
      expect(gateway.startThreadTurn.mock.calls).toEqual([
        [result.threadId, 'new context marker', [], gatewayModel, 'high', undefined, [], 'default'],
      ])
      expect(requests).toEqual([
        ...(!creationModel && !dispose ? [{ method: 'config/read', params: {} }] : []),
        {
          method: 'turn/start', params: {
            threadId: result.threadId, input: [{ type: 'text', text: 'new context marker' }], model, effort: 'high',
            collaborationMode: { mode: 'default', settings: { model, reasoning_effort: 'high', developer_instructions: null } },
          },
        },
      ])
      expect(gateway.resumeThread).not.toHaveBeenCalled()
      expect(window.localStorage.getItem(effortKey)).toBe(savedEfforts)
      expect(state.readReasoningEffortForThread(thread.id)).toBe('high')
      expect(state.readReasoningEffortForThread('__new-thread__')).toBe('medium')
      const finalModels = JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1')!)
      for (const [key, value] of Object.entries(savedModels)) expect(finalModels[key]).toBe(value)
      if (dispose) {
        expect(finalModels).toEqual(savedModels)
        expect(state.selectedThreadId.value).toBe(beforeCompletionSelection)
        expect(state.messages.value).toEqual([])
      } else expect(state.selectedThreadId.value).toBe(result.threadId)
      submitted.resolve(new Response(JSON.stringify({ result: { turn: { id: 'new-context-turn' } } })))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(gateway.startThreadTurn).toHaveBeenCalledTimes(1)
      expect(requests.filter((request) => request.method === 'turn/start')).toHaveLength(1)
      if (dispose) {
        expect(state.messages.value).toEqual([])
        expect(state.selectedThreadId.value).toBe(beforeCompletionSelection)
        expect(state.error.value).toBe('')
        expect(gateway.getThreadDetail).not.toHaveBeenCalled()
      }
    } finally {
      owner.release()
    }
  })
})
