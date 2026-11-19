import { ref, shallowRef } from 'vue'
import { rpcCall } from '../api/codexRpcClient'
import { assertLoadedConversationsIdle, readNativeLoginChallenge, type LoginMethod, type NativeLogin } from '../api/nativeSignIn'

type AccountStatus = {
  account: { type: string; email?: string; planType?: string; workspaceName?: string } | null
  requiresOpenaiAuth: boolean
}

export function createAccountSettings() {
  const status = shallowRef<AccountStatus | null>(null)
  const challenge = shallowRef<NativeLogin | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const readError = ref('')
  const actionError = ref('')
  let active = false
  let generation = 0
  let readOutdated = false
  // The App Server can complete a login before the HTTP login-start reply arrives.
  let earlyCompletions: Map<string, string> | null = null

  function setActive(visible: boolean) {
    active = visible
    refreshIfActive()
  }

  function refreshIfActive() {
    if (active) void refresh()
  }

  function accountUpdated() {
    readOutdated = loading.value
    refreshIfActive()
  }

  async function refresh() {
    if (loading.value) return
    const current = generation
    loading.value = true
    readError.value = ''
    try {
      const result = await rpcCall<AccountStatus>('account/read', { refreshToken: false })
      if (current === generation && !readOutdated) status.value = result
    } catch (cause) {
      if (current === generation && !readOutdated) {
        status.value = null
        readError.value = cause instanceof Error ? cause.message : 'Account details unavailable.'
      }
    } finally {
      if (current === generation) {
        loading.value = false
        if (readOutdated) {
          readOutdated = false
          refreshIfActive()
        }
      }
    }
  }

  async function run(action: (isCurrent: () => boolean) => Promise<void>) {
    if (busy.value || loading.value) return
    const current = generation
    const isCurrent = () => current === generation
    busy.value = true
    actionError.value = ''
    try {
      await action(isCurrent)
    } catch (cause) {
      if (isCurrent()) actionError.value = cause instanceof Error ? cause.message : 'Native account request failed.'
    } finally {
      if (isCurrent()) {
        earlyCompletions = null
        busy.value = false
      }
    }
  }

  function finishLogin(error: string) {
    challenge.value = null
    actionError.value = error
    if (!error) refreshIfActive()
  }

  function completeLogin(params: unknown) {
    const result = params as { loginId?: unknown; success?: unknown; error?: unknown } | null
    if (typeof result?.loginId !== 'string' || typeof result.success !== 'boolean') return
    const error = result.success ? '' : typeof result.error === 'string' && result.error ? result.error : 'Native sign-in failed.'
    if (result.loginId === challenge.value?.id) {
      finishLogin(error)
    } else if (earlyCompletions && earlyCompletions.size < 16) {
      earlyCompletions.set(result.loginId, error)
    }
  }

  function startLogin(method: LoginMethod, workIsIdle: () => boolean) {
    return run(async isCurrent => {
      const canStart = () => isCurrent() && status.value?.account === null && workIsIdle()
      if (challenge.value || !status.value?.requiresOpenaiAuth || !canStart()) return
      await assertLoadedConversationsIdle(canStart)
      if (!canStart()) throw new Error('Connection or activity changed before sign-in.')
      earlyCompletions = new Map()
      const result = await rpcCall('account/login/start', { type: method })
      if (!isCurrent()) return
      const login = readNativeLoginChallenge(result, method)
      const error = earlyCompletions?.get(login.id)
      if (error === undefined) challenge.value = login
      else finishLogin(error)
    })
  }

  function cancelLogin() {
    const login = challenge.value
    if (!login) return
    return run(async isCurrent => {
      const { status: cancellation } = await rpcCall<{ status: 'canceled' | 'notFound' }>('account/login/cancel', { loginId: login.id })
      if (!isCurrent() || challenge.value !== login) return
      if (cancellation !== 'canceled' && cancellation !== 'notFound') throw new Error('Native sign-in cancellation was not confirmed.')
      challenge.value = null
      if (cancellation === 'notFound') {
        refreshIfActive()
        throw new Error('The App Server no longer has this sign-in attempt.')
      }
    })
  }

  function logout() {
    if (!status.value?.account || challenge.value) return
    return run(async isCurrent => {
      await rpcCall('account/logout', {})
      if (!isCurrent()) return
      status.value = null
      accountUpdated()
    })
  }

  function disconnect() {
    generation++
    status.value = null
    challenge.value = null
    earlyCompletions = null
    busy.value = false
    loading.value = false
    readOutdated = false
  }

  return { status, challenge, loading, busy, readError, actionError, setActive, refresh, refreshIfActive, accountUpdated, completeLogin, startLogin, cancelLogin, logout, disconnect }
}
