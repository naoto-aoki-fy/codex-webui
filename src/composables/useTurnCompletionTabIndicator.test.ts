import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTurnCompletionTabIndicator } from './useTurnCompletionTabIndicator'

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
  const { markBackgroundTurnCompletion } = scope.run(() =>
    useTurnCompletionTabIndicator(() => activeThreadId.value, pageTitle),
  )!

  function setHidden(hidden: boolean) {
    tab.hidden = hidden
    tab.dispatchEvent(new Event('visibilitychange'))
  }

  return { tab, favicon, activeThreadId, pageTitle, scope, markBackgroundTurnCompletion, setHidden }
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
})

describe('turn completion tab indicator', () => {
  it('marks the title and favicon together and restores both when the tab becomes visible', async () => {
    const state = setup()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)

    state.setHidden(true)
    state.markBackgroundTurnCompletion('first')
    await nextTick()
    expect(state.tab.title).toBe(`* ${title}`)
    expect(state.favicon.href).toBe(markedHref)

    state.pageTitle.value = 'Renamed conversation | Codex WebUI'
    state.markBackgroundTurnCompletion('first')
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
    state.markBackgroundTurnCompletion('first')
    await nextTick()
    expect(state.favicon.href).toBe(markedHref)

    state.activeThreadId.value = threadId
    state.markBackgroundTurnCompletion('first')
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)

    state.activeThreadId.value = 'first'
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })

  it('ignores completions in a visible tab and completions for another thread', async () => {
    const state = setup()
    state.markBackgroundTurnCompletion('first')
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)

    state.setHidden(true)
    state.markBackgroundTurnCompletion('second')
    await nextTick()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })

  it('restores both indicators when the app is unmounted before a visibility update flushes', async () => {
    const state = setup()
    state.setHidden(true)
    state.markBackgroundTurnCompletion('first')
    await nextTick()
    expect(state.favicon.href).toBe(markedHref)

    state.setHidden(false)
    state.scope.stop()
    expect(state.tab.title).toBe(title)
    expect(state.favicon.getAttribute()).toBe(originalHref)
  })
})
