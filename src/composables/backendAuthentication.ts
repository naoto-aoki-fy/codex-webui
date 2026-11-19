import { computed, ref, shallowRef } from 'vue'
import { rpcCall } from '../api/codexRpcClient'
import { nativeLogin, verifyIdleForLogin, type LoginMethod, type NativeLogin } from '../api/nativeAuthentication'
import type { NativeAuthenticationState } from '../types/nativeAuthentication'

export function createBackendAuthentication(invalidateContext: () => void = () => {}) {
  const state = shallowRef<NativeAuthenticationState>({ phase: 'checking', blocking: true, revision: 0 })
  const login = shallowRef<NativeLogin | null>(null)
  const busy = ref(false)
  const error = ref('')
  let connectionEpoch = 0
  let pendingRefresh: Promise<void> | null = null
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
    if (login.value && (row.loginId !== login.value.id || row.phase !== 'pending')) login.value = null
    serverGeneration = incomingGeneration
    revision = row.revision
    state.value = row
  }
  function disconnect() {
    connectionEpoch++
    requestGeneration++
    pendingRefresh = null
    login.value = null
    state.value = { phase: 'disconnected', blocking: true, revision: state.value.revision }
  }
  function refresh(): Promise<void> {
    if (pendingRefresh) return pendingRefresh
    const token = ++requestGeneration
    revision = -1
    serverGeneration = -1
    state.value = { phase: 'checking', blocking: true, revision: state.value.revision }
    const refresh = rpcCall<NativeAuthenticationState>('native-authentication/read', {}).then(value => {
      if (token === requestGeneration) observe(value)
    }).catch(() => {
      if (token === requestGeneration) {
        state.value = { phase: 'unknown', reason: 'backend-state-unavailable', blocking: true, revision: state.value.revision }
      }
    }).finally(() => {
      if (pendingRefresh === refresh) pendingRefresh = null
    })
    pendingRefresh = refresh
    return refresh
  }
  async function run(action: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    if (busy.value || state.value.phase === 'disconnected') return
    const epoch = connectionEpoch
    const isCurrent = () => epoch === connectionEpoch
    busy.value = true
    error.value = ''
    try {
      await action(isCurrent)
    } catch (cause) {
      if (isCurrent()) error.value = cause instanceof Error ? cause.message : 'Native account request failed.'
    } finally {
      busy.value = false
    }
  }

  function startLogin(method: LoginMethod, workIsIdle: () => boolean): Promise<void> {
    return run(async isCurrent => {
      const canStart = () => isCurrent() && state.value.phase === 'signedOut' && workIsIdle()
      if (!canStart()) return
      await verifyIdleForLogin(canStart)
      if (!canStart()) throw new Error('Connection or activity changed before sign-in.')
      const result = await rpcCall<{ authUrl?: string; verificationUrl?: string }>('account/login/start', { type: method })
      if (!isCurrent() || !result?.authUrl && !result?.verificationUrl) return
      // The guard delivers its correlated completion independently of this response.
      if (state.value.phase === 'pending' || state.value.phase === 'signedOut') login.value = nativeLogin(result, method)
    })
  }

  function cancelLogin(): Promise<void> {
    const loginId = state.value.loginId
    if (!loginId) return Promise.resolve()
    return run(async () => {
      login.value = null
      await rpcCall('account/login/cancel', { loginId })
    })
  }

  function logout(): Promise<void> {
    if (state.value.phase !== 'ready') return Promise.resolve()
    return run(async () => { await rpcCall('account/logout', {}) })
  }

  function acknowledge(): Promise<void> {
    const { revision } = state.value
    return run(async isCurrent => {
      const next = await rpcCall('native-authentication/reconcile', { revision })
      if (isCurrent()) observe(next)
    })
  }

  return {
    state, blocking: computed(() => state.value.blocking), busy, error,
    challenge: computed(() => state.value.phase === 'pending' && state.value.loginId === login.value?.id ? login.value : null),
    startLogin, cancelLogin, logout, acknowledge, observe, disconnect, refresh, dispose: disconnect,
  }

}
