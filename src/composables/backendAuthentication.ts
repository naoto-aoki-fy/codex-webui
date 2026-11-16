import { computed, shallowRef } from 'vue'
import { rpcCall } from '../api/codexRpcClient'
import type { NativeAuthenticationState } from '../types/nativeAuthentication'

export function createBackendAuthentication() {
  const state = shallowRef<NativeAuthenticationState>({ phase: 'checking', blocking: true, revision: 0 })
  let generation = 0
  function observe(value: unknown) {
    const row = value as NativeAuthenticationState | null
    if (!row || !['checking','ready','signedOut','pending','reconciliation','unknown','disconnected'].includes(row.phase)
      || typeof row.blocking !== 'boolean' || row.blocking !== (row.phase !== 'ready') || !Number.isInteger(row.revision)) return
    generation++ // A push supersedes any outstanding HTTP snapshot.
    state.value = row
  }
  function disconnect() { generation++; state.value = { ...state.value, phase: 'disconnected', blocking: true } }
  async function refresh() {
    const token = ++generation
    state.value = { ...state.value, phase: 'checking', blocking: true }
    try {
      const value = await rpcCall<NativeAuthenticationState>('native-authentication/read', {})
      if (token === generation) observe(value)
    } catch { if (token === generation) state.value = { ...state.value, phase: 'unknown', blocking: true } }
  }
  return { state, blocking: computed(() => state.value.blocking), observe, disconnect, refresh, dispose: () => { generation++ } }
}
