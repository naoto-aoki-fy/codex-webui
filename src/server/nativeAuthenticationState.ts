import { publicAccountStatus, publicLoginChallenge } from './publicAccount.js'
import type { NativeAuthenticationState } from '../types/nativeAuthentication.js'

type Rpc = (method: string, params: unknown) => Promise<unknown>
const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2000
const rejected = (error: unknown) => [-32600, -32601, -32602].includes(Number(record(error)?.code))
export const AUTHENTICATED_WRITES = new Set(['turn/start', 'turn/steer', 'thread/queue/add', 'thread/queue/update', 'thread/queue/start', 'review/start'])
type Evidence = { usable: boolean; context: string | null; account: NativeAuthenticationState['account'] }

/** One connection's evidence and operation ownership. No credentials or disk state. */
export class NativeAuthenticationStateMachine {
  private state: NativeAuthenticationState = { phase: 'checking', blocking: true, revision: 0 }
  private loginId = ''
  private starting = false
  private loggingOut = false
  private uncertainOperation = false
  private operation = 0
  private early = new Map<string, boolean>()
  private generation = 0
  private contextRevision = 0
  private evidenceVersion = 0
  private verifiedContext: string | null = null
  private explicitAcknowledgment = false
  private acceptContext = true // Startup, matching login completion, or explicit acknowledgment.
  private dirty = true
  private reading: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(private readonly rpc: Rpc, private readonly publish: (state: NativeAuthenticationState) => void) {}
  private unresolved() { return this.starting || this.loggingOut || !!this.loginId || this.uncertainOperation }
  snapshot(): NativeAuthenticationState {
    return { ...this.state, loginId: this.loginId || null, generation: this.generation,
      contextRevision: this.contextRevision, operationUnresolved: this.unresolved() }
  }
  private set(phase: NativeAuthenticationState['phase'], reason: string, account?: NativeAuthenticationState['account']) {
    this.state = { phase, reason, account, blocking: phase !== 'ready', revision: this.state.revision + 1 }
    this.publish(this.snapshot())
  }
  private invalidate(reason: string) {
    if(reason==='account-update-verifying'&&this.explicitAcknowledgment){this.acceptContext=false;this.explicitAcknowledgment=false}
    this.evidenceVersion++; this.contextRevision++; this.dirty = true
    this.set(this.unresolved() ? 'pending' : 'checking', reason)
    this.schedule()
  }
  private schedule() {
    if (this.disposed || this.timer || this.reading || this.state.phase === 'disconnected') return
    // A burst owns one timer, one read, and at most one queued follow-up. Failures
    // never retry themselves; only a new event or explicit read requests more work.
    this.timer = setTimeout(() => { this.timer = null; void this.verify() }, 25)
    this.timer.unref?.()
  }
  disconnect() {
    if(this.disposed)return
    if(this.explicitAcknowledgment){this.acceptContext=false;this.explicitAcknowledgment=false}
    this.generation++; this.evidenceVersion++; this.contextRevision++; this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.set('disconnected', 'connection-disconnected')
  }
  dispose() { this.disposed = true; this.operation++; this.evidenceVersion++; if (this.timer) clearTimeout(this.timer); this.timer = null }

  private async evidence(): Promise<Evidence> {
    const { account, requiresOpenaiAuth } = publicAccountStatus(await this.rpc('account/read', { refreshToken: false }))
    if (!requiresOpenaiAuth) return { usable: true, context: 'external-provider', account }
    if (!account) return { usable: false, context: null, account }
    let context: string | null = null
    if (account.type === 'chatgpt') {
      // account/read's email/plan/workspaceName are display fields, not identity.
      // This optional read-only API supplies stable user AND workspace identities.
      try {
        const sessions = record(await this.rpc('accountSession/list', { refreshWorkspaceMetadata: false }))
        if (text(sessions?.activeSessionId) && Array.isArray(sessions.sessions) && sessions.sessions.length <= 100) {
          const active = sessions.sessions.map(record).filter(s => s?.isActive === true)
          const current = active.length === 1 ? active[0] : null
          if (current?.sessionId === sessions.activeSessionId && text(current.userId) && text(current.selectedWorkspaceAccountId)) {
            context = JSON.stringify([current.sessionId, current.userId, current.selectedWorkspaceAccountId])
          }
        }
      } catch { /* Unsupported/ambiguous identity requires explicit recovery on updates. */ }
    }
    return { usable: true, context, account }
  }

