import { computed, reactive, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppTransferDialog } from './appTransferDialog'
import { createAppRouteCoordinator } from './appRouteCoordinator'
import { prepareConversationTransfer, cancelConversationTransfer } from './api/codexGateway'

vi.mock('./api/codexGateway', async () => ({
  reasoningCatalog: (await import('vue')).ref([{ id: 'model', model: 'model', modelProvider: 'P', isDefault: true }]),
  prepareConversationTransfer: vi.fn(), cancelConversationTransfer: vi.fn(async () => {}),
}))
afterEach(() => vi.clearAllMocks())
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
