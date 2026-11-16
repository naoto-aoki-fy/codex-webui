import { computed, shallowRef } from 'vue'
import { rpcCall } from '../api/codexRpcClient'
import type { NativeAuthenticationState } from '../types/nativeAuthentication'

export function createBackendAuthentication(invalidateContext: () => void = () => {}) {
  const state = shallowRef<NativeAuthenticationState>({ phase: 'checking', blocking: true, revision: 0 })
  let requestGeneration = 0, revision = -1, serverGeneration = -1, contextRevision = -1
  function observe(value: unknown) {
    const row = value as NativeAuthenticationState | null
    if (!row || !['checking','ready','signedOut','pending','reconciliation','unknown','disconnected'].includes(row.phase)
      || typeof row.blocking !== 'boolean' || row.blocking !== (row.phase !== 'ready') || !Number.isInteger(row.revision)) return
    const incomingGeneration = row.generation ?? 0
    if (incomingGeneration < serverGeneration || incomingGeneration === serverGeneration && row.revision < revision) return
    requestGeneration++ // A push supersedes an older HTTP snapshot.
    // Invalidate old-context reads and presentation BEFORE publishing eligibility.
    if (row.contextRevision !== undefined && row.contextRevision !== contextRevision) {
      if (row.contextRevision > 0 || contextRevision >= 0) invalidateContext()
      contextRevision = row.contextRevision
    }
    serverGeneration = incomingGeneration; revision = row.revision
    state.value = row
  }
  function disconnect() { requestGeneration++; state.value = { ...state.value, phase: 'disconnected', blocking: true } }
  async function refresh() {
    const token = ++requestGeneration
    revision = -1; serverGeneration = -1 // Readiness may identify a replacement backend.
    state.value = { ...state.value, phase: 'checking', blocking: true }
    try {
      const value = await rpcCall<NativeAuthenticationState>('native-authentication/read', {})
      if (token === requestGeneration) observe(value)
    } catch { if (token === requestGeneration) state.value = { ...state.value, phase: 'unknown', reason: 'backend-state-unavailable', blocking: true } }
  }
  return { state, blocking: computed(() => state.value.blocking), observe, disconnect, refresh, dispose: () => { requestGeneration++ } }
}
