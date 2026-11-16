import { afterEach, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, getCurrentInstance, nextTick, ssrContextKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DraftRecoverySettings from './DraftRecoverySettings.vue'
import { recoverableDrafts, type ComposerDraftPayload } from '../../utils/composerDraftStorage'

vi.mock('../../utils/composerDraftStorage', () => ({ recoverableDrafts: vi.fn() }))
const draft: ComposerDraftPayload = { text: 'Saved draft', imageUrls: [], fileAttachments: [], skills: [] }
const entries = [{ key: 'source', draft }]
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.resetAllMocks(); vi.unstubAllGlobals() })

it.each([0, 1])('renders the Settings recovery section with %s available drafts', async count => {
  vi.mocked(recoverableDrafts).mockReturnValue(count ? entries : [])
  const html = await renderToString(createSSRApp(DraftRecoverySettings, { threadId: 'thread', recoverDraft: () => true }))
  expect(html).toContain('aria-label="Draft Recovery"')
  expect(html).toContain('current conversation and connection profile')
  expect(html.includes('Recover saved drafts (1)')).toBe(!!count)
  expect(html.includes('No other saved drafts for this conversation.')).toBe(!count)
  if (count) expect(html).toContain('aria-expanded="false"')
})

function mount(success = true) {
  vi.mocked(recoverableDrafts).mockReturnValue(entries)
  const add = vi.fn(), remove = vi.fn(), recoverDraft = vi.fn(() => success), count = vi.fn()
  vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove })
  type State = { expanded: boolean; status: string; error: string; entries: typeof entries; recover(entry: typeof entries[number]): void }
  let state!: State
  const renderer = createRenderer<object, object>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({
    ...DraftRecoverySettings,
    render() {
      state = (getCurrentInstance() as unknown as { setupState: State }).setupState
      return null
    },
  }, { threadId: 'thread', recoverDraft, onCount: count })
  app.provide(ssrContextKey, {})
  app.mount({})
  cleanup.push(() => app.unmount())
  return { state, recoverDraft, count, add, remove, app }
}

it('reports availability, refreshes on another tab’s draft changes and cleans up on close without restoring', async () => {
  const c = mount()
  expect(c.count).toHaveBeenLastCalledWith(1)
  vi.mocked(recoverableDrafts).mockReturnValue([])
  c.add.mock.calls[0]![1]({ key: 'codex-web-local.thread-draft.v2.thread.other.writer' })
  await nextTick()
  expect(c.state.entries).toEqual([])
  expect(c.count).toHaveBeenLastCalledWith(0)
  cleanup.pop()!()
  expect(c.remove).toHaveBeenCalledWith('storage', c.add.mock.calls[0]![1])
  expect(c.recoverDraft).not.toHaveBeenCalled()
})

it.each([true, false])('delegates recovery to the live composer and reports success=%s without hiding the source', async success => {
  const c = mount(success)
  c.state.expanded = true
  c.state.recover(entries[0]!)
  await nextTick()
  expect(c.recoverDraft).toHaveBeenCalledExactlyOnceWith(draft)
  expect(c.state.entries).toEqual(entries)
  expect(c.state.expanded).toBe(true)
  expect(c.state.status).toBe(success ? 'Draft copied to the composer. Close Settings to review it before sending. The saved source is still available.' : '')
  expect(c.state.error).toBe(success ? '' : 'Could not preserve the current draft. Copy it before recovering another draft.')
})
