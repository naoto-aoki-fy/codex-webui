import { readCollaborationMode, readGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata.js'
import { QUESTION_REPLY_NOT_SENT, QUESTION_REPLY_UNCONFIRMED, type QuestionSubmission } from '../questionResponses.js'
import { normalizePendingServerRequestMethod, QUESTION_REQUEST } from '../serverRequestMethod.js'
import {
  isQuestionToolCall, isQuestionToolOutput, questionAnswersMatch, questionRequestParams,
  questionResponseId, questionResponses, readQuestionToolAnswers, validateQuestionResponse,
  type RolloutQuestionReply,
} from './questionResponses.js'
import { CodexHomeResolver } from './codexHomeResolver.js'
import { getConnectionProfileId } from './connectionProfile.js'
import { SubscriptionRecovery } from './subscriptionRecovery.js'
import { RolloutGenerationMetadata } from './rolloutGenerationMetadata.js'
import { randomInt, randomUUID } from 'node:crypto'
import { AppServerWebSocketClient, positiveEnv } from './appServerWebSocketClient.js'
import { asRecord } from './bridgeHttpUtils.js'
import { isAbsoluteUploadPath, projectPath } from './webuiStorage.mjs'

const uploadConnectionChanged = 'App Server connection changed during upload. Retry to validate the upload destination on the new connection.'

function userHomeCommand(platform: string | undefined): string[] | undefined {
  switch (platform) {
    case 'linux':
      return ['/bin/sh', '-c', `uid=$(/usr/bin/id -u) || exit 1
/usr/bin/getent passwd "$uid" | /usr/bin/awk -F: 'NF == 7 {print $6}'`]
    case 'macos':
      return ['/bin/sh', '-c', `uid=$(/usr/bin/id -u) || exit 1
/usr/bin/dscacheutil -q user -a uid "$uid" | /usr/bin/awk '/^dir: / {print substr($0, 6)}'`]
    case 'windows':
      return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Console]::WriteLine([Environment]::GetFolderPath('UserProfile'))"]
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
  responseId?: string
  anchorItemId?: string
  answerAttempted?: boolean
}

type QuestionAttempt = {
  request: PendingServerRequest
  threadId: string
  turnId: string
  callId: string
  match: (answers: ReturnType<typeof readQuestionToolAnswers>) => void
  close: () => void
  complete: () => void
  endSubscription: () => void
  fail: () => void
}

export const STREAM_EVENT_BUFFER_LIMIT = 400

export type StreamEventFrame = {
  method: string
  params: unknown
  atIso: string
}

export class AppServerClient {
  getInitializationMetadata() { return this.transport.getInitializationMetadata() }

  private connectionGeneration = 0
  private readonly codexHome = new CodexHomeResolver(
    (method, params) => this.call(method, params),
    () => `${this.getConnectionGeneration()}:${getConnectionProfileId()}`,
  )
  async resolveCodexHome({ discover = true } = {}): Promise<string> {
    await this.ensureInitialized()
    return discover ? this.codexHome.resolve() : this.codexHome.observedHome()
  }

  private uploadUserHome: Promise<string> | undefined

  async resolveUploadUserHome(codexHome: string, generation: number): Promise<string> {
    if (generation !== this.connectionGeneration) throw new Error(uploadConnectionChanged)
    return this.uploadUserHome ??= this.discoverUploadUserHome(codexHome, generation).catch(cause => {
      if (generation === this.connectionGeneration) this.uploadUserHome = undefined
      throw Object.assign(new Error("Cannot determine the App Server OS user's home directory. Set CODEXUI_REMOTE_UPLOAD_DIR to an absolute path on the App Server outside Codex home."), { cause })
    })
  }

  private async discoverUploadUserHome(codexHome: string, generation: number): Promise<string> {
    const command = userHomeCommand(this.getInitializationMetadata()?.platformOs)
    if (!command) throw new Error('App Server did not report a supported operating system')

    // Use the App Server host process API so a sandbox account or Codex shell
    // environment overrides cannot change which OS user's home is reported.
    const processHandle = randomUUID()
    const deadlineMs = 10_000
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const exited = new Promise<Record<string, unknown>>((resolve, reject) => {
      unsubscribe = this.onNotification(({ method, params }) => {
        if (method === 'app-server/disconnected') reject(new Error('App Server disconnected during home discovery'))
        if (method !== 'process/exited') return
        const result = asRecord(params)
        if (result?.processHandle === processHandle) resolve(result)
      })
      timer = setTimeout(() => reject(new Error('App Server home discovery timed out')), deadlineMs)
      timer.unref()
    })

    try {
      const rules = projectPath(codexHome)
      const [, result] = await Promise.all([
        this.callObserved('process/spawn', {
          processHandle, command, cwd: rules.parse(codexHome).root, timeoutMs: 5_000, outputBytesCap: 8_192,
        }, deadlineMs, generation),
        exited,
      ])
      const home = typeof result.stdout === 'string' ? result.stdout.replace(/\r?\n$/u, '') : ''
      if (generation !== this.connectionGeneration || result.exitCode !== 0 || result.stdoutCapReached !== false ||
          result.outputDrainTimedOut === true || home.includes('\uFFFD') || !isAbsoluteUploadPath(home) || projectPath(home) !== rules) {
        throw new Error('App Server home lookup did not return a valid absolute directory')
      }
      return home
    } finally {
      clearTimeout(timer)
      unsubscribe?.()
    }
  }

  private readonly rolloutMetadata = new RolloutGenerationMetadata({
    rpc: (method, params) => this.call(method, params),
    generation: () => this.getConnectionGeneration(),
    home: () => this.resolveCodexHome(),
  })
  private readonly rolloutRequests = new Map<string, Set<string> | null>()
  private readonly submittedModeRequests = new Map<string, { ids: Set<string>; superseded: Set<string> }>()

  private publishGenerationMetadata(threadId: string, turnId: string, generationMetadata: TurnGenerationMetadata): void {
    if (generationMetadata.collaborationMode !== undefined) this.submittedModeRequests.get(threadId)?.superseded.add(turnId)
    this.emitNotification({ method: 'turn/generationMetadata', params: { threadId, turnId, generationMetadata } })
  }

  private recoverSubmittedModes(threadId: string, ids: Set<string>, executionIds: Set<string>): void {
    const pending = this.submittedModeRequests.get(threadId)
    if (pending) {
      for (const id of ids) pending.ids.add(id)
      for (const id of executionIds) pending.superseded.add(id)
      return
    }
    const request = { ids: new Set(ids), superseded: executionIds }
    const profileId = getConnectionProfileId()
    this.submittedModeRequests.set(threadId, request)
    void this.rolloutMetadata.readSubmittedModes(threadId, profileId).then(modes => {
      if (this.submittedModeRequests.get(threadId) !== request || getConnectionProfileId() !== profileId) return
      for (const id of request.ids) {
        const mode = modes.get(id)
        if (mode && !request.superseded.has(id)) {
          this.publishGenerationMetadata(threadId, id, { collaborationMode: mode, collaborationModeSource: 'submitted' })
        }
      }
    }).catch(() => { /* A cache miss must never break history. */ }).finally(() => {
      if (this.submittedModeRequests.get(threadId) === request) this.submittedModeRequests.delete(threadId)
    })
  }

  private recoverRolloutMetadata(threadId: string, turns: unknown[] | null, force = false, retainedTurnIds: string[] = []): void {
    const generation = this.getConnectionGeneration()
    const key = `${generation}:${threadId}:${force}`
    const ids = turns ? new Set(turns.map(turn => readNonEmptyString(asRecord(turn)?.id)).filter(Boolean)) : null
    if (ids) for (const id of retainedTurnIds) ids.add(id)
    if (ids?.size && turns) {
      const executionIds = new Set<string>()
      for (const turn of turns) {
        const row = asRecord(turn)
        const turnId = readNonEmptyString(row?.id)
        if (turnId && readGenerationMetadata(row?.generationMetadata)?.collaborationModeSource === 'execution') executionIds.add(turnId)
      }
      this.recoverSubmittedModes(threadId, ids, executionIds)
    }
    if (turns?.length === 0) return
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
      for (const [turnId, metadata] of entries) {
        if (requested && !requested.has(turnId)) continue
        // Submitted modes are published by the local read, which can overtake
        // this transfer and may contain a newer cache snapshot.
        const { collaborationMode: _mode, collaborationModeSource, ...responseMetadata } = metadata
        const execution = collaborationModeSource === 'execution' ? metadata : responseMetadata
        if (Object.keys(execution).length) this.publishGenerationMetadata(threadId, turnId, execution)
      }
    }).catch(() => { /* Metadata must never break history loading. */ }).finally(() => this.rolloutRequests.delete(key))
  }
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  private readonly notificationListeners = new Set<(value: { method: string; params: unknown }) => void>()
  private readonly questionAttempts = new Map<number | string, QuestionAttempt>()
  private readonly recentQuestionCallIds = new Set<string>()
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
    this.connectionGeneration++
    this.codexHome.reset()
    this.uploadUserHome = undefined
    this.recovery.cancel()
    this.submittedModeRequests.clear()
    for (const request of this.pending.values()) request.reject(new Error('App-server disconnected. Retry to reconnect; inspect the thread before resending a turn.'))
    this.pending.clear()
    for (const attempt of this.questionAttempts.values()) attempt.fail()
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
      if (message.method === 'rawResponseItem/completed' && this.consumeQuestionToolResult(message.params)) return
      if ((message.method === 'item/started' || message.method === 'item/completed') &&
        isQuestionToolOutput(asRecord(asRecord(message.params)?.item))) return
      if (message.method === 'serverRequest/resolved') this.closeQuestionRequest(message.params)
      if (message.method === 'turn/completed') {
        const turn = asRecord(asRecord(message.params)?.turn)
        const turnId = readNonEmptyString(turn?.id)
        if (turnId) this.retireQuestionRequests(this.extractThreadIdFromParams(message.params), turnId,
          turn?.status === 'completed' ? 'completed' : 'failed')
      }
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
    this.recordStreamEvent(notification)
    const nThreadId = this.extractThreadIdFromParams(notification.params)
    if (nThreadId && notification.method !== 'turn/generationMetadata') {
      if (notification.method === 'thread/reverted' || notification.method === 'thread/deleted') {
        this.retireQuestionRequests(nThreadId)
        this.snapshotEpoch = {}
        this.submittedModeRequests.delete(nThreadId)
        this.lastThreadReadSnapshotByThreadId.delete(nThreadId)
        this.streamEventsByThreadId.delete(nThreadId)
      }
      if (notification.method === 'thread/closed' || notification.method === 'thread/archived') {
        this.retireQuestionRequests(nThreadId, undefined, 'subscription-ended')
      }
      if (notification.method === 'turn/started') {
        const turn = asRecord(asRecord(notification.params)?.turn)
        const turnId = readNonEmptyString(turn?.id)
        if (turnId && readGenerationMetadata(turn?.generationMetadata)?.collaborationModeSource === 'execution') {
          this.submittedModeRequests.get(nThreadId)?.superseded.add(turnId)
        }
      }
      if(notification.method==='thread/deleted'){
        void questionResponses.delete(nThreadId).catch(error => console.warn('Could not remove saved question responses:', error))
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
    this.publishRequestResolution(pendingRequest)
  }

  private publishRequestResolution(request: PendingServerRequest, submission?: QuestionSubmission): void {
    this.emitNotification({
      method: 'server/request/resolved',
      params: {
        id: request.id,
        method: request.method,
        threadId: this.extractThreadIdFromParams(request.params),
        mode: 'manual',
        resolvedAtIso: new Date().toISOString(),
        ...submission,
      },
    })
  }

  private closeQuestionRequest(params: unknown): void {
    const event = asRecord(params)
    const requestId = event?.requestId
    if (typeof requestId !== 'number' && typeof requestId !== 'string') return
    for (const pending of this.pendingServerRequests.values()) {
      if (pending.method !== QUESTION_REQUEST || pending.wireId !== requestId ||
        this.extractThreadIdFromParams(pending.params) !== event?.threadId) continue
      this.pendingServerRequests.delete(pending.id)
      this.questionAttempts.get(pending.id)?.close()
      this.publishRequestResolution(pending)
      break
    }
  }

  private retireQuestionRequests(threadId: string, turnId?: string, outcome: 'completed' | 'failed' | 'subscription-ended' = 'failed'): void {
    for (const attempt of this.questionAttempts.values()) {
      if (attempt.threadId !== threadId || (turnId !== undefined && attempt.turnId !== turnId)) continue
      if (outcome === 'completed') attempt.complete()
      else if (outcome === 'subscription-ended') attempt.endSubscription()
      else attempt.fail()
    }
    for (const [id, pending] of this.pendingServerRequests) {
      const params = asRecord(pending.params)
      if (pending.method !== QUESTION_REQUEST || params?.threadId !== threadId ||
        (turnId !== undefined && params.turnId !== turnId)) continue
      this.pendingServerRequests.delete(id)
      this.publishRequestResolution(pending)
    }
  }

  private rememberQuestionCallId(callId: string): void {
    if (!callId) return
    this.recentQuestionCallIds.add(callId)
    if (this.recentQuestionCallIds.size > STREAM_EVENT_BUFFER_LIMIT) {
      this.recentQuestionCallIds.delete(this.recentQuestionCallIds.values().next().value!)
    }
  }

  private consumeQuestionToolResult(params: unknown): boolean {
    const event = asRecord(params)
    const item = asRecord(event?.item)
    const callId = readNonEmptyString(item?.call_id)
    if (isQuestionToolCall(item)) this.rememberQuestionCallId(callId)
    if (item?.type !== 'function_call_output') return isQuestionToolOutput(item)

    const answers = readQuestionToolAnswers(item.output)
    // The answer envelope also protects results for external replies or calls
    // observed before this connection subscribed to the thread.
    if (!answers && !this.recentQuestionCallIds.has(callId)) return false
    this.rememberQuestionCallId(callId)
    if (callId && answers) {
      for (const attempt of this.questionAttempts.values()) {
        if (attempt.threadId === event?.threadId && attempt.turnId === event?.turnId && attempt.callId === callId) {
          attempt.match(answers)
          break
        }
      }
    }
    return true
  }

  private submitQuestionResponse(request: PendingServerRequest, result: unknown): Promise<QuestionSubmission> {
    if (request.answerAttempted) throw new Error('This question reply has already been sent or attempted')
    const { response, result: wireResult } = validateQuestionResponse(request.responseId!, request.params, result, request.anchorItemId)
    const { threadId, turnId } = response
    const callId = readNonEmptyString(asRecord(request.params)?.itemId)
    const profileId = getConnectionProfileId()
    const generation = this.connectionGeneration
    const deadlineMs = positiveEnv('CODEXUI_APP_SERVER_RPC_DEADLINE_MS', 60_000)
    request.answerAttempted = true

    return new Promise((resolve, reject) => {
      let sent = false
      let matched = false
      let closed = false
      let completed = false
      let rolloutReply: RolloutQuestionReply | undefined
      let timer: ReturnType<typeof setTimeout>
      const retire = () => {
        if (this.questionAttempts.get(request.id) !== attempt) return false
        this.questionAttempts.delete(request.id)
        if (rolloutReply) rolloutReply.answers = undefined
        clearTimeout(timer)
        return true
      }
      const confirm = () => {
        if (!sent || !matched || generation !== this.connectionGeneration || getConnectionProfileId() !== profileId || !retire()) return
        this.pendingServerRequests.delete(request.id)
        const finish = (submission: QuestionSubmission) => {
          if (generation === this.connectionGeneration && getConnectionProfileId() === profileId) this.publishRequestResolution(request, submission)
          resolve(submission)
        }
        void questionResponses.save(response, profileId).then(
          saved => finish({ response: saved, saved: true }),
          () => finish({ response, saved: false }),
        )
      }
      const advanceConfirmation = () => {
        if (!sent || !closed || this.questionAttempts.get(request.id) !== attempt || rolloutReply) return
        clearTimeout(timer)
        if (!completed) return
        if (!callId) { attempt.fail(); return }
        timer = setTimeout(attempt.fail, deadlineMs)
        timer.unref()
        const reply: RolloutQuestionReply = { turnId, callId, answers: wireResult.answers, confirmed: false }
        rolloutReply = reply
        void this.rolloutMetadata.recover(threadId, true, reply).then(() => {
          if (reply.confirmed) {
            matched = true
            confirm()
          }
          attempt.fail()
        }, attempt.fail)
      }
      const attempt: QuestionAttempt = {
        request, threadId, turnId, callId,
        match: answers => {
          if (!answers || !questionAnswersMatch(wireResult.answers, answers)) return
          matched = true
          confirm()
        },
        close: () => {
          closed = true
          advanceConfirmation()
        },
        complete: () => {
          completed = true
          attempt.close()
        },
        endSubscription: () => {
          if (!completed) attempt.fail()
        },
        fail: () => {
          if (retire()) reject(new Error(QUESTION_REPLY_UNCONFIRMED))
        },
      }
      timer = setTimeout(attempt.fail, deadlineMs)
      timer.unref()
      this.questionAttempts.set(request.id, attempt)
      try {
        const queued = this.transport.trySend({ id: request.wireId!, result: wireResult }, error => {
          if (error) { attempt.fail(); return }
          sent = true
          confirm()
          advanceConfirmation()
        })
        if (!queued && retire()) {
          if (this.pendingServerRequests.get(request.id) !== request) {
            reject(new Error(QUESTION_REPLY_UNCONFIRMED))
            return
          }
          request.answerAttempted = false
          reject(Object.assign(new Error('Question reply was not sent. Your draft is kept. You can retry.'), {
            code: QUESTION_REPLY_NOT_SENT,
          }))
        }
      } catch { attempt.fail() }
    })
  }

  private precedingQuestionItem(params: unknown): string | undefined {
    const { threadId, turnId } = asRecord(params) ?? {}
    if (typeof threadId !== 'string' || typeof turnId !== 'string') return
    const frames = this.streamEventsByThreadId.get(threadId) ?? []
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index]!
      if (frame.method !== 'item/started' && frame.method !== 'item/completed') continue
      const itemParams = asRecord(frame.params)
      const item = asRecord(itemParams?.item)
      if (itemParams?.turnId === turnId && typeof item?.id === 'string') return item.id
    }
    const snapshot = asRecord(asRecord(this.getLastThreadReadSnapshot(threadId))?.thread)?.turns
    if (!Array.isArray(snapshot)) return
    const items = asRecord(snapshot.find(turn => asRecord(turn)?.id === turnId))?.items
    if (!Array.isArray(items)) return
    return readNonEmptyString(asRecord(items.at(-1))?.id) || undefined
  }

  private handleServerRequest(requestId: number | string, method: string, params: unknown): void {
    if (method === 'account/chatgptAuthTokens/refresh') {
      this.sendServerRequestReply(requestId, { error: {
        code: -32001,
        message: 'Client-managed token refresh is unsupported. Run codex login on the App Server host and use Codex-managed authentication there.',
      } })
      return
    }

    method = normalizePendingServerRequestMethod(method, asRecord(params))
    if (method === QUESTION_REQUEST) {
      if ([...this.pendingServerRequests.values()].some(request => request.method === QUESTION_REQUEST && request.wireId === requestId) ||
        [...this.questionAttempts.values()].some(attempt => attempt.request.wireId === requestId)) return
      params = questionRequestParams(asRecord(params))
      this.rememberQuestionCallId(readNonEmptyString(asRecord(params)?.itemId))
    }
    const pendingRequest: PendingServerRequest = {
      id: this.nextApprovalId++,
      method,
      params,
      receivedAtIso: new Date().toISOString(),
      wireId: requestId,
      ...(method === QUESTION_REQUEST ? { responseId: questionResponseId(params), anchorItemId: this.precedingQuestionItem(params) } : {}),
    }
    this.pendingServerRequests.set(pendingRequest.id, pendingRequest)

    this.emitNotification({
      method: 'server/request',
      params: { ...pendingRequest },
    })
  }

  private async call(method: string, params: unknown, deadlineMs?: number): Promise<unknown> {
    const homeToken = this.codexHome.token()
    const result = await this.callObserved(method, params, deadlineMs)
    if (method === 'thread/read') this.codexHome.observeThreadRead(result, homeToken)
    return result
  }

  uploadRpc(method: 'fs/getMetadata' | 'fs/createDirectory' | 'fs/writeFile', params: unknown, generation: number): Promise<unknown> {
    return this.callObserved(method, params, undefined, generation)
  }

  private async callObserved(method: string, params: unknown, deadlineMs?: number, expectedGeneration?: number): Promise<unknown> {
    await this.ensureInitialized()
    if (expectedGeneration !== undefined && expectedGeneration !== this.connectionGeneration) {
      throw new Error(uploadConnectionChanged)
    }
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

  async rpc(method: string, params: unknown, retainedTurnIds: string[] = []): Promise<unknown> {
    const homeToken = this.codexHome.token()
    await this.ensureInitialized()
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
    if (method === 'turn/start') {
      const mode = readCollaborationMode(asRecord(asRecord(params)?.collaborationMode)?.mode)
      const turnId = readNonEmptyString(asRecord(record?.turn)?.id)
      if (mode && resumeId && turnId) {
        const generation = this.connectionGeneration
        try {
          const generationMetadata = await this.rolloutMetadata.rememberSubmittedMode(resumeId, turnId, mode, getConnectionProfileId())
          if (generationMetadata && generation === this.connectionGeneration) {
            this.publishGenerationMetadata(resumeId, turnId, generationMetadata)
          }
        } catch { /* A best-effort cache write must never change native acceptance. */ }
      }
    }
    if (method === 'thread/turns/list' && Array.isArray(record?.data)) {
      if ((record.data.length || retainedTurnIds.length) && asRecord(params)?.itemsView !== 'notLoaded') {
        this.recoverRolloutMetadata(resumeId, record.data, false, retainedTurnIds)
      }
    }
    const thread = asRecord(record?.thread)
    if (thread && typeof thread.id === 'string' && Array.isArray(thread.turns)) {
      if (thread.turns.length && ['thread/read', 'thread/resume', 'thread/fork'].includes(method)) this.recoverRolloutMetadata(thread.id, thread.turns)
    }
    if (method === 'thread/revert') {
      this.snapshotEpoch = {}
      const id = readNonEmptyString(asRecord(params)?.threadId)
      this.retireQuestionRequests(id)
      this.submittedModeRequests.delete(id)
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
      this.retireQuestionRequests(id, undefined, 'subscription-ended')
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

  async respondToServerRequest(payload: unknown): Promise<QuestionSubmission | undefined> {
    await this.ensureInitialized()

    const body = asRecord(payload)
    if (!body) {
      throw new Error('Invalid response payload: expected object')
    }

    const id = body.id
    if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isInteger(id))) {
      throw new Error('Invalid response payload: "id" must be an integer')
    }

    const pending = this.pendingServerRequests.get(id)
    if (pending?.method === QUESTION_REQUEST) {
      if ('error' in body) throw new Error('A question request requires answers')
      return this.submitQuestionResponse(pending, body.result)
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
    this.recovery.cancel()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.transport.dispose()
  }
}

