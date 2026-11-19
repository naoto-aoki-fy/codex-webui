import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppTransferDialog } from './appTransferDialog'
import type { UiMessage } from './types/codex'

const gateway = vi.hoisted(() => ({ prepare: vi.fn(), cancel: vi.fn() }))
vi.mock('./api/codexGateway', async () => ({
  prepareConversationTransfer: gateway.prepare,
  cancelConversationTransfer: gateway.cancel,
  reasoningCatalog: (await import('vue')).ref([
    { id: 'source-model', modelProvider: 'P', isDefault: true },
    { id: 'destination-model', modelProvider: 'Q', isDefault: true },
  ]),
}))
function setup() {
  const deps = {
    messages: computed<UiMessage[]>(() => [{ id: 'u', role: 'user', text: 'question', turnId: 'turn', turnIndex: 4 }]),
    selectedThreadId: ref('source'),
    composerSelectedModelId: computed(() => 'provider-model:["P","source-model"]'),
    forkThreadById: vi.fn(async () => 'destination'),
    forkNativeThreadById: vi.fn(async () => 'native'),
    desktopError: ref(''), router: { push: vi.fn(async () => undefined) },
    isMobile: ref(false), setSidebarCollapsed: vi.fn(),
  }
  return { deps, dialog: createAppTransferDialog(deps) }
}
const target = { turnId: 'turn', messageId: 'u' }
beforeEach(() => {
  gateway.prepare.mockReset().mockResolvedValue({ id: 'snapshot', messageCount: 8, sourceModelProvider: 'P' })
  gateway.cancel.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())
describe('Portable Fork and Revert provider dialog', () => {
  it('prepares an explicit exclusive user target and uses the existing provider defaults once', async () => {
    const { dialog, deps } = setup()
    await dialog.openTransferPicker('source', undefined, target)
    expect(gateway.prepare).toHaveBeenCalledExactlyOnceWith('source', undefined, target)
    expect(dialog.transferPicker.value?.revertTarget).toEqual(target)
    dialog.transferProvider.value = 'Q'
    let finish!: (id: string) => void
    deps.forkThreadById.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = dialog.confirmTransferPicker()
    await dialog.confirmTransferPicker()
    await dialog.openTransferPicker('source', undefined, target)
    expect(deps.forkThreadById).toHaveBeenCalledExactlyOnceWith('source', 'snapshot', 'provider-model:["Q","destination-model"]')
    expect(deps.router.push).not.toHaveBeenCalled()
    finish('destination')
    await pending
    expect(deps.router.push).toHaveBeenCalledExactlyOnceWith({ name: 'thread', params: { threadId: 'destination' } })
    expect(deps.forkNativeThreadById).not.toHaveBeenCalled()
    expect(gateway.prepare).toHaveBeenCalledTimes(1)
  })
  it('cancels without creating anything, including cancellation during preparation', async () => {
    const { dialog, deps } = setup()
    let finish!: (value: unknown) => void
    gateway.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const opening = dialog.openTransferPicker('source', undefined, target)
    await dialog.cancelTransferPicker()
    finish({ id: 'snapshot', messageCount: 8 })
    await opening
    expect(gateway.cancel).toHaveBeenCalledExactlyOnceWith('snapshot')
    expect(dialog.transferPicker.value).toBeNull()
    expect(deps.forkThreadById).not.toHaveBeenCalled()
    expect(deps.router.push).not.toHaveBeenCalled()
  })
  it('fences confirmation after failure without falling back, repreparing or navigating', async () => {
    const { dialog, deps } = setup()
    deps.desktopError.value = 'Incomplete destination; do not retry injection'
    deps.forkThreadById.mockResolvedValueOnce('')
    await dialog.openTransferPicker('source', undefined, target)
    await dialog.confirmTransferPicker()
    await dialog.confirmTransferPicker()
    expect(dialog.transferPicker.value?.failure).toContain('do not retry')
    expect(dialog.canConfirmFork.value).toBe(false)
    expect(deps.forkThreadById).toHaveBeenCalledTimes(1)
    expect(gateway.prepare).toHaveBeenCalledTimes(1)
    expect(deps.forkNativeThreadById).not.toHaveBeenCalled()
    expect(deps.router.push).not.toHaveBeenCalled()
  })
  it('leaves assistant cutoffs inclusive and native actions independent', async () => {
    const { dialog, deps } = setup()
    await dialog.onForkThreadFromMessage({ threadId: 'source', target: { turnId: 'turn-4' }, method: 'portable' })
    expect(gateway.prepare).toHaveBeenCalledExactlyOnceWith('source', { turnId: 'turn-4' }, undefined)
    await dialog.cancelTransferPicker()
    await dialog.onForkThreadFromMessage({ threadId: 'source', target: { turnId: 'turn-4' }, method: 'native' })
    expect(deps.forkNativeThreadById).toHaveBeenCalledExactlyOnceWith('source', 'turn-4')
    expect(gateway.prepare).toHaveBeenCalledTimes(1)
  })
})
