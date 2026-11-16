import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, getCurrentInstance, ssrContextKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AboutSettings from './AboutSettings.vue'
import { copyTextToClipboard } from '../../utils/clipboard'

vi.mock('../../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }))
const sha = '1234567890abcdef1234567890abcdef12345678'
const timestamp = '2026-11-16T01:02:03.456Z'
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

function metadata(commitSha = sha) {
  vi.stubGlobal('__BUILD_COMMIT_SHA__', commitSha)
  vi.stubGlobal('__BUILD_TIMESTAMP__', timestamp)
}

describe('About settings', () => {
  it('renders a short SHA, full GitHub URL and readable build timestamp', async () => {
    metadata()
    const html = await renderToString(createSSRApp(AboutSettings))
    expect(html).toContain('Codex WebUI')
    expect(html).toMatch(new RegExp(`<code[^>]*>${sha.slice(0, 12)}</code>`))
    expect(html).toContain(`href="https://github.com/naoto-aoki-fy/codex-webui/commit/${sha}"`)
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain(`datetime="${timestamp}"`)
    expect(html).toContain('2026-11-16 01:02:03 UTC')
    expect(html).toContain('Copy full commit SHA')
  })

  it('renders Unknown without a misleading link or copy action', async () => {
    metadata('Unknown')
    const html = await renderToString(createSSRApp(AboutSettings))
    expect(html).toContain('Unknown')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<button')
    expect(html).toContain('2026-11-16 01:02:03 UTC')
  })

  it.each([false, true])('copies the full SHA and reports clipboard failure=%s', async fails => {
    metadata()
    if (fails) vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('denied'))
    else vi.mocked(copyTextToClipboard).mockResolvedValue()

    // Mount the real setup with a renderless host to exercise its async action.
    const renderer = createRenderer<object, object>({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
      parentNode: () => null, nextSibling: () => null,
    })
    let state!: { copyCommitSha(): Promise<void>; copyStatus: string; isCopying: boolean }
    const app = renderer.createApp({
      ...AboutSettings,
      render() {
        state = (getCurrentInstance() as unknown as { setupState: typeof state }).setupState
        return null
      },
    })
    app.provide(ssrContextKey, {})
    app.mount({})
    try {
      const pending = state.copyCommitSha()
      expect(state.isCopying).toBe(true)
      await pending
      expect(copyTextToClipboard).toHaveBeenCalledExactlyOnceWith(sha)
      expect(state.isCopying).toBe(false)
      expect(state.copyStatus).toBe(fails ? 'Could not copy commit SHA.' : 'Copied full commit SHA.')
    } finally {
      app.unmount()
    }
  })
})
