import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

export function useThreadTabIndicator(activeThreadId: () => string | null, pageTitle: Ref<string>) {
  const tab = typeof document === 'undefined' ? undefined : document
  const markedThreadId = ref<string | null>(null)
  const isMarked = computed(() => markedThreadId.value !== null && markedThreadId.value === activeThreadId())
  let contextChangedAt = performance.now()

  watch(activeThreadId, () => {
    contextChangedAt = performance.now()
    markedThreadId.value = null
  }, { flush: 'sync' })

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

  function markBackgroundThread(threadId: string, occurredAt = performance.now()): void {
    if (tab?.hidden && activeThreadId() === threadId && occurredAt >= contextChangedAt) markedThreadId.value = threadId
  }

  function updateVisibility(): void {
    contextChangedAt = performance.now()
    if (tab && !tab.hidden) markedThreadId.value = null
  }

  tab?.addEventListener('visibilitychange', updateVisibility)
  onScopeDispose(() => {
    tab?.removeEventListener('visibilitychange', updateVisibility)
    if (tab) tab.title = pageTitle.value
  })

  return { markBackgroundThread }
}
