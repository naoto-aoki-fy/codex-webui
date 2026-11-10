import { AppServerWebSocketClient } from './appServerWebSocketClient.js'
import { asRecord, getErrorMessage } from './bridgeHttpUtils.js'
import { readCodexCredentialStore } from './codexCredentials.js'
import { refreshChatgptAuthTokensForExternalAuth, type ChatgptAuthTokensRefreshParams, type ChatgptAuthTokensRefreshResponse } from './externalAuthRefresh.js'
import { submittedGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata.js'

export interface AppServerClientDependencies {
  threadIndex: {
    call(method: string, params: Record<string, unknown>, rpc: (method: string, params: unknown) => Promise<unknown>): Promise<unknown>
  }
  metadataStore: {
    save(threadId: string, turnId: string, metadata: TurnGenerationMetadata): Promise<void>
  }
}

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
}

export const STREAM_EVENT_BUFFER_LIMIT = 400
const THREAD_TURN_PAGE_READ_CACHE_TTL_MS = 30_000

export type StreamEventFrame = {
  method: string
  params: unknown
  atIso: string
}

export class AppServerClient {
  constructor(private readonly dependencies: AppServerClientDependencies) {}

  private readonly pendingGenerationSettings = new Map<string, Set<TurnGenerationMetadata>>()
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  private readonly notificationListeners = new Set<(value: { method: string; params: unknown }) => void>()
  private readonly pendingServerRequests = new Map<number | string, PendingServerRequest>()
  private readonly streamEventsByThreadId = new Map<string, StreamEventFrame[]>()
  private readonly lastThreadReadSnapshotByThreadId = new Map<string, unknown>()
  private readonly threadTurnPageReadCacheByThreadId = new Map<string, { result: unknown; expiresAt: number }>()
  private readonly threadTurnPageReadPromiseByThreadId = new Map<string, Promise<unknown>>()
  private chatgptAuthRefreshPromise: Promise<ChatgptAuthTokensRefreshResponse> | null = null
  private restoredGeneration = -1
  private restorePromise: Promise<void> | null = null
  private connectionGeneration = 0
  private reconnectPromise: Promise<void> | null = null
  private readonly subscribedThreads = new Set<string>()
  private transport = new AppServerWebSocketClient((frame) => this.handleLine(frame), () => {
    this.connectionGeneration++
    for (const request of this.pending.values()) request.reject(new Error('App-server disconnected. Retry to reconnect; inspect the thread before resending a turn.'))
    this.pending.clear()
    this.pendingServerRequests.clear()
    this.streamEventsByThreadId.clear()
    this.lastThreadReadSnapshotByThreadId.clear()
    this.threadTurnPageReadCacheByThreadId.clear()
    this.threadTurnPageReadPromiseByThreadId.clear()
    this.emitNotification({ method: 'app-server/disconnected', params: null })
  })

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
        pendingRequest.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
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
    if (notification.method === 'turn/started') {
      const params = asRecord(notification.params)
      const turn = asRecord(params?.turn)
      const candidates = this.pendingGenerationSettings.get(this.extractThreadIdFromParams(params))
      // Concurrent starts cannot be correlated until the RPC response supplies the ID.
      if (params && turn && candidates?.size === 1) {
        notification = {
          ...notification,
          params: { ...params, turn: { ...turn, generationMetadata: candidates.values().next().value } },
        }
      }
    }
    this.recordStreamEvent(notification)
    const nThreadId = this.extractThreadIdFromParams(notification.params)
    if (nThreadId) {
      this.threadTurnPageReadCacheByThreadId.delete(nThreadId)
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
    this.lastThreadReadSnapshotByThreadId.set(threadId, snapshot)
    this.threadTurnPageReadCacheByThreadId.delete(threadId)
  }

  getLastThreadReadSnapshot(threadId: string): unknown | null {
    return this.lastThreadReadSnapshotByThreadId.get(threadId) ?? null
  }

