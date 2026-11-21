import { ref, shallowRef, watch, type Ref } from 'vue'
import { searchThreadsPage } from '../api/codexGateway'
import { CodexApiError } from '../api/codexErrors'
import type { UiThread } from '../types/codex'

export function useSidebarMessageSearch(query: Readonly<Ref<string>>) {
  const threads = shallowRef<UiThread[]>([])
  const pending = ref(false)
  const error = ref('')

  watch(query, (term, _, onCleanup) => {
    threads.value = []
    error.value = ''
    pending.value = Boolean(term)
    if (!term) return

    const controller = new AbortController()
    const { signal } = controller
    const timer = setTimeout(() => void loadPages(), 200)
    onCleanup(() => {
      clearTimeout(timer)
      controller.abort()
    })

    async function loadPages(): Promise<void> {
      const results = new Map<string, UiThread>()
      const cursors = new Set<string>()
      let cursor: string | null = null
      try {
        do {
          const page = await searchThreadsPage(term, cursor, signal)
          if (signal.aborted) return
          for (const thread of page.threads) {
            if (!results.has(thread.id)) results.set(thread.id, thread)
          }
          threads.value = [...results.values()]
          cursor = page.nextCursor
          if (cursor && cursors.has(cursor)) throw new Error('Message search returned a repeated pagination cursor')
          if (cursor) cursors.add(cursor)
        } while (cursor)
      } catch (cause) {
        if (signal.aborted) return
        const detail = cause instanceof Error ? cause.message : String(cause)
        const unsupported = (cause instanceof CodexApiError && cause.rpcCode === -32601)
          || /experimentalApi|method not found|unknown method|unsupported/i.test(detail)
        error.value = unsupported
          ? `Message search requires a Codex server with thread/search and experimentalApi enabled. ${detail}`
          : `Message search failed. ${detail}`
      } finally {
        if (!signal.aborted) pending.value = false
      }
    }
  }, { immediate: true, flush: 'sync' })

  return { threads, pending, error }
}
