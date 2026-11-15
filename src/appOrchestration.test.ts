import { computed, reactive, ref } from 'vue'
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
function transfer() {
  const forkThreadById = vi.fn(async () => 'destination')
  const push = vi.fn(async () => {})
  const controller = createAppTransferDialog({
    messages: computed(() => []), selectedThreadId: ref('source'), desktopError: ref(''),
    forkThreadById, forkThreadFromTurn: vi.fn(async () => 'destination'), forkNativeThreadById: vi.fn(async () => 'native'),
    router: { push }, isMobile: ref(false), setSidebarCollapsed: vi.fn(),
  })
  return { controller, forkThreadById, push }
}
it.each([
  { providers: ['A'], current: 'A', expected: 'A' },
  { providers: ['A', 'B', 'C'], current: 'A', expected: 'B' },
  { providers: ['C', 'A', 'B'], current: 'A', expected: 'C' },
  { providers: ['B', 'C'], current: 'A', expected: 'B' },
  { providers: ['A', 'A', 'B'], current: 'A', expected: 'B' },
  { providers: ['B', 'A'], current: undefined, expected: 'B' },
  { providers: [], current: 'A', expected: '' },
])('preselects $expected for source $current in provider order $providers (CAP-002)', async ({ providers, current, expected }) => {
  reasoningCatalog.value = providers.map(modelProvider => ({ id: 'model', modelProvider, isDefault: true }))
  vi.mocked(prepareConversationTransfer).mockResolvedValueOnce({ id: 'snapshot', messageCount: 1, warnings: [], sourceModelProvider: current })
  const { controller, forkThreadById, push } = transfer()
  await controller.openTransferPicker('unselected-source')
  expect(controller.transferProvider.value).toBe(expected)
  expect(controller.transferProviderOptions.value.map(option => option.value)).toEqual([...new Set(providers)])
  expect(controller.canConfirmFork.value).toBe(!!expected)
  expect(forkThreadById).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
  await controller.confirmTransferPicker()
  if (expected) expect(forkThreadById).toHaveBeenCalledExactlyOnceWith('unselected-source', 'snapshot', modelSelectionKey(expected, 'model'))
  else expect(forkThreadById).not.toHaveBeenCalled()
})
it('preserves manual provider choices and recomputes the default on reopening (CAP-002)', async () => {
  reasoningCatalog.value = ['A', 'B', 'C'].map(modelProvider => ({ id: 'model', modelProvider, isDefault: true }))
  vi.mocked(prepareConversationTransfer).mockResolvedValue({ id: 'snapshot', messageCount: 1, warnings: [], sourceModelProvider: 'A' })
  const { controller } = transfer()
  await controller.openTransferPicker('source')
  expect(controller.transferProvider.value).toBe('B')
  controller.transferProvider.value = 'A'
  reasoningCatalog.value = [...reasoningCatalog.value, { id: 'other', modelProvider: 'C' }]
  expect(controller.transferProvider.value).toBe('A')
  await controller.cancelTransferPicker()
  await controller.openTransferPicker('source', 0)
  expect(controller.transferProvider.value).toBe('B')
})
it('cancels a preparation that finishes after its dialog was dismissed without creating a destination', async () => {
  const pending = deferred<Awaited<ReturnType<typeof prepareConversationTransfer>>>()
  vi.mocked(prepareConversationTransfer).mockReturnValueOnce(pending.promise)
  const { controller, forkThreadById, push } = transfer()
  const opening = controller.openTransferPicker('source')
  await controller.cancelTransferPicker()
  pending.resolve({ id: 'snapshot', messageCount: 1, warnings: [] })
  await opening
  expect(cancelConversationTransfer).toHaveBeenCalledExactlyOnceWith('snapshot')
  expect(controller.transferPicker.value).toBeNull()
  expect(controller.transferProvider.value).toBe('')
  expect(forkThreadById).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
})
it('keeps one pending confirmation and navigates only after the import is confirmed', async () => {
  vi.mocked(prepareConversationTransfer).mockResolvedValueOnce({ id: 'snapshot', messageCount: 1, warnings: [] })
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
    .mockResolvedValueOnce({ id: 'new-snapshot', messageCount: 1, warnings: [], sourceModelProvider: 'B' })
  const { controller } = transfer()
  const opening = controller.openTransferPicker('old-source')
  await controller.cancelTransferPicker()
  await controller.openTransferPicker('new-source')
  expect(controller.transferProvider.value).toBe('A')
  pending.resolve({ id: 'old-snapshot', messageCount: 1, warnings: [], sourceModelProvider: 'A' })
  await opening
  expect(controller.transferPicker.value?.sourceId).toBe('new-source')
  expect(controller.transferProvider.value).toBe('A')
  expect(cancelConversationTransfer).toHaveBeenCalledExactlyOnceWith('old-snapshot')
})
function routing() {
  const route = reactive({ name: 'thread' })
  const target = ref('A'), selected = ref('')
  const selectThread = vi.fn(async (id: string) => { selected.value = id; return 'ok' as const })
  const send = vi.fn(async () => 'new-thread'), replace = vi.fn(async () => {})
  const controller = createAppRouteCoordinator({ route, routeThreadId: computed(() => target.value),
    selectedThreadId: selected, selectThread, ensureThreadMessagesLoaded: vi.fn(async () => {}),
    newThreadCwd: ref('/fixture'), desktopError: ref(''), sendMessageToNewThread: send,
    newThreadProjectId: computed(() => 'native-project'), router: { replace }, scheduleMobileConversationJumpToLatest: vi.fn(),
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
  f.send.mockRejectedValueOnce(new Error('Outcome unknown'))
  expect(await f.controller.submitFirstMessageForNewThread('prompt')).toBe(false)
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(f.replace).not.toHaveBeenCalled()
})
