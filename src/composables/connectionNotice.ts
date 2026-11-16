import { ref } from 'vue'
import type { BrowserConnectionState } from '../api/codexRpcClient'

/** One notice per layer. Only confirmed recovery owns a dismissal timer. */
export function createConnectionNotice() {
  const state = ref<BrowserConnectionState | 'unknown'>('unknown')
  const notice = ref<'' | 'disconnected' | 'reconnecting' | 'reconnected'>('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0

  function dispose() {
    ++revision
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function update(next: BrowserConnectionState) {
    if (state.value === next) return
    const restored = state.value === 'disconnected' || state.value === 'reconnecting'
    dispose()
    state.value = next
    notice.value = next === 'connected' ? (restored ? 'reconnected' : '') : next
    if (notice.value !== 'reconnected') return
    const current = revision
    timer = setTimeout(() => {
      if (current !== revision) return
      timer = undefined
      notice.value = ''
    }, 3000)
  }

  return { state, notice, update, dispose }
}