  async readThreadForTurnPage(threadId: string): Promise<unknown> {
    const now = Date.now()
    const cached = this.threadTurnPageReadCacheByThreadId.get(threadId)
    if (cached && cached.expiresAt > now) return cached.result
    if (cached) this.threadTurnPageReadCacheByThreadId.delete(threadId)

    const pending = this.threadTurnPageReadPromiseByThreadId.get(threadId)
    if (pending) return pending

    const promise = this.rpc('thread/read', {
      threadId,
      includeTurns: true,
    }).then((result) => {
      this.threadTurnPageReadCacheByThreadId.set(threadId, {
        result,
        expiresAt: Date.now() + THREAD_TURN_PAGE_READ_CACHE_TTL_MS,
      })
      return result
    }).finally(() => {
      this.threadTurnPageReadPromiseByThreadId.delete(threadId)
    })

    this.threadTurnPageReadPromiseByThreadId.set(threadId, promise)
    return promise
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

    this.sendServerRequestReply(requestId, reply)
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

  private async refreshChatgptAuthTokens(params: ChatgptAuthTokensRefreshParams): Promise<ChatgptAuthTokensRefreshResponse> {
    if (!this.chatgptAuthRefreshPromise) {
      this.chatgptAuthRefreshPromise = refreshChatgptAuthTokensForExternalAuth(
        params,
        // Use config/read only: asking for auth refresh here would recurse into this request.
        () => readCodexCredentialStore({ rpc: (method, rpcParams) => this.call(method, rpcParams) }),
      ).finally(() => {
        this.chatgptAuthRefreshPromise = null
      })
    }
    return await this.chatgptAuthRefreshPromise
  }

  private async handleChatgptAuthTokensRefreshRequest(requestId: number | string, params: unknown, generation: number): Promise<void> {
    const requestParams = asRecord(params)
    const previousAccountId = readNonEmptyString(requestParams?.previousAccountId ?? requestParams?.previous_account_id)
    try {
      const result = await this.refreshChatgptAuthTokens({
        reason: readNonEmptyString(requestParams?.reason) || undefined,
        previousAccountId: previousAccountId || undefined,
      })
      if (generation !== this.connectionGeneration) return
      this.sendServerRequestReply(requestId, { result })
      this.emitNotification({
        method: 'server/request/resolved',
        params: {
          id: requestId,
          method: 'account/chatgptAuthTokens/refresh',
          mode: 'automatic',
          resolvedAtIso: new Date().toISOString(),
        },
      })
    } catch (error) {
      if (generation !== this.connectionGeneration) return
      this.sendServerRequestReply(requestId, {
        error: {
          code: -32001,
          message: getErrorMessage(error, 'Failed to refresh ChatGPT auth tokens'),
        },
      })
    }
  }

  private handleServerRequest(requestId: number | string, method: string, params: unknown): void {
    if (method === 'account/chatgptAuthTokens/refresh') {
      const generation = this.connectionGeneration
      void this.handleChatgptAuthTokensRefreshRequest(requestId, params, generation).catch(() => {})
      return
    }

    const pendingRequest: PendingServerRequest = {
      id: requestId,
      method,
      params,
      receivedAtIso: new Date().toISOString(),
    }
    this.pendingServerRequests.set(requestId, pendingRequest)

    this.emitNotification({
      method: 'server/request',
      params: pendingRequest,
    })
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    await this.transport.connect()
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })

      try { this.sendLine({
        id,
        method,
        params,
      } satisfies JsonRpcCall) } catch (error) { this.pending.delete(id); reject(error) }
    })
  }

  private async ensureInitialized(): Promise<void> {
    await this.transport.connect()
    if (this.restoredGeneration === this.connectionGeneration) return
    if (this.restorePromise) return this.restorePromise
    const generation = this.connectionGeneration
    this.restorePromise = (async () => {
      for (const threadId of this.subscribedThreads) await this.call('thread/resume', { threadId })
      if (generation !== this.connectionGeneration) throw new Error('Disconnected while restoring thread subscriptions')
      this.restoredGeneration = generation
    })().finally(() => { this.restorePromise = null })
    return this.restorePromise
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    await this.ensureInitialized()
    if (method !== 'turn/start') {
      const result = method === 'thread/list' ? await this.call(method, params)
        : await this.dependencies.threadIndex.call(method, asRecord(params) ?? {}, (m, p) => this.call(m, p))
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
    const threadId = readNonEmptyString(asRecord(params)?.threadId)
    const metadata = submittedGenerationMetadata(params)
    const candidates = this.pendingGenerationSettings.get(threadId) ?? new Set<TurnGenerationMetadata>()
    candidates.add(metadata)
    this.pendingGenerationSettings.set(threadId, candidates)
    try {
      const result = await this.dependencies.threadIndex.call(method, asRecord(params) ?? {}, (m, p) => this.call(m, p))
      const turn = asRecord(asRecord(result)?.turn)
      const turnId = readNonEmptyString(turn?.id)
      if (threadId && turnId) {
        // Metadata persistence must never turn an accepted start into a failed send.
        try {
          await this.dependencies.metadataStore.save(threadId, turnId, metadata)
        } catch (error) {
          console.warn('Failed to persist turn generation metadata', error)
        }
        this.emitNotification({ method: 'turn/generationMetadata', params: { threadId, turnId, generationMetadata: metadata } })
      }
      return turn ? { ...asRecord(result), turn: { ...turn, generationMetadata: metadata } } : result
    } finally {
      candidates.delete(metadata)
      if (candidates.size === 0) this.pendingGenerationSettings.delete(threadId)
    }
  }

  onNotification(listener: (value: { method: string; params: unknown }) => void): () => void {
    this.notificationListeners.add(listener)
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

  async reconnect(): Promise<void> {
    if (this.reconnectPromise) return this.reconnectPromise
    this.reconnectPromise = (async () => {
      await this.transport.reconnect()
      await this.ensureInitialized()
    })().finally(() => { this.reconnectPromise = null })
    return this.reconnectPromise
  }
  dispose(): void { this.transport.dispose() }
}