  private async verify(): Promise<void> {
    if (this.reading) return this.reading
    if (!this.dirty || this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.dirty = false
    const version = this.evidenceVersion, generation = this.generation
    const current = () => !this.disposed && version === this.evidenceVersion && generation === this.generation
    const reading = (async () => {
      try {
        const evidence = await this.evidence()
        if (!current()) return
        if (this.unresolved()) { this.set(this.uncertainOperation ? 'unknown' : 'pending', 'authentication-operation-unresolved', evidence.account); return }
        if (!evidence.usable) { this.set('signedOut', 'sign-in-required', null); return }
        if (this.acceptContext || evidence.context !== null && evidence.context === this.verifiedContext) {
          this.verifiedContext = evidence.context; this.acceptContext = false; this.explicitAcknowledgment=false
          this.set('ready', 'account-verified', evidence.account); return
        }
        this.set('reconciliation', evidence.context && this.verifiedContext ? 'account-context-changed' : 'account-identity-unavailable', evidence.account)
      } catch {
        if (current()) this.set('unknown', 'account-verification-failed')
      }
    })()
    this.reading = reading
    try { await reading } finally {
      if (this.reading === reading) this.reading = null
      // New evidence must eventually be read even when it superseded an in-flight
      // result. This is driven by invalidations, never an error retry loop.
      if (this.dirty) this.schedule()
    }
  }

  async read(): Promise<NativeAuthenticationState> {
    if (this.state.phase === 'disconnected') this.set(this.unresolved() ? 'pending' : 'checking', 'connection-rechecking')
    if (this.dirty || this.reading) await this.verify()
    else if (['unknown', 'reconciliation'].includes(this.state.phase)
      && !this.starting && !this.loggingOut && !this.loginId) {
      this.dirty = true; this.set('checking', 'verification-retry'); await this.verify()
    }
    return this.snapshot()
  }
  async assertCanSend() {
    if (this.state.phase === 'checking' || this.state.phase === 'disconnected') await this.read()
    this.assertReady()
  }
  assertReady() {
    if (this.state.blocking) throw new Error(`Native authentication is ${this.state.phase} (${this.state.reason ?? 'verification-required'}). Check sign-in controls before sending.`)
  }
  async reconcile(params: unknown): Promise<NativeAuthenticationState> {
    // A usable account cannot cancel or supersede a known native login identity.
    if (this.starting || this.loggingOut || this.loginId) throw new Error('Native authentication is pending; finish the current operation first')
    if (record(params)?.revision !== this.state.revision) throw new Error('Native account changed. Review the current status before acknowledging it.')
    this.uncertainOperation = false; this.acceptContext = true
    this.explicitAcknowledgment=true
    this.invalidate('explicit-account-acknowledgment')
    return this.read()
  }

  async logout(): Promise<unknown> {
    await this.assertCanSend()
    this.assertReady()
    const generation = this.generation
    this.loggingOut = true
    this.evidenceVersion++
    this.contextRevision++
    this.set('pending', 'logout-starting')
    try {
      await this.rpc('account/logout', {})
      this.loggingOut = false
      if (generation === this.generation) {
        this.invalidate('logout-completed')
        await this.read()
      }
      return {}
    } catch (error) {
      this.loggingOut = false
      this.uncertainOperation = !rejected(error)
      if (generation === this.generation) {
        this.invalidate('logout-unconfirmed')
        await this.read()
      }
      throw error
    }
  }

  async start(params: unknown): Promise<unknown> {
    if (this.unresolved() || ['reconciliation','unknown','disconnected','checking'].includes(this.state.phase) && this.state.revision > 0) {
      throw Object.assign(new Error('Native authentication already pending or requires verification'), { code: -32600 })
    }
    const type = record(params)?.type
    if (type !== 'chatgpt' && type !== 'chatgptDeviceCode') {
      throw Object.assign(new Error('Only Codex-managed ChatGPT sign-in is available through WebUI'), { code: -32602 })
    }
    const previousPhase=this.state.phase, acceptedBefore=this.acceptContext
    const token = ++this.operation, generation = this.generation
    this.starting = true; this.early.clear(); this.acceptContext = false
    this.evidenceVersion++; this.contextRevision++; this.dirty = false
    this.set('pending', 'login-starting')
    const version = this.evidenceVersion
    let submitted = false
    try {
      const current = record(await this.rpc('account/read', { refreshToken: false }))
      if (version !== this.evidenceVersion) throw Object.assign(new Error('Native account changed before login'), { code: -32600 })
      if (current?.account !== null || current.requiresOpenaiAuth !== true) {
        throw Object.assign(new Error('Native sign-in requires a signed-out account'), { code: -32600 })
      }
      submitted = true
      const result = await this.rpc('account/login/start', { type })
      if (token !== this.operation || generation !== this.generation) throw new Error('Connection changed during native sign-in')
      const id = record(result)?.loginId
      if (!text(id)) throw new Error('Native login identity unavailable')
      this.loginId = id; this.starting = false
      const completed = this.early.get(id); this.early.clear()
      if (completed !== undefined) {
        await this.complete(completed)
        return { type, loginId: id }
      }
      this.set('pending', 'login-awaiting-completion')
      return publicLoginChallenge(result, type)
    } catch (error) {
      if (token !== this.operation || this.loginId) throw error
      this.starting = false; this.early.clear()
      this.uncertainOperation = submitted && !rejected(error)
      if (generation === this.generation) {
        if (this.uncertainOperation) this.set('unknown', 'login-outcome-unknown')
        else {
          if(version===this.evidenceVersion)this.acceptContext=acceptedBefore||previousPhase==='ready'
          this.invalidate('login-rejected');await this.read()
        }
      }
      throw error
    }
  }
  async cancel(params: unknown): Promise<unknown> {
    const id = record(params)?.loginId
    if (!text(id) || id !== this.loginId) throw Object.assign(new Error('No matching backend native login to cancel'), { code: -32602 })
    const generation = this.generation, token = this.operation
    try {
      const result = await this.rpc('account/login/cancel', { loginId: id })
      const value = record(result)?.status
      const status = value === 'canceled' || value === 'notFound' ? value : undefined
      if (token !== this.operation || this.loginId !== id || generation !== this.generation) return { status }
      if (status === 'canceled') await this.complete(false)
      else {
        if (status === 'notFound') this.loginId = ''
        this.uncertainOperation = true; this.set('unknown', 'cancellation-outcome-unknown')
      }
      return { status }
    } catch (error) {
      if (generation === this.generation && token === this.operation && this.loginId === id) {
        this.uncertainOperation = true; this.set('unknown', 'cancellation-outcome-unknown')
      }
      throw error
    }
  }
  private async complete(success: boolean) {
    this.operation++; this.loginId = ''; this.starting = false; this.uncertainOperation = false
    // Only a matching native completion establishes ownership of a new account.
    this.acceptContext = success
    this.invalidate(success ? 'login-completed' : 'login-ended')
    await this.read()
  }
  observe(method: string, params: unknown) {
    if (method === 'account/updated') { this.invalidate('account-update-verifying'); return }
    if (method !== 'account/login/completed') return
    const row = record(params)
    if (!text(row?.loginId) || typeof row.success !== 'boolean') return
    if (this.starting) {
      if (this.early.size === 4) this.early.delete(this.early.keys().next().value!)
      this.early.set(row.loginId, row.success)
    } else if (this.loginId === row.loginId) void this.complete(row.success)
  }
}
