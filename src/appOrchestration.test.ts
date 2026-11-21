import { computed, reactive, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAppTransferDialog } from './appTransferDialog'
import { createAppRouteCoordinator } from './appRouteCoordinator'
import { prepareConversationTransfer, cancelConversationTransfer, reasoningCatalog } from './api/codexGateway'
import { modelSelectionKey } from './api/modelCapabilities'

vi.mock('./api/codexGateway', async () => ({
  reasoningCatalog: (await import('vue')).ref([{ id: 'model', model: 'model', modelProvider: 'P', isDefault: true }]),
  prepareConversationTransfer: vi.fn(), cancelConversationTransfer: vi.fn(async () => {}),
}))
afterEach(() => vi.clearAllMocks())
beforeEach(() => {
  reasoningCatalog.value = [{ id: 'model', model: 'model', modelProvider: 'P', isDefault: true }]
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function transfer(composerModel = modelSelectionKey('P', 'model')) {
  const composerSelection = ref(composerModel)
  const forkThreadById = vi.fn(async () => 'destination')
  const push = vi.fn(async () => {})
  const controller = createAppTransferDialog({
    messages: computed(() => []), selectedThreadId: ref('source'), desktopError: ref(''),
    composerSelectedModelId: computed(() => composerSelection.value),
    forkThreadById, forkNativeThreadById: vi.fn(async () => 'native'),
    router: { push }, isMobile: ref(false), setSidebarCollapsed: vi.fn(),
  })
  return { controller, composerSelection, forkThreadById, push }
}
it.each([
  { providers: ['A'], composer: 'A', source: 'A', expected: 'A' },
  { providers: ['A', 'B', 'C'], composer: 'A', source: 'A', expected: 'A' },
  { providers: ['A', 'B', 'C'], composer: 'B', source: 'B', expected: 'B' },
  { providers: ['C', 'A', 'B'], composer: 'A', source: 'A', expected: 'A' },
  { providers: ['A', 'B'], composer: 'B', source: 'A', expected: 'B' },
  { providers: ['A', 'B'], composer: 'A', source: 'B', expected: 'A' },
  { providers: ['A', 'A', 'B'], composer: 'A', source: 'A', expected: 'A' },
  { providers: ['B', 'C'], composer: 'A', source: 'A', expected: 'B' },
  { providers: ['B', 'A'], composer: '', source: undefined, expected: 'B' },
  { providers: [], composer: 'A', source: 'A', expected: '' },
])('preselects $expected for composer $composer and source $source in provider order $providers (CAP-002)', async ({ providers, composer, source, expected }) => {
  reasoningCatalog.value = providers.map(modelProvider => ({ id: 'model', modelProvider, isDefault: true }))
  vi.mocked(prepareConversationTransfer).mockResolvedValueOnce({ id: 'snapshot', messageCount: 1, sourceModelProvider: source })
  const { controller, composerSelection, forkThreadById, push } = transfer(modelSelectionKey(composer, 'model'))
  await controller.openTransferPicker('unselected-source')
  expect(controller.transferProvider.value).toBe(expected)
  expect(controller.transferProviderOptions.value.map(option => option.value)).toEqual([...new Set(providers)])
  expect(controller.canConfirmFork.value).toBe(!!expected)
  expect(composerSelection.value).toBe(modelSelectionKey(composer, 'model'))
  expect(forkThreadById).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
  await controller.confirmTransferPicker()
  if (expected) expect(forkThreadById).toHaveBeenCalledExactlyOnceWith('unselected-source', 'snapshot', modelSelectionKey(expected, 'model'))
  else expect(forkThreadById).not.toHaveBeenCalled()
})
it('preserves manual provider choices without changing the composer on cancellation and reads it again on reopening (CAP-002)', async () => {
  reasoningCatalog.value = ['A', 'B', 'C'].map(modelProvider => ({ id: 'model', modelProvider, isDefault: true }))
  vi.mocked(prepareConversationTransfer).mockResolvedValue({ id: 'snapshot', messageCount: 1, sourceModelProvider: 'A' })
  const { controller, composerSelection } = transfer(modelSelectionKey('A', 'model'))
  await controller.openTransferPicker('source')
  expect(controller.transferProvider.value).toBe('A')
  controller.transferProvider.value = 'C'
  reasoningCatalog.value = [...reasoningCatalog.value, { id: 'other', modelProvider: 'C' }]
  expect(controller.transferProvider.value).toBe('C')
  await controller.cancelTransferPicker()
  expect(composerSelection.value).toBe(modelSelectionKey('A', 'model'))
  expect(cancelConversationTransfer).toHaveBeenCalledExactlyOnceWith('snapshot')
  composerSelection.value = modelSelectionKey('B', 'model')
  await controller.openTransferPicker('source', { turnId: 'turn-0' })
  expect(controller.transferProvider.value).toBe('B')
})
it('captures the composer provider when opening, before history preparation finishes (CAP-002)', async () => {
  reasoningCatalog.value = ['A', 'B'].map(modelProvider => ({ id: 'model', modelProvider, isDefault: true }))
  const pending = deferred<Awaited<ReturnType<typeof prepareConversationTransfer>>>()
  vi.mocked(prepareConversationTransfer).mockReturnValueOnce(pending.promise)
  const { controller, composerSelection } = transfer(modelSelectionKey('B', 'model'))
  const opening = controller.openTransferPicker('source')
  composerSelection.value = modelSelectionKey('A', 'model')
  pending.resolve({ id: 'snapshot', messageCount: 1, sourceModelProvider: 'B' })
  await opening
  expect(controller.transferProvider.value).toBe('B')
  expect(composerSelection.value).toBe(modelSelectionKey('A', 'model'))
})
it.each([
  { providerDefaultModel: 'configured', isDefault: true, expected: 'configured' },
  { providerDefaultModel: undefined, isDefault: true, expected: 'declared' },
  { providerDefaultModel: undefined, isDefault: false, expected: 'priority' },
])('keeps provider default resolution ($expected) after initial and manual selection (CAP-002)', async ({ providerDefaultModel, isDefault, expected }) => {
  reasoningCatalog.value = ['A', 'B'].flatMap(modelProvider => [
    { id: 'composer-model', modelProvider, priority: 9, providerDefaultModel: providerDefaultModel && `${modelProvider}-${providerDefaultModel}` },
    { id: `${modelProvider}-declared`, modelProvider, priority: 2, isDefault },
    { id: `${modelProvider}-priority`, modelProvider, priority: 0 },
  ])
  vi.mocked(prepareConversationTransfer).mockResolvedValue({ id: 'snapshot', messageCount: 1, sourceModelProvider: 'A' })
  const { controller, composerSelection, forkThreadById } = transfer(modelSelectionKey('B', 'composer-model'))
  await controller.openTransferPicker('source')
  expect(controller.transferProvider.value).toBe('B')
  await controller.confirmTransferPicker()
  expect(forkThreadById).toHaveBeenLastCalledWith('source', 'snapshot', modelSelectionKey('B', `B-${expected}`))
  await controller.openTransferPicker('source')
  controller.transferProvider.value = 'A'
  await controller.confirmTransferPicker()
  expect(forkThreadById).toHaveBeenLastCalledWith('source', 'snapshot', modelSelectionKey('A', `A-${expected}`))
  expect(composerSelection.value).toBe(modelSelectionKey('B', 'composer-model'))
})
it('cancels a preparation that finishes after its dialog was dismissed without creating a destination', async () => {
  const pending = deferred<Awaited<ReturnType<typeof prepareConversationTransfer>>>()
  vi.mocked(prepareConversationTransfer).mockReturnValueOnce(pending.promise)
  const { controller, forkThreadById, push } = transfer()
  const opening = controller.openTransferPicker('source')
  await controller.cancelTransferPicker()
  pending.resolve({ id: 'snapshot', messageCount: 1 })
  await opening
  expect(cancelConversationTransfer).toHaveBeenCalledExactlyOnceWith('snapshot')
  expect(controller.transferPicker.value).toBeNull()
  expect(controller.transferProvider.value).toBe('')
  expect(forkThreadById).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
})
it('keeps one pending confirmation and navigates only after the import is confirmed', async () => {
  vi.mocked(prepareConversationTransfer).mockResolvedValueOnce({ id: 'snapshot', messageCount: 1 })
  const { controller, forkThreadById, push } = transfer()
  const pending = deferred<string>()
  forkThreadById.mockReturnValueOnce(pending.promise)
  await controller.openTransferPicker('source')
  controller.transferProvider.value = 'P'
  const confirming = controller.confirmTransferPicker()
  await controller.confirmTransferPicker()
  await controller.cancelTransferPicker()
  expect(controller.transferPicker.value?.pending).toBe(true)
  expect(forkThreadById).toHaveBeenCalledTimes(1)
  expect(push).not.toHaveBeenCalled()
  pending.resolve('destination')
  await confirming
  expect(controller.transferPicker.value).toBeNull()
  expect(push).toHaveBeenCalledExactlyOnceWith({ name: 'thread', params: { threadId: 'destination' } })
})
it('does not let a cancelled preparation replace a newer dialog provider (CAP-002)', async () => {
  reasoningCatalog.value = ['A', 'B'].map(modelProvider => ({ id: 'model', modelProvider, isDefault: true }))
  const pending = deferred<Awaited<ReturnType<typeof prepareConversationTransfer>>>()
  vi.mocked(prepareConversationTransfer).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ id: 'new-snapshot', messageCount: 1, sourceModelProvider: 'B' })
  const { controller, composerSelection } = transfer(modelSelectionKey('A', 'model'))
  const opening = controller.openTransferPicker('old-source')
  await controller.cancelTransferPicker()
  composerSelection.value = modelSelectionKey('B', 'model')
  await controller.openTransferPicker('new-source')
  expect(controller.transferProvider.value).toBe('B')
  pending.resolve({ id: 'old-snapshot', messageCount: 1, sourceModelProvider: 'A' })
  await opening
  expect(controller.transferPicker.value?.sourceId).toBe('new-source')
  expect(controller.transferProvider.value).toBe('B')
  expect(cancelConversationTransfer).toHaveBeenCalledExactlyOnceWith('old-snapshot')
})
function routing(projectId = 'native-project') {
  const route = shallowRef({ name: 'thread', fullPath: '/thread/A' })
  const target = ref('A'), selected = ref('')
  const selectThread = vi.fn(async (id: string) => { selected.value = id; return 'ok' as const })
  const send = vi.fn(async () => 'new-thread'), replace = vi.fn(async () => {})
  const controller = createAppRouteCoordinator({ routeThreadId: computed(() => target.value),
    selectedThreadId: selected, selectThread, ensureThreadMessagesLoaded: vi.fn(async () => {}),
    newThreadCwd: ref('/fixture'), desktopError: ref(''), sendMessageToNewThread: send,
    newThreadProjectId: computed(() => projectId), router: { replace, currentRoute: route }, scheduleMobileConversationJumpToLatest: vi.fn(),
  })
  return { controller, route, target, selected, selectThread, send, replace }
}
it('serializes route selection and applies the latest route after a pending selection finishes', async () => {
  const f = routing(), pending = deferred<'ok'>()
  f.selectThread.mockImplementationOnce(async id => { await pending.promise; f.selected.value = id; return 'ok' })
  const selecting = f.controller.syncThreadSelectionWithRoute()
  f.target.value = 'B'
  await f.controller.syncThreadSelectionWithRoute()
  expect(f.selectThread).toHaveBeenCalledTimes(1)
  pending.resolve('ok')
  await selecting
  expect(f.selectThread.mock.calls.map(([id]) => id)).toEqual(['A', 'B'])
  expect(f.selected.value).toBe('B')
  expect(f.controller.isRouteSyncInProgress.value).toBe(false)
})
it('does not navigate or replay a failed first submission', async () => {
  const f = routing()
  const accepted = vi.fn()
  f.send.mockRejectedValueOnce(new Error('Outcome unknown'))
  expect(await f.controller.submitFirstMessageForNewThread('prompt', [], [], [], accepted)).toBe(false)
  expect(accepted).not.toHaveBeenCalled()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.replace).not.toHaveBeenCalled()
})
it.each(['stay', 'leave', 'return'])('settles before navigation when the original Home visit is current (%s)', async navigation => {
  const f = routing()
  const home = { name: 'home', fullPath: '/?cwd=/fixture' }
  f.route.value = home
  const pending = deferred<string>()
  const accepted = vi.fn(() => { expect(f.replace).not.toHaveBeenCalled() })
  f.send.mockReturnValueOnce(pending.promise)
  const submission = f.controller.submitFirstMessageForNewThread('prompt', [], [], [], accepted)
  expect(accepted).not.toHaveBeenCalled()
  expect(f.replace).not.toHaveBeenCalled()
  if (navigation !== 'stay') f.route.value = { name: 'thread', fullPath: '/thread/B' }
  if (navigation === 'return') f.route.value = { ...home }
  pending.resolve('new-thread')
  await expect(submission).resolves.toBe(true)
  expect(accepted).toHaveBeenCalledOnce()
  expect(f.replace).toHaveBeenCalledTimes(Number(navigation === 'stay'))
})
it.each([
  { projectId: '', expected: undefined },
  { projectId: 'native-project', expected: 'native-project' },
])('passes the working directory and only an explicit Project ID on first submission ($projectId)', async ({ projectId, expected }) => {
  const f = routing(projectId)
  expect(await f.controller.submitFirstMessageForNewThread('prompt')).toBe(true)
  expect(f.send).toHaveBeenCalledExactlyOnceWith('prompt', '/fixture', [], [], [], expected)
})
