import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

export function useTurnCompletionTabIndicator(activeThreadId: () => string | null, pageTitle: Ref<string>) {
  const tab = typeof document === 'undefined' ? undefined : document
  const markedThreadId = ref<string | null>(null)
  const isMarked = computed(() => markedThreadId.value !== null && markedThreadId.value === activeThreadId())

  watch(activeThreadId, () => { markedThreadId.value = null }, { flush: 'sync' })

  const favicon = tab?.querySelector<HTMLLinkElement>('#app-favicon')
  const originalHref = favicon?.getAttribute('href')
  watch(isMarked, (marked, _, onCleanup) => {
    if (!marked || !favicon || !originalHref) return
    favicon.href = new URL('favicon-notification-192x192.png', favicon.href).href
    onCleanup(() => favicon.setAttribute('href', originalHref))
  })

  const markedTitle = computed(() => isMarked.value ? `* ${pageTitle.value}` : pageTitle.value)
  watch(markedTitle, (title) => {
    if (tab) tab.title = title
  }, { immediate: true })

  function markBackgroundTurnCompletion(threadId: string): void {
    if (tab?.hidden && activeThreadId() === threadId) markedThreadId.value = threadId
  }

  function clearTurnMarkerWhenVisible(): void {
    if (tab && !tab.hidden) markedThreadId.value = null
  }

  tab?.addEventListener('visibilitychange', clearTurnMarkerWhenVisible)
  onScopeDispose(() => {
    tab?.removeEventListener('visibilitychange', clearTurnMarkerWhenVisible)
    if (tab) tab.title = pageTitle.value
  })

  return { markBackgroundTurnCompletion }
}
