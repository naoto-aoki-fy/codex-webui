import type { NativeAuthenticationState } from '../types/nativeAuthentication.js'

type Rpc = (method: string, params: unknown) => Promise<unknown>
const record = (value: unknown) => value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
const rejected = (error: unknown) => [-32600, -32601, -32602].includes(Number(record(error)?.code))
export const AUTHENTICATED_WRITES = new Set(['turn/start', 'turn/steer', 'thread/queue/add', 'thread/queue/update', 'thread/queue/start', 'review/start'])

/** Owned by one AppServerClient/connection context, shared by all its browsers.
 * No timers or disk state: account/read reconstructs evidence after process restart.
 */
export class NativeAuthenticationStateMachine {
  private state: NativeAuthenticationState = { phase: 'checking', blocking: true, revision: 0 }
  private loginId = ''
  private starting = false
  private early = new Map<string, boolean>()
  private reading: Promise<void> | null = null

  constructor(private readonly rpc: Rpc, private readonly publish: (state: NativeAuthenticationState) => void) {}
  snapshot(): NativeAuthenticationState { return { ...this.state, loginId: this.loginId || null } }
  private set(phase: NativeAuthenticationState['phase']) {
    this.state = { phase, blocking: phase !== 'ready', revision: this.state.revision + 1 }
    this.publish(this.snapshot())
  }
  disconnect() { this.reading = null; this.set('disconnected') }

  private async accountPhase(): Promise<'ready' | 'signedOut'> {
    const result = record(await this.rpc('account/read', { refreshToken: false }))
    const account = record(result?.account)
    if (!result || typeof result.requiresOpenaiAuth !== 'boolean' || !('account' in result)
      || result.account !== null && (!account || typeof account.type !== 'string' || !account.type)) {
      throw new Error('Native account state unavailable')
    }
    return !result.requiresOpenaiAuth || account ? 'ready' : 'signedOut'
  }

  /** Refresh evidence, preserving pending writes and explicit cache reconciliation. */
  async read(): Promise<NativeAuthenticationState> {
    if (['pending','reconciliation','unknown'].includes(this.state.phase)) return this.snapshot()
    if (this.reading) { await this.reading; return this.snapshot() }
    const revision = this.state.revision
    const reading = (async () => {
      try {
        const phase = await this.accountPhase()
        if (revision !== this.state.revision) return
        if (this.starting || this.loginId) this.set('pending')
        else if (this.state.phase === 'reconciliation' || this.state.phase === 'unknown') return
        else this.set(phase)
      } catch {
        if (revision === this.state.revision) this.set('unknown')
      }
    })()
    this.reading = reading
    try { await reading } finally { if (this.reading === reading) this.reading = null }
    return this.snapshot()
  }

  async assertCanSend() {
    if (this.state.phase === 'checking' || this.state.phase === 'disconnected') await this.read()
    this.assertReady()
  }
  assertReady() {
    if (this.state.blocking) throw new Error(`Native authentication is ${this.state.phase}. Inspect the account and reconcile before sending.`)
  }

  /** Explicit recovery after reconnect: a signed-in account is actual evidence;
   * a signed-out account cannot resolve a known pending login by itself. */
  async reconcile(): Promise<NativeAuthenticationState> {
    if (this.starting) throw new Error('Native authentication start is still unresolved')
    const revision = this.state.revision
    try {
      const phase = await this.accountPhase()
      if (revision !== this.state.revision) throw new Error('Native account changed during reconciliation; inspect again')
      if (this.loginId && phase === 'signedOut') throw new Error('Native authentication is pending; complete or cancel the identified login first')
      this.loginId = ''; this.early.clear(); this.set(phase)
      return this.snapshot()
    } catch (error) {
      if (revision === this.state.revision && !this.loginId) this.set('unknown')
      throw error
    }
  }

  async start(params: unknown): Promise<unknown> {
    if (this.starting || this.loginId || ['pending', 'reconciliation', 'unknown', 'disconnected'].includes(this.state.phase)) {
      throw Object.assign(new Error('Native authentication already pending or requires reconciliation'), { code: -32600 })
    }
    this.starting = true; this.early.clear(); this.set('pending')
    const revision = this.state.revision
    try {
      // Independently verify the signed-out precondition; browser preflight is advisory.
      const current = record(await this.rpc('account/read', { refreshToken: false }))
      if (revision !== this.state.revision) throw new Error('Native account changed before login')
      if (current?.account !== null || current.requiresOpenaiAuth !== true) {
        throw Object.assign(new Error('Native sign-in requires a signed-out account'), { code: -32600 })
      }
      const result = await this.rpc('account/login/start', params)
      const id = record(result)?.loginId
      if (typeof id !== 'string' || !id || id.length > 2000) throw new Error('Native login identity unavailable')
      // A disconnect can retire the request; never use its response in a new context.
      if (this.state.phase === 'disconnected') throw new Error('Connection changed during native sign-in')
      this.loginId = id
      this.starting = false
      const completed = this.early.get(id); this.early.clear()
      if (completed !== undefined) await this.complete(completed)
      else if (this.state.phase !== 'reconciliation') this.set('pending')
      return result
    } catch (error) {
      this.starting = false
      if (this.state.phase !== 'disconnected') {
        if (rejected(error) && revision === this.state.revision) { this.set('checking'); await this.read() }
        else this.set('unknown')
      }
      throw error
    }
  }

  async cancel(params: unknown): Promise<unknown> {
    const id = record(params)?.loginId
    if (typeof id !== 'string' || id !== this.loginId || !id) {
      throw Object.assign(new Error('No matching backend native login to cancel'), { code: -32602 })
    }
    const revision = this.state.revision
    try {
      const result = await this.rpc('account/login/cancel', params)
      if (this.loginId !== id || this.state.phase === 'disconnected') return result
      if (record(result)?.status !== 'canceled') {
        // A native notFound acknowledgment ends ownership of this identity, but
        // requires fresh account reconciliation before a new operation.
        if (record(result)?.status === 'notFound') this.loginId = ''
        this.set('unknown'); return result
      }
      this.loginId = ''
      await this.complete(false)
      return result
    } catch (error) { if (revision === this.state.revision) this.set('unknown'); throw error }
  }

  private async complete(success: boolean) {
    this.loginId = ''; this.set('reconciliation')
    const revision = this.state.revision
    try {
      const phase = await this.accountPhase()
      if (revision === this.state.revision) this.set(success || phase === 'ready' ? 'reconciliation' : phase)
    } catch { if (revision === this.state.revision) this.set('unknown') }
  }
  observe(method: string, params: unknown) {
    if (method === 'account/updated') { this.set('reconciliation'); return }
    if (method !== 'account/login/completed') return
    const row = record(params)
    if (typeof row?.loginId !== 'string' || row.loginId.length > 2000 || typeof row.success !== 'boolean') return
    if (this.starting) {
      if (this.early.size === 4) this.early.delete(this.early.keys().next().value!)
      this.early.set(row.loginId, row.success)
    } else if (this.loginId === row.loginId) void this.complete(row.success)
  }
}
