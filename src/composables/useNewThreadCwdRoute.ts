import { onScopeDispose, watch, type Ref } from 'vue'
import type { Router } from 'vue-router'

/** Keep home folder selection in the route, without registering URL-provided folders. */
export function useNewThreadCwdRoute(router: Router, cwd: Ref<string>): void {
  let ready = false
  let restoring = false
  let disposed = false

  const restore = () => {
    const route = router.currentRoute.value
    if (!ready || route.name !== 'home') return
    const value = typeof route.query.cwd === 'string' ? route.query.cwd : ''
    if (cwd.value === value) return
    restoring = true
    cwd.value = value
    restoring = false
  }
  watch(() => router.currentRoute.value, restore, { flush: 'sync' })
  watch(cwd, (value) => {
    const route = router.currentRoute.value
    if (!ready || restoring || route.name !== 'home') return
    if ((typeof route.query.cwd === 'string' ? route.query.cwd : '') === value) return
    const query = { ...route.query }
    if (value) query.cwd = value
    else delete query.cwd
    void router.replace({ name: 'home', query })
  }, { flush: 'sync' })
  onScopeDispose(() => { disposed = true })
  void router.isReady().then(() => {
    if (disposed) return
    ready = true
    restore()
  })
}
