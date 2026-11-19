import { ref } from 'vue'
import { reloadForConnectionProfile } from '../utils/browserConnectionProfile'
import { rpcCall } from '../api/codexRpcClient'
import { emptyModelPreferences, preferenceModelKey, type ModelPreferences, type ModelPreferenceUpdate } from '../modelPreferences'

/** One snapshot and one in-flight hydration per desktop lifecycle; notifications carry revisions. */
export function createBackendModelPreferences(apply: (state: ModelPreferences) => void) {
  const state = ref(emptyModelPreferences())
  const loading = ref(false)
  const error = ref('')
  let hydrated = false
  let disposed = false
  let lifecycle = 0
  let refreshPromise: Promise<void> | null = null
  let writes: Promise<void> = Promise.resolve()
  const pending = new Set<ModelPreferenceUpdate>()
  function publish() {
    const view = { ...state.value, reasoningByModel: { ...state.value.reasoningByModel } }
    for (const patch of pending) {
      if (patch.reasoning) view.reasoningByModel[preferenceModelKey(patch.reasoning.providerId, patch.reasoning.modelId)] = patch.reasoning.effort
    }
    apply(view)
  }
  function observe(snapshot: ModelPreferences) {
    if (disposed || snapshot?.schemaVersion !== 1 || snapshot.revision < state.value.revision) return
    state.value = snapshot
    publish()
  }
  async function refresh() {
    if (disposed) return
    if (refreshPromise) return refreshPromise
    loading.value = true
    const owner = lifecycle
    refreshPromise = (async () => {
      try {
        const next = await rpcCall<ModelPreferences>('model-preferences/read')
        if (disposed || owner !== lifecycle) return
        if (next.connectionProfile && reloadForConnectionProfile(next.connectionProfile)) { disposed = true; return }
        observe(next)
        hydrated = true
        error.value = ''
      } catch (cause) {
        if (!disposed && owner === lifecycle) error.value = cause instanceof Error ? cause.message : 'Model preferences could not be loaded'
      } finally { if (owner === lifecycle) { loading.value = false; refreshPromise = null } }
    })()
    return refreshPromise
  }
  async function ensureHydrated() {
    if (!hydrated) await refresh()
  }
  function update(patch: ModelPreferenceUpdate) {
    const owner = lifecycle
    pending.add(patch)
    writes = writes.then(async () => {
      if (disposed || owner !== lifecycle) return
      await ensureHydrated()
      if (disposed || owner !== lifecycle) return
      // Never write on a failed hydration: that could mask authoritative saved data.
      if (!hydrated) throw new Error('Model preferences are unavailable; reconnect before saving changes')
      const snapshot = await rpcCall<ModelPreferences>('model-preferences/update', patch)
      pending.delete(patch)
      if (disposed || owner !== lifecycle) return
      observe(snapshot)
      error.value = ''
    }).catch(cause => {
      pending.delete(patch)
      if (!disposed && owner === lifecycle) error.value = cause instanceof Error ? cause.message : 'Model preferences could not be saved'
    })
    return writes
  }
  return {
    state, loading, error, observe, refresh, ensureHydrated, update, settled: () => writes,
    resume: () => { disposed = false },
    dispose: () => { disposed = true; lifecycle++; refreshPromise = null; pending.clear(); loading.value = false; hydrated = false },
  }
}
