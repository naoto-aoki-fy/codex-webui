import { computed, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createComposerAttachments } from './composerAttachments'
import { uploadFile } from '../../api/codexGateway'

vi.mock('../../api/codexGateway', () => ({ uploadFile: vi.fn() }))
afterEach(() => vi.clearAllMocks())
function deferred() {
  let resolve!: (value: string) => void
  const promise = new Promise<string>(yes => { resolve = yes })
  return { promise, resolve }
}
const create = () => createComposerAttachments({ isAttachMenuOpen: ref(false), closeFileMention() {}, isInteractionDisabled: computed(() => false) })

it('does not publish an upload into a replacement draft session or replay the upload', async () => {
  const pending = deferred()
  vi.mocked(uploadFile).mockReturnValueOnce(pending.promise)
  const attachments = create()
  attachments.attachIncomingFiles([new File(['fixture'], 'notes.txt', { type: 'text/plain' })])
  expect(attachments.pendingAttachmentCount.value).toBe(1)
  // The input owner advances this token when replacing its complete draft.
  attachments.attachmentSessionToken += 1
  attachments.pendingAttachmentCount.value = 0
  pending.resolve('/fixture/notes.txt')
  await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1))
  await Promise.resolve()
  expect(attachments.fileAttachments.value).toEqual([])
  expect(attachments.pendingAttachmentCount.value).toBe(0)
})
it('keeps plain clipboard text available while attaching its image exactly once', async () => {
  vi.mocked(uploadFile).mockResolvedValueOnce('/fixture/paste.png')
  const attachments = create(), preventDefault = vi.fn()
  const image = new File(['image-fixture'], 'paste.png', { type: 'image/png' })
  attachments.onInputPaste({ preventDefault, clipboardData: {
    getData: () => 'keep this text', items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
  } } as unknown as ClipboardEvent)
  await vi.waitFor(() => expect(attachments.selectedImages.value).toHaveLength(1))
  expect(preventDefault).not.toHaveBeenCalled()
  expect(uploadFile).toHaveBeenCalledTimes(1)
  expect(attachments.pendingAttachmentCount.value).toBe(0)
})
