import { computed, ref, type Ref } from 'vue'
import type { BrowserConnectionState } from '../api/codexRpcClient'

const reactivationDelayMs = 500

function createConnectionNotice(suppressed: Ref<boolean>, canShowRecovery: () => boolean) {
  const state = ref<BrowserConnectionState | 'unknown'>('unknown')
  const reconnected = ref(false)
  const notice = computed(() => {
    if (suppressed.value || state.value === 'unknown') return ''
    if (state.value === 'connected') return reconnected.value ? 'reconnected' : ''
    return state.value
  })
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearRecovery() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    reconnected.value = false
  }

  function update(next: BrowserConnectionState) {
    if (state.value === next) return
    const restored = state.value === 'disconnected' || state.value === 'reconnecting'
    clearRecovery()
    state.value = next
    if (next !== 'connected' || !restored || !canShowRecovery()) return
    reconnected.value = true
    const dismissal = setTimeout(() => {
      if (timer !== dismissal) return
      timer = undefined
      reconnected.value = false
    }, 3000)
    timer = dismissal
  }

  return { state, notice, update, clearRecovery }
}

export function createConnectionNotices() {
  const doc = typeof document === 'undefined' ? undefined : document
  const suppressed = ref(false)
  let hidden = false
  let recoveryNoticeAfter = -Infinity
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let listening = false

  // At 500 ms the warning can return, but a recovery at the deadline is still silent.
  const canShowRecovery = () => !hidden && performance.now() > recoveryNoticeAfter
  const browser = createConnectionNotice(suppressed, canShowRecovery)
  const appServer = createConnectionNotice(suppressed, canShowRecovery)

  function suppress() {
    suppressed.value = true
    if (restartTimer !== undefined) clearTimeout(restartTimer)
    restartTimer = undefined
    browser.clearRecovery()
    appServer.clearRecovery()
  }

  function onVisibilityChange() {
    const isHidden = doc?.visibilityState === 'hidden'
    if (hidden === isHidden) return
    hidden = isHidden
    if (hidden) {
      suppress()
      return
    }
    recoveryNoticeAfter = performance.now() + reactivationDelayMs
    const restart = setTimeout(() => {
      if (restartTimer !== restart) return
      restartTimer = undefined
      suppressed.value = false
    }, reactivationDelayMs)
    restartTimer = restart
  }

  function onPageHide(event: PageTransitionEvent) {
    if (!event.persisted) dispose()
  }

  function start() {
    if (listening) return
    listening = true
    hidden = doc?.visibilityState === 'hidden'
    suppressed.value = hidden
    recoveryNoticeAfter = -Infinity
    doc?.addEventListener('visibilitychange', onVisibilityChange)
    doc?.defaultView?.addEventListener('pagehide', onPageHide)
  }

  function dispose() {
    listening = false
    hidden = true
    suppress()
    doc?.removeEventListener('visibilitychange', onVisibilityChange)
    doc?.defaultView?.removeEventListener('pagehide', onPageHide)
  }

  start()
  return { browser, appServer, start, dispose }
}
