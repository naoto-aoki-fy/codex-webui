import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useThreadTabIndicator } from './useThreadTabIndicator'

const originalHref = '/icons/favicon-192x192.png'
const origin = 'http://localhost'
const markedHref = origin + '/icons/favicon-notification-192x192.png'
const title = 'First conversation | Codex WebUI'
const scopes: ReturnType<typeof effectScope>[] = []

function setup() {
  let href = originalHref
  const favicon = {
    get href() { return new URL(href, origin).href },
    set href(value: string) { href = value },
    getAttribute: () => href,
    setAttribute: (_name: string, value: string) => { href = value },
  }
  const tab = Object.assign(new EventTarget(), {
    hidden: false,
    title: '',
    querySelector: () => favicon,
  })
  vi.stubGlobal('document', tab)

  const activeThreadId = ref<string | null>('first')
  const pageTitle = ref(title)
  const scope = effectScope()
  scopes.push(scope)
  const { markBackgroundThread } = scope.run(() =>
    useThreadTabIndicator(() => activeThreadId.value, pageTitle),
  )!

  function setHidden(hidden: boolean) {
    tab.hidden = hidden
    tab.dispatchEvent(new Event('visibilitychange'))
  }

  return { tab, favicon, activeThreadId, pageTitle, scope, markBackgroundThread, setHidden }
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
})

describe('conversation tab indicator', () => {
  it('marks the title and favicon together and restores both when the tab becomes visible', async () => {
    const state = setup()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)

    state.setHidden(true)
    state.markBackgroundThread('first')
    await nextTick()
    expect(state.tab.title).toBe(`* ${title}`)
    expect(state.favicon.href).toBe(markedHref)

    state.pageTitle.value = 'Renamed conversation | Codex WebUI'
    state.markBackgroundThread('first')
    await nextTick()
    expect(state.tab.title).toBe(`* ${state.pageTitle.value}`)
    expect(state.favicon.href).toBe(markedHref)

    state.setHidden(false)
    await nextTick()
    expect(state.tab.title).toBe(state.pageTitle.value)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })

  it.each(['second', null])('clears the marker on navigation to %s while hidden', async (threadId) => {
    const state = setup()
    state.setHidden(true)
    state.markBackgroundThread('first')
    await nextTick()
    expect(state.favicon.href).toBe(markedHref)

    state.activeThreadId.value = threadId
    state.markBackgroundThread('first')
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)

    state.activeThreadId.value = 'first'
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })

  it('ignores notifications in a visible tab and notifications for another thread', async () => {
    const state = setup()
    state.markBackgroundThread('first')
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)

    state.setHidden(true)
    state.markBackgroundThread('second')
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })

  it('ignores deferred notifications from before the most recent visibility change', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      const state = setup()
      const whileVisible = performance.now()
      now.mockReturnValue(1)
      state.setHidden(true)
      state.markBackgroundThread('first', whileVisible)
      await nextTick()
      expect(state.tab.title).toBe(title)
      const whileHidden = performance.now()
      now.mockReturnValue(2)
      state.setHidden(false)
      now.mockReturnValue(3)
      state.setHidden(true)
      state.markBackgroundThread('first', whileHidden)
      await nextTick()
      expect(state.tab.title).toBe(title)
      expect(state.favicon.getAttribute()).toBe(originalHref)

      state.markBackgroundThread('first', performance.now())
      await nextTick()
      expect(state.tab.title).toBe(`* ${title}`)
      expect(state.favicon.href).toBe(markedHref)
    } finally {
      now.mockRestore()
    }
  })

  it('restores both indicators when the app is unmounted before a visibility update flushes', async () => {
    const state = setup()
    state.setHidden(true)
    state.markBackgroundThread('first')
    await nextTick()
    expect(state.favicon.href).toBe(markedHref)

    state.setHidden(false)
    state.scope.stop()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })
})
