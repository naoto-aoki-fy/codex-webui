import { NativeAuthenticationStateMachine, AUTHENTICATED_WRITES } from './nativeAuthenticationState.js'
import { CodexHomeResolver } from './codexHomeResolver.js'
import { getConnectionProfileId } from './connectionProfile.js'
import { SubscriptionRecovery } from './subscriptionRecovery.js'
import { RolloutGenerationMetadata } from './rolloutGenerationMetadata.js'
import { randomInt } from 'node:crypto'
import { AppServerWebSocketClient, positiveEnv } from './appServerWebSocketClient.js'
import { asRecord } from './bridgeHttpUtils.js'

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : ''
}

type JsonRpcCall = {
  id: number
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  id?: number | string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
  method?: string
  params?: unknown
}

type ServerRequestReply = {
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

type PendingServerRequest = {
  id: number | string
  method: string
  params: unknown
  receivedAtIso: string
  wireId?: number | string
}

export const STREAM_EVENT_BUFFER_LIMIT = 400

export type StreamEventFrame = {
  method: string
  params: unknown
  atIso: string
}

export class AppServerClient {
  getInitializationMetadata() { return this.transport.getInitializationMetadata() }

  private readonly authentication = new NativeAuthenticationStateMachine(
    (method, params) => this.call(method, params),
    state => this.emitNotification({ method: 'native-authentication/state', params: state }),
  )

  private connectionGeneration = 0
  private readonly codexHome = new CodexHomeResolver(
    (method, params) => this.call(method, params),
    () => `${this.getConnectionGeneration()}:${getConnectionProfileId()}`,
  )
  async resolveCodexHome({ discover = true } = {}): Promise<string> {
    await this.ensureInitialized()
    return discover ? this.codexHome.resolve() : this.codexHome.observedHome()
  }

  private readonly rolloutMetadata = new RolloutGenerationMetadata({
    rpc: (method, params) => this.call(method, params),
    generation: () => this.getConnectionGeneration(),
    home: () => this.resolveCodexHome(),
  })
  private readonly rolloutRequests = new Map<string, Set<string> | null>()
  private recoverRolloutMetadata(threadId: string, turns: unknown[] | null, force = false): void {
    const generation = this.getConnectionGeneration()
    const key = `${generation}:${threadId}:${force}`
    const ids = turns ? new Set(turns.map(turn => readNonEmptyString(asRecord(turn)?.id)).filter(Boolean)) : null
    if (this.rolloutRequests.has(key)) {
      const existing = this.rolloutRequests.get(key)
      if (!ids) this.rolloutRequests.set(key, null)
      else if (existing) for (const id of ids) existing.add(id)
      return
    }
    this.rolloutRequests.set(key, ids)
    void this.rolloutMetadata.recover(threadId, force).then(entries => {
      if (generation !== this.getConnectionGeneration()) return
      const requested = this.rolloutRequests.get(key)
      for (const [turnId, generationMetadata] of entries) {
        if (!requested || requested.has(turnId)) this.emitNotification({ method: 'turn/generationMetadata', params: { threadId, turnId, generationMetadata } })
      }
    }).catch(() => { /* Metadata must never break history loading. */ }).finally(() => this.rolloutRequests.delete(key))
  }
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  private readonly notificationListeners = new Set<(value: { method: string; params: unknown }) => void>()
  private readonly pendingServerRequests = new Map<number | string, PendingServerRequest>()
  private readonly streamEventsByThreadId = new Map<string, StreamEventFrame[]>()
  private snapshotEpoch = {}
  getConnectionGeneration(): number { return this.connectionGeneration }
  getSnapshotEpoch(): object { return this.snapshotEpoch }

  private readonly lastThreadReadSnapshotByThreadId = new Map<string, unknown>()
  private readonly snapshotBytesByThreadId = new Map<string, number>()
  private disposed = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  private nextApprovalId = randomInt(2 ** 40)
  private reconnectPromise: Promise<void> | null = null
  private readonly subscribedThreads = new Set<string>()
  private connectionState: 'connected' | 'disconnected' | undefined
  private transport = new AppServerWebSocketClient((frame) => this.handleLine(frame), () => {
    this.connectionState = 'disconnected'
    this.authentication.disconnect()
    this.connectionGeneration++
    this.codexHome.reset()
    this.recovery.cancel()
    for (const request of this.pending.values()) request.reject(new Error('App-server disconnected. Retry to reconnect; inspect the thread before resending a turn.'))
    this.pending.clear()
    this.pendingServerRequests.clear()
    this.streamEventsByThreadId.clear()
    this.lastThreadReadSnapshotByThreadId.clear()
    this.snapshotBytesByThreadId.clear()
    this.emitNotification({ method: 'app-server/disconnected', params: { approvalRecovery: 'Pending approvals cannot be recovered automatically. Inspect the thread on the App Server host before continuing.' } })
    this.scheduleReconnect()
  })

  private scheduleReconnect(): void {
    if (this.disposed || this.retryTimer) return
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.retryAttempt++, 6)) * (0.75 + Math.random() * 0.5)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.reconnect(false).catch(() => this.scheduleReconnect())
    }, delay)
    this.retryTimer.unref?.()
  }

  private sendLine(payload: Record<string, unknown>): void { this.transport.send(payload) }

  private handleLine(line: string): void {
    let message: JsonRpcResponse
    try {
      message = JSON.parse(line) as JsonRpcResponse
    } catch {
      return
    }

    if (!message.method && typeof message.id === 'number' && this.pending.has(message.id)) {
      const pendingRequest = this.pending.get(message.id)
      this.pending.delete(message.id)

      if (!pendingRequest) return

      if (message.error) {
        pendingRequest.reject(Object.assign(new Error(message.error.message), { code: message.error.code, data: message.error.data }))
      } else {
        pendingRequest.resolve(message.result)
      }
      return
    }

    if (typeof message.method === 'string' && message.id === undefined) {
      this.emitNotification({
        method: message.method,
        params: message.params ?? null,
      })
      return
    }

    // Handle server-initiated JSON-RPC requests (approvals, dynamic tool calls, etc.).
    if ((typeof message.id === 'number' || typeof message.id === 'string') && typeof message.method === 'string') {
      this.handleServerRequest(message.id, message.method, message.params ?? null)
    }
  }

  private emitNotification(notification: { method: string; params: unknown }): void {
    this.authentication.observe(notification.method, notification.params)
    if (notification.method === 'account/updated' || notification.method === 'account/login/completed') return
    this.recordStreamEvent(notification)
    const nThreadId = this.extractThreadIdFromParams(notification.params)
    if (nThreadId && notification.method !== 'turn/generationMetadata') {
      if (notification.method === 'thread/reverted' || notification.method === 'thread/deleted') {
        this.snapshotEpoch = {}
        this.lastThreadReadSnapshotByThreadId.delete(nThreadId)
        this.streamEventsByThreadId.delete(nThreadId)
      }
      if(notification.method==='thread/deleted'){
        this.subscribedThreads.delete(nThreadId)
        this.recovery.forget(nThreadId)
      }
    }
    for (const listener of this.notificationListeners) {
      listener(notification)
    }
  }

  private extractThreadIdFromParams(params: unknown): string {
    const record = asRecord(params)
    if (!record) return ''
    const threadId =
      (typeof record.threadId === 'string' ? record.threadId : '') ||
      (typeof record.thread_id === 'string' ? record.thread_id : '') ||
      (typeof record.conversationId === 'string' ? record.conversationId : '') ||
      (typeof record.conversation_id === 'string' ? record.conversation_id : '')
    if (threadId) return threadId
    const thread = asRecord(record.thread)
    if (thread && typeof thread.id === 'string') return thread.id
    const turn = asRecord(record.turn)
    if (turn) {
      const turnThreadId =
        (typeof turn.threadId === 'string' ? turn.threadId : '') ||
        (typeof turn.thread_id === 'string' ? turn.thread_id : '')
      if (turnThreadId) return turnThreadId
    }
    return ''
  }

  private recordStreamEvent(notification: { method: string; params: unknown }): void {
    const threadId = this.extractThreadIdFromParams(notification.params)
    if (!threadId) return
    const frame: StreamEventFrame = {
      method: notification.method,
      params: notification.params,
      atIso: new Date().toISOString(),
    }
    let buffer = this.streamEventsByThreadId.get(threadId)
    if (!buffer) {
      buffer = []
      this.streamEventsByThreadId.set(threadId, buffer)
    }
    buffer.push(frame)
    if (buffer.length > STREAM_EVENT_BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - STREAM_EVENT_BUFFER_LIMIT)
    }
  }

  getStreamEvents(threadId: string, limit: number): StreamEventFrame[] {
    const buffer = this.streamEventsByThreadId.get(threadId)
    if (!buffer || buffer.length === 0) return []
    return buffer.slice(-limit)
  }

  storeThreadReadSnapshot(threadId: string, snapshot: unknown): void {
    // Bound aggregate retained fallback snapshots to 16 threads / 32 MiB.
    this.lastThreadReadSnapshotByThreadId.delete(threadId)
    for (const id of this.snapshotBytesByThreadId.keys()) {
      if (!this.lastThreadReadSnapshotByThreadId.has(id)) this.snapshotBytesByThreadId.delete(id)
    }
    const bytes = Buffer.byteLength(JSON.stringify(snapshot))
    if (bytes <= 32 * 1024 * 1024) {
      let total = [...this.snapshotBytesByThreadId.values()].reduce((sum, size) => sum + size, bytes)
      while (this.lastThreadReadSnapshotByThreadId.size >= 16 || total > 32 * 1024 * 1024) {
        const first = this.lastThreadReadSnapshotByThreadId.keys().next().value
        if (first === undefined) break
        total -= this.snapshotBytesByThreadId.get(first) ?? 0
        this.snapshotBytesByThreadId.delete(first)
        this.lastThreadReadSnapshotByThreadId.delete(first)
      }
      this.lastThreadReadSnapshotByThreadId.set(threadId, snapshot)
      this.snapshotBytesByThreadId.set(threadId, bytes)
    }
  }

  getLastThreadReadSnapshot(threadId: string): unknown | null {
    return this.lastThreadReadSnapshotByThreadId.get(threadId) ?? null
  }

  private sendServerRequestReply(requestId: number | string, reply: ServerRequestReply): void {
    if (reply.error) {
      this.sendLine({
        id: requestId,
        error: reply.error,
      })
      return
    }

    this.sendLine({
      id: requestId,
      result: reply.result ?? {},
    })
  }

  private resolvePendingServerRequest(requestId: number | string, reply: ServerRequestReply): void {
    const pendingRequest = this.pendingServerRequests.get(requestId)
    if (!pendingRequest) {
      throw new Error(`No pending server request found for id ${String(requestId)}`)
    }
    this.pendingServerRequests.delete(requestId)

    this.sendServerRequestReply(pendingRequest.wireId!, reply)
    const requestParams = asRecord(pendingRequest.params)
    const threadId =
      typeof requestParams?.threadId === 'string' && requestParams.threadId.length > 0
        ? requestParams.threadId
        : ''
    this.emitNotification({
      method: 'server/request/resolved',
      params: {
        id: requestId,
        method: pendingRequest.method,
        threadId,
        mode: 'manual',
        resolvedAtIso: new Date().toISOString(),
      },
    })
  }

  private handleServerRequest(requestId: number | string, method: string, params: unknown): void {
    if (method === 'account/chatgptAuthTokens/refresh') {
      this.sendServerRequestReply(requestId, { error: {
        code: -32001,
        message: 'Client-managed token refresh is unsupported. Run codex login on the App Server host and use Codex-managed authentication there.',
      } })
      return
    }

    const pendingRequest: PendingServerRequest = {
      id: this.nextApprovalId++,
      method,
      params,
      receivedAtIso: new Date().toISOString(),
      wireId: requestId,
    }
    this.pendingServerRequests.set(pendingRequest.id, pendingRequest)

    this.emitNotification({
      method: 'server/request',
      params: pendingRequest,
    })
  }

  private async call(method: string, params: unknown, deadlineMs?: number): Promise<unknown> {
    const homeToken = this.codexHome.token()
    const result = await this.callObserved(method, params, deadlineMs)
    if (method === 'thread/read') this.codexHome.observeThreadRead(result, homeToken)
    return result
  }

  private async callObserved(method: string, params: unknown, deadlineMs?: number): Promise<unknown> {
    await this.ensureInitialized()
    // No await between this guard and the wire write: initialization may yield
    // while another browser starts login or an account notification arrives.
    if (AUTHENTICATED_WRITES.has(method)) this.authentication.assertReady()
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      // A deadline only releases the caller; it never cancels or retries remote work.
      const timeout = deadlineMs ?? (method === 'command/exec' ? positiveEnv('CODEXUI_APP_SERVER_COMMAND_DEADLINE_MS', 600_000)
        : positiveEnv('CODEXUI_APP_SERVER_RPC_DEADLINE_MS', 60_000))
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`App-server ${method} deadline exceeded; outcome unknown. Reconcile remote state before retrying.`))
      }, timeout)
      timer.unref?.()
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })

      try { this.sendLine({
        id,
        method,
        params,
      } satisfies JsonRpcCall) } catch (error) { this.pending.get(id)?.reject(error); this.pending.delete(id) }
    })
  }

  private async ensureInitialized(): Promise<void> {
    const token = this.codexHome.token()
    await this.transport.connect()
    if (token !== this.codexHome.token()) throw new Error('Retired app-server initialization')
    this.codexHome.observeInitialization(this.getInitializationMetadata(), token)
    if (this.connectionState !== 'connected') {
      this.connectionState = 'connected'
      this.emitNotification({ method: 'app-server/transportState', params: { state: 'connected' } })
    }
  }

  private readonly recovery = new SubscriptionRecovery(
    (params, deadline) => this.call('thread/resume', params, deadline),
    (threadId, state, attempt, error) => {
      this.lastThreadReadSnapshotByThreadId.delete(threadId)
      this.emitNotification({ method: 'app-server/subscriptionRecovery', params: { threadId, state, attempt, error } })
    },
  )

  private restoreSubscriptions(): void {
    for (const threadId of this.subscribedThreads) {
      void this.recovery.request(threadId, { threadId, excludeTurns: true }).catch(() => {})
    }
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    const homeToken = this.codexHome.token()
    await this.ensureInitialized()
    if (method === 'native-authentication/read') return this.authentication.read()
    if (method === 'native-authentication/reconcile') return this.authentication.reconcile(params)
    if (method === 'account/logout') return this.authentication.logout()
    if (method === 'account/login/start') return this.authentication.start(params)
    if (method === 'account/login/cancel') return this.authentication.cancel(params)
    if (AUTHENTICATED_WRITES.has(method)) await this.authentication.assertCanSend()
    if (method === 'thread/generationMetadata/refresh') {
      this.recoverRolloutMetadata(readNonEmptyString(asRecord(params)?.threadId), null, true)
      return {}
    }
    const resumeId = readNonEmptyString(asRecord(params)?.threadId)
    const joiningBackgroundRecovery = method === 'thread/resume' && asRecord(params)?.excludeTurns !== true
      && asRecord(this.recovery.parameters(resumeId))?.excludeTurns === true
    let result = method === 'thread/resume'
      ? await this.recovery.request(resumeId, params)
      : await this.call(method, params)
    if (joiningBackgroundRecovery) result = await this.call('thread/read', { threadId: resumeId, includeTurns: true })
    if (method === 'thread/read') this.codexHome.observeThreadRead(result, homeToken)
    const record = asRecord(result)
    if (method === 'thread/turns/list' && Array.isArray(record?.data)) {
      if (record.data.length && asRecord(params)?.itemsView !== 'notLoaded') this.recoverRolloutMetadata(resumeId, record.data)
    }
    const thread = asRecord(record?.thread)
    if (thread && typeof thread.id === 'string' && Array.isArray(thread.turns)) {
      if (thread.turns.length && ['thread/read', 'thread/resume', 'thread/fork'].includes(method)) this.recoverRolloutMetadata(thread.id, thread.turns)
    }
    if (method === 'thread/revert') {
      this.snapshotEpoch = {}
      const id = readNonEmptyString(asRecord(params)?.threadId)
      this.lastThreadReadSnapshotByThreadId.delete(id)
      this.streamEventsByThreadId.delete(id)
    }
    if (['thread/start', 'thread/resume', 'thread/fork'].includes(method)) {
      const id = readNonEmptyString(asRecord(asRecord(result)?.thread)?.id)
      if (id) this.subscribedThreads.add(id)
    }
    if (method === 'thread/archive' || method === 'thread/unsubscribe') {
      const id = readNonEmptyString(asRecord(params)?.threadId)
      this.subscribedThreads.delete(id)
    }
    return result
  }

  onNotification(listener: (value: { method: string; params: unknown }) => void): () => void {
    this.notificationListeners.add(listener)
    // Reconcile transport events missed during a browser outage, without an RPC
    // or replaying any thread events, approvals, or mutations.
    try {
      if (this.connectionState) listener({ method: 'app-server/transportState', params: { state: this.connectionState } })
    } catch (error) {
      this.notificationListeners.delete(listener)
      throw error
    }
    return () => {
      this.notificationListeners.delete(listener)
    }
  }

  async respondToServerRequest(payload: unknown): Promise<void> {
    await this.ensureInitialized()

    const body = asRecord(payload)
    if (!body) {
      throw new Error('Invalid response payload: expected object')
    }

    const id = body.id
    if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isInteger(id))) {
      throw new Error('Invalid response payload: "id" must be an integer')
    }

    const rawError = asRecord(body.error)
    if (rawError) {
      const message = typeof rawError.message === 'string' && rawError.message.trim().length > 0
        ? rawError.message.trim()
        : 'Server request rejected by client'
      const code = typeof rawError.code === 'number' && Number.isFinite(rawError.code)
        ? Math.trunc(rawError.code)
        : -32000
      this.resolvePendingServerRequest(id, { error: { code, message } })
      return
    }

    if (!('result' in body)) {
      throw new Error('Invalid response payload: expected "result" or "error"')
    }

    this.resolvePendingServerRequest(id, { result: body.result })
  }

  listPendingServerRequests(): PendingServerRequest[] {
    return Array.from(this.pendingServerRequests.values())
  }

  async reconnect(reset = true): Promise<void> {
    if (this.reconnectPromise) return this.reconnectPromise
    this.reconnectPromise = (async () => {
      await (reset ? this.transport.reconnect() : this.transport.connect())
      await this.ensureInitialized()
      this.retryAttempt = 0
      if (this.retryTimer) clearTimeout(this.retryTimer)
      this.retryTimer = null
      this.emitNotification({ method: 'app-server/reconnected', params: null })
      void this.restoreSubscriptions()
    })().finally(() => { this.reconnectPromise = null })
    return this.reconnectPromise
  }
  dispose(): void {
    this.disposed = true
    this.authentication.dispose()
    this.recovery.cancel()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.transport.dispose()
  }
}

