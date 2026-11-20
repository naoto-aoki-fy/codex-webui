import { questionResponses } from './questionResponses.js'
import { ModelPreferencesStore } from './modelPreferencesStore.js'
import { createModelPreferenceUsage } from './modelPreferenceUsage.js'
import type { ModelPreferences } from '../modelPreferences.js'
import { createConversationTransfers } from './conversationTransfer.js'
import { getConnectionProfileId } from './connectionProfile.js'
import { stageRemoteUpload } from './remoteUploads.js'
import { projectPath, ProjectFileService } from './appServerFileSystem.js'
import { handleSseRequest } from './bridgeSse.js'
import { readPinnedThreadIds } from './nativeThreadPins.js'
import { asRecord, getErrorMessage, setJson, readJsonBody, isEmptyThreadReadError, isThreadMaterializationPendingError } from './bridgeHttpUtils.js'
export { isEmptyThreadReadError, isThreadMaterializationPendingError } from './bridgeHttpUtils.js'
import { sanitizeThreadTurnsInlinePayloads, THREAD_METHODS_WITH_TURNS } from './threadInlinePayloads.js'
export { sanitizeThreadTurnsInlinePayloads } from './threadInlinePayloads.js'
import { AppServerClient, STREAM_EVENT_BUFFER_LIMIT, type StreamEventFrame } from './appServerClient.js'
export { AppServerClient } from './appServerClient.js'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { publicAccountStatus, publicLoginChallenge } from './publicAccount.js'
import { handleSkillsRoutes } from './skillsRoutes.js'

type RpcProxyRequest = {
  method: string
  params?: unknown
}

type RpcExecutor = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

const THREAD_RESPONSE_TURN_LIMIT = 10
const THREAD_METHODS_WITH_THREAD_SNAPSHOT = new Set([...THREAD_METHODS_WITH_TURNS, 'thread/start'])
const API_PERF_LOGGING_ENV_KEY = 'CODEXUI_API_PERF_LOGGING'
const API_PERF_MS_THRESHOLD_ENV_KEY = 'CODEXUI_API_PERF_MS_THRESHOLD'
const API_PERF_BODY_MB_THRESHOLD_ENV_KEY = 'CODEXUI_API_PERF_BODY_MB_THRESHOLD'
const DEFAULT_API_PERF_MS_THRESHOLD = 300
const DEFAULT_API_PERF_BODY_MB_THRESHOLD = 1
const MB_DIVISOR = 1024 * 1024

function readEnvValueFromFile(filePath: string, key: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf8')
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+)\\s*$`, 'm'))
    if (!match) return null
    const rawValue = match[1]?.trim() ?? ''
    if (!rawValue) return null
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith('\'') && rawValue.endsWith('\''))) {
      return rawValue.slice(1, -1).trim()
    }
    return rawValue
  } catch {
    return null
  }
}

function parseBooleanEnvFlag(value: string | null | undefined): boolean | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function resolveApiPerfLoggingEnabled(): boolean {
  const explicitValue = parseBooleanEnvFlag(process.env[API_PERF_LOGGING_ENV_KEY])
  if (explicitValue !== null) return explicitValue

  const fromEnvLocal = parseBooleanEnvFlag(readEnvValueFromFile('.env.local', API_PERF_LOGGING_ENV_KEY))
  if (fromEnvLocal !== null) return fromEnvLocal

  const fromEnv = parseBooleanEnvFlag(readEnvValueFromFile('.env', API_PERF_LOGGING_ENV_KEY))
  if (fromEnv !== null) return fromEnv

  return false
}

const API_PERF_LOGGING_ENABLED = resolveApiPerfLoggingEnabled()

function parseNumberEnvFlag(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function resolveNumericEnvConfig(envKey: string, fallback: number): number {
  const fromProcess = parseNumberEnvFlag(process.env[envKey])
  if (fromProcess !== null) return fromProcess

  const fromEnvLocal = parseNumberEnvFlag(readEnvValueFromFile('.env.local', envKey))
  if (fromEnvLocal !== null) return fromEnvLocal

  const fromEnv = parseNumberEnvFlag(readEnvValueFromFile('.env', envKey))
  if (fromEnv !== null) return fromEnv

  return fallback
}

const API_PERF_MS_THRESHOLD = resolveNumericEnvConfig(API_PERF_MS_THRESHOLD_ENV_KEY, DEFAULT_API_PERF_MS_THRESHOLD)
const API_PERF_BODY_MB_THRESHOLD = resolveNumericEnvConfig(API_PERF_BODY_MB_THRESHOLD_ENV_KEY, DEFAULT_API_PERF_BODY_MB_THRESHOLD)

function getChunkByteLength(chunk: unknown, encoding?: BufferEncoding): number {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, encoding)
  }
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength
  }
  if (ArrayBuffer.isView(chunk)) {
    return chunk.byteLength
  }
  if (chunk instanceof ArrayBuffer) {
    return chunk.byteLength
  }
  return 0
}

function trimThreadTurnsInRpcResult(method: string, result: unknown): unknown {
  if (!THREAD_METHODS_WITH_TURNS.has(method)) return result

  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !turns || turns.length <= THREAD_RESPONSE_TURN_LIMIT) return result

  return {
    ...record,
    thread: {
      ...thread,
      turns: turns.slice(-THREAD_RESPONSE_TURN_LIMIT),
    },
  }
}

function readStreamTurnId(params: Record<string, unknown>): string {
  const directTurnId = readNonEmptyString(params.turnId) || readNonEmptyString(params.turn_id)
  if (directTurnId) return directTurnId
  const turn = asRecord(params.turn)
  return readNonEmptyString(turn?.id)
}

function readStreamTurnErrorMessage(frame: StreamEventFrame): { turnId: string; message: string } | null {
  const params = asRecord(frame.params)
  if (!params) return null
  const turnId = readStreamTurnId(params)
  if (!turnId) return null

  if (frame.method === 'turn/completed') {
    const turn = asRecord(params.turn)
    if (turn?.status !== 'failed') return null
    const message = getErrorMessage(turn.error, '')
    return message ? { turnId, message } : null
  }

  if (frame.method === 'error' && params.willRetry !== true) {
    const message = getErrorMessage(params.error, '') || readNonEmptyString(params.message)
    return message ? { turnId, message } : null
  }

  return null
}

function mergeStreamTurnErrorsIntoThreadResult(appServer: AppServerClient, result: unknown): unknown {
  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const threadId = readNonEmptyString(thread?.id)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !threadId || !turns || turns.length === 0) return result

  const errorsByTurnId = new Map<string, string>()
  for (const frame of appServer.getStreamEvents(threadId, STREAM_EVENT_BUFFER_LIMIT)) {
    const error = readStreamTurnErrorMessage(frame)
    if (error) errorsByTurnId.set(error.turnId, error.message)
  }
  if (errorsByTurnId.size === 0) return result

  let changed = false
  const mergedTurns = turns.map((turn) => {
    const turnRecord = asRecord(turn)
    const turnId = readNonEmptyString(turnRecord?.id)
    const message = turnId ? errorsByTurnId.get(turnId) : ''
    if (!turnRecord || !turnId || !message) return turn
    const existingErrorMessage = getErrorMessage(turnRecord.error, '')
    if (turnRecord.status === 'failed' && existingErrorMessage) return turn
    changed = true
    return {
      ...turnRecord,
      status: 'failed',
      error: {
        message,
        codexErrorInfo: null,
        additionalDetails: null,
      },
    }
  })

  if (!changed) return result
  return {
    ...record,
    thread: {
      ...thread,
      turns: mergedTurns,
    },
  }
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : ''
}

function readThreadArchiveFallbackName(threadReadResult: unknown): string {
  const record = asRecord(threadReadResult)
  const thread = asRecord(record?.thread)
  return (
    readNonEmptyString(thread?.name)
    || readNonEmptyString(thread?.title)
    || readNonEmptyString(thread?.preview)
    || 'Untitled thread'
  )
}

function isArchivedThreadReadResult(threadReadResult: unknown): boolean {
  const record = asRecord(threadReadResult)
  const thread = asRecord(record?.thread)
  const sessionPath = readNonEmptyString(thread?.path)
  return sessionPath.split(/[\\/]+/u).includes('archived_sessions')
}

export async function forkThreadAtCutoff(appServer: RpcExecutor, params: Record<string, unknown>): Promise<unknown> {
  const { turnId, ...forkParams } = params
  if (typeof turnId !== 'string' || !turnId.trim()) throw new Error('Missing response turn ID')
  const source = asRecord(await callRpcWithArchiveRecovery(appServer, 'thread/read', {
    threadId: params.threadId, includeTurns: true,
  }))
  const sourceTurns = asRecord(source?.thread)?.turns
  const cutoff = Array.isArray(sourceTurns) ? sourceTurns.findIndex(turn => asRecord(turn)?.id === turnId) : -1
  if (cutoff < 0 || !Array.isArray(sourceTurns)) throw new Error('Source history changed at the selected response. Refresh the thread.')
  const prefix = sourceTurns.slice(0, cutoff + 1)
  const ids = prefix.map(turn => readNonEmptyString(asRecord(turn)?.id))
  if (ids.length !== cutoff + 1 || ids.some(id => !id)) {
    throw new Error('Fork response cutoff is outside the source history')
  }
  const cutoffParams = { ...forkParams, lastTurnId: ids[cutoff] }
  const result = await callRpcWithArchiveRecovery(appServer, 'thread/fork', cutoffParams)
  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const id = readNonEmptyString(thread?.id)
  if (!id || id === readNonEmptyString(params.threadId)) throw new Error('Invalid fork thread id')
  try {
    // Read durable history too: an ignored lastTurnId must never look successful.
    const persisted = asRecord(await appServer.rpc('thread/read', { threadId: id, includeTurns: true }))
    for (const snapshot of [thread, asRecord(persisted?.thread)]) {
      const turns = snapshot?.turns
      if (!Array.isArray(turns) || turns.length !== ids.length
        || turns.some((turn, index) => readNonEmptyString(asRecord(turn)?.id) !== ids[index])) {
        throw new Error('Response fork cutoff was not applied by the app-server')
      }
    }
    return { ...record, forkCutoff: { sourceThreadId: params.threadId, turnId } }
  } catch (error) {
    try {
      await callRpcWithArchiveRecovery(appServer, 'thread/archive', { threadId: id })
    } catch (cleanupError) {
      throw new Error(`${getErrorMessage(error, 'Fork failed')}; failed to archive incomplete fork ${id}: ${getErrorMessage(cleanupError, 'unknown error')}`)
    }
    throw error
  }
}

async function readRecentThread(appServer: AppServerClient, method: 'thread/read' | 'thread/resume', params: Record<string, unknown>): Promise<unknown> {
  const threadId = readNonEmptyString(params.threadId)
  const snapshotEpoch = appServer.getSnapshotEpoch()
  const { retainedTurnIds, ...nativeParams } = params
  const metadata = asRecord(await appServer.rpc(method, {
    ...nativeParams,
    ...(method === 'thread/read' ? { includeTurns: false } : { excludeTurns: true }),
  }))
  const thread = asRecord(metadata?.thread)
  if (!threadId || thread?.id !== threadId) throw new Error('Invalid thread metadata in history response')

  try {
    const page = asRecord(await appServer.rpc('thread/turns/list', {
      threadId, sortDirection: 'desc', itemsView: 'full', limit: THREAD_RESPONSE_TURN_LIMIT,
    }))
    if (!Array.isArray(page?.data) || (page.nextCursor != null && typeof page.nextCursor !== 'string')) {
      throw new Error('Invalid native history page')
    }
    if (snapshotEpoch !== appServer.getSnapshotEpoch()) throw new Error('History changed while loading. Refresh the thread.')
    const responses = await readQuestionResponses(threadId, page.data, retainedTurnIds)
    if (snapshotEpoch !== appServer.getSnapshotEpoch()) throw new Error('History changed while loading. Refresh the thread.')
    return {
      ...metadata, thread: { ...thread, turns: [...page.data].reverse() }, olderCursor: page.nextCursor ?? null,
      ...(responses.length ? { questionResponses: responses } : {}),
    }
  } catch (error) {
    if ((error as { code?: number } | null)?.code === -32601) {
      throw new Error('Connected Codex server lacks thread/turns/list. Upgrade Codex.')
    }
    if (isThreadMaterializationPendingError(error)) {
      return { ...metadata, thread: { ...thread, turns: [] }, olderCursor: null }
    }
    throw error
  }
}

function readRetainedTurnIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 256) : []
}

function readQuestionResponses(threadId: string, turns: unknown[], retained?: unknown) {
  const turnIds = new Set(turns.map(turn => readNonEmptyString(asRecord(turn)?.id)).filter(Boolean))
  for (const id of readRetainedTurnIds(retained)) turnIds.add(id)
  return questionResponses.read(threadId, turnIds)
}

async function presentTurnPage(appServer: AppServerClient, threadId: string, result: unknown, includeResponses: boolean): Promise<unknown> {
  const page = asRecord(result)
  if (!threadId || !Array.isArray(page?.data)) return result
  // Reuse the existing native thread presentation for each page's items and buffered errors.
  const wrapped = { thread: { id: threadId, turns: page.data } }
  const presented = asRecord(await sanitizeThreadTurnsInlinePayloads('thread/read', mergeStreamTurnErrorsIntoThreadResult(appServer, wrapped)))
  const responses = includeResponses ? await readQuestionResponses(threadId, page.data) : []
  return { ...page, data: asRecord(presented?.thread)?.turns, ...(responses.length ? { questionResponses: responses } : {}) }
}

export async function callRpcWithArchiveRecovery(
  appServer: RpcExecutor,
  method: string,
  params: unknown,
): Promise<unknown> {
  try {
    const result = await appServer.rpc(method, params ?? null)
    if (method === 'thread/search') {
      const page = asRecord(result)
      if (Array.isArray(page?.data)) {
        const rows = page.data.map(asRecord)
        const normalized = asRecord({
          data: rows.map(row => {
            const thread = asRecord(row?.thread)
            const environments = Array.isArray(thread?.environments) ? thread.environments : []
            const cwd = typeof thread?.cwd === 'string' ? thread.cwd
              : environments.map(asRecord).find(env => typeof env?.cwd === 'string')?.cwd ?? ''
            return { ...thread, cwd }
          }),
        })
        const threads = normalized?.data as unknown[]
        return { ...page, data: rows.map((row, index) => ({ ...row, thread: threads[index] })) }
      }
    }
    return result
  } catch (error) {
    if (method !== 'thread/archive') {
      throw error
    }

    const threadId = readNonEmptyString(asRecord(params)?.threadId)
    const errorMessage = getErrorMessage(error, '')
    if (!threadId || !errorMessage.includes('no rollout found')) {
      throw error
    }

    let threadReadResult: unknown = null
    try {
      threadReadResult = await appServer.rpc('thread/read', {
        threadId,
        includeTurns: false,
      })
      if (isArchivedThreadReadResult(threadReadResult)) {
        return null
      }
    } catch {
      // If metadata cannot be read, still try materializing a title before retrying archive.
    }

    await appServer.rpc('thread/name/set', {
      threadId,
      name: readThreadArchiveFallbackName(threadReadResult),
    })
    return appServer.rpc(method, params ?? null)
  }
}

function handleFileUpload(req: IncomingMessage, res: ServerResponse, appServer: AppServerClient): void {
  const chunks: Buffer[] = []
  let size = 0
  let oversized = false
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > 21 * 1024 * 1024) { oversized = true; chunks.length = 0 }
    else if (!oversized) chunks.push(chunk)
  })
  req.on('end', async () => {
    try {
      if (oversized) { setJson(res, 413, { error: 'Upload exceeds 20 MiB file limit' }); return }
      const body = Buffer.concat(chunks)
      const contentType = req.headers['content-type'] ?? ''
      const boundaryMatch = contentType.match(/boundary=(.+)/i)
      if (!boundaryMatch) { setJson(res, 400, { error: 'Missing multipart boundary' }); return }
      const boundary = boundaryMatch[1]
      const boundaryBuf = Buffer.from(`--${boundary}`)
      const parts: Buffer[] = []
      let searchStart = 0
      while (searchStart < body.length) {
        const idx = body.indexOf(boundaryBuf, searchStart)
        if (idx < 0) break
        if (searchStart > 0) parts.push(body.subarray(searchStart, idx))
        searchStart = idx + boundaryBuf.length
        if (body[searchStart] === 0x0d && body[searchStart + 1] === 0x0a) searchStart += 2
      }
      let fileName = 'uploaded-file'
      let fileData: Buffer | null = null
      const headerSep = Buffer.from('\r\n\r\n')
      for (const part of parts) {
        const headerEnd = part.indexOf(headerSep)
        if (headerEnd < 0) continue
        const headers = part.subarray(0, headerEnd).toString('utf8')
        const fnMatch = headers.match(/filename="([^"]+)"/i)
        if (!fnMatch) continue
        fileName = fnMatch[1].replace(/[/\\]/g, '_')
        let end = part.length
        if (end >= 2 && part[end - 2] === 0x0d && part[end - 1] === 0x0a) end -= 2
        fileData = part.subarray(headerEnd + 4, end)
        break
      }
      if (!fileData) { setJson(res, 400, { error: 'No file in request' }); return }
      const destPath = await stageRemoteUpload(appServer, fileName, fileData)
      setJson(res, 200, { path: destPath })
    } catch (err) {
      setJson(res, 500, { error: getErrorMessage(err, 'Upload failed') })
    }
  })
  req.on('error', (err: Error) => {
    setJson(res, 500, { error: getErrorMessage(err, 'Upload stream error') })
  })
}

type CodexBridgeMiddleware = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  files: ProjectFileService
  dispose: () => void
  subscribeNotifications: (listener: (value: { method: string; params: unknown; atIso: string }) => void) => () => void
}

type SharedBridgeState = {
  // Stored on the shared object so ownership survives compatible module reloads.
  owners?: number
  retired?: boolean
  version: string
  appServer: AppServerClient
  files: ProjectFileService
  modelPreferences?: ModelPreferencesStore
  modelPreferenceUsage?: ReturnType<typeof createModelPreferenceUsage>
  preferenceListeners?: Set<(state: ModelPreferences) => void>
  preferenceErrorListeners?: Set<(message: string) => void>
}

const SHARED_BRIDGE_KEY = '__codexRemoteSharedBridge__'
const SHARED_BRIDGE_VERSION = 'external-websocket-files-v5'

function disposeSharedBridgeState(state: SharedBridgeState): void {
  if (state.retired) return
  state.retired = true
  state.appServer.dispose()
}

function getSharedBridgeState(): SharedBridgeState {
  const globalScope = globalThis as typeof globalThis & {
    [SHARED_BRIDGE_KEY]?: SharedBridgeState
  }

  const existing = globalScope[SHARED_BRIDGE_KEY]
  if (existing) {
    if (existing.version === SHARED_BRIDGE_VERSION && !existing.retired) {
      return existing
    }
    disposeSharedBridgeState(existing)
  }

  const appServer = new AppServerClient()
  const created: SharedBridgeState = {
    version: SHARED_BRIDGE_VERSION,
    appServer,
    files: new ProjectFileService(appServer),
  }
  globalScope[SHARED_BRIDGE_KEY] = created
  return created
}

export function createCodexBridgeMiddleware(): CodexBridgeMiddleware {
  const connectionProfile = getConnectionProfileId()
  const sharedState = getSharedBridgeState()
  sharedState.owners = (sharedState.owners ?? 0) + 1
  let released = false
  const activeSse = new Set<() => void>()
  const { appServer } = sharedState
  const modelPreferences = sharedState.modelPreferences ??= new ModelPreferencesStore()
  const modelPreferenceUsage = sharedState.modelPreferenceUsage ??= createModelPreferenceUsage(modelPreferences)
  const preferenceListeners = sharedState.preferenceListeners ??= new Set()
  const preferenceErrorListeners = sharedState.preferenceErrorListeners ??= new Set()
  const publishPreferences = (state: ModelPreferences) => {
    for (const listener of preferenceListeners) {
      try { listener({ ...state, connectionProfile }) } catch { /* A closed browser must not fail a committed update. */ }
    }
  }
  const transfers = createConversationTransfers((method, params) => appServer.rpc(method, params))
  const files = sharedState.files ?? new ProjectFileService(appServer)
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const requestStartNs = process.hrtime.bigint()
    const rawUrl = req.url ?? ''
    const parsedRequestUrl = rawUrl ? new URL(rawUrl, 'http://localhost') : null
    const requestPath = parsedRequestUrl?.pathname ?? ''
    const requestMethod = req.method ?? 'UNKNOWN'
    const rawContentLength = Array.isArray(req.headers['content-length'])
      ? req.headers['content-length'][0]
      : req.headers['content-length']
    const parsedContentLength = rawContentLength ? Number.parseInt(rawContentLength, 10) : NaN
    let requestBodyBytes: number | null = Number.isFinite(parsedContentLength) && parsedContentLength >= 0
      ? parsedContentLength
      : null
    let responseBodyBytes = 0
    let rpcMethod: string | null = null
    const originalWrite = res.write.bind(res)
    const originalEnd = res.end.bind(res)
    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      const resolvedEncoding = typeof encoding === 'string' ? encoding as BufferEncoding : undefined
      responseBodyBytes += getChunkByteLength(chunk, resolvedEncoding)
      return originalWrite(chunk as never, encoding as never, cb as never)
    }) as typeof res.write
    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      const resolvedEncoding = typeof encoding === 'string' ? encoding as BufferEncoding : undefined
      responseBodyBytes += getChunkByteLength(chunk, resolvedEncoding)
      return originalEnd(chunk as never, encoding as never, cb as never)
    }) as typeof res.end
    let didLog = false
    const logApiRequestDuration = () => {
      if (!API_PERF_LOGGING_ENABLED || didLog || !requestPath.startsWith('/codex-api/')) return
      const durationMs = Number((process.hrtime.bigint() - requestStartNs) / 1_000_000n)
      const requestBytes = requestBodyBytes ?? 0
      const bodyMbValue = (requestBytes + responseBodyBytes) / MB_DIVISOR
      const shouldLog = durationMs > API_PERF_MS_THRESHOLD || bodyMbValue > API_PERF_BODY_MB_THRESHOLD
      if (!shouldLog) return
      didLog = true
      const rpcPart = rpcMethod ? `, rpcMethod=${rpcMethod}` : ''
      console.info(`[codex-api-perf] ${requestMethod} ${requestPath} -> ${res.statusCode} (${durationMs}ms, bodyMB=${bodyMbValue.toFixed(1)}${rpcPart})`)
    }
    res.once('finish', logApiRequestDuration)
    res.once('close', logApiRequestDuration)

    try {
      if (!req.url) {
        next()
        return
      }

      const url = new URL(req.url, 'http://localhost')

      if (req.method === 'GET' && url.pathname === '/codex-api/connection-profile') {
        res.setHeader('Cache-Control', 'no-store')
        setJson(res, 200, { connectionProfile })
        return
      }

      if (await handleSkillsRoutes(req, res, url, { appServer, readJsonBody })) {
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/upload-file') {
        handleFileUpload(req, res, appServer)
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/rpc') {
        const payload = await readJsonBody(req)
        const body = asRecord(payload) as RpcProxyRequest | null
        if (payload !== null && payload !== undefined) {
          requestBodyBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
        }
        rpcMethod = body?.method && typeof body.method === 'string' ? body.method : null

	        if (!body || typeof body.method !== 'string' || body.method.length === 0) {
	          setJson(res, 400, { error: 'Invalid body: expected { method, params? }' })
	          return
	        }

        if (body.method.startsWith('model-preferences/')) {
          const result = body.method === 'model-preferences/read' ? await modelPreferences.read()
            : body.method === 'model-preferences/update' ? await modelPreferences.update(body.params)
            : null
          if (!result) { setJson(res, 400, { error: 'Unknown model preferences method' }); return }
          if (body.method !== 'model-preferences/read') publishPreferences(result)
          setJson(res, 200, { result: { ...result, connectionProfile } })
          return
        }

        if (body.method === 'getAuthStatus' || body.method.startsWith('account/chatgptAuthTokens/')
          || body.method.startsWith('accountSession/')) {
          setJson(res, 403, { error: 'Account credentials and sessions are managed on the App Server host.' })
          return
        }

        if (body.method === 'account/read') {
          const account = await appServer.rpc('account/read', { refreshToken: false })
          setJson(res, 200, { result: publicAccountStatus(account) })
          return
        }

        if (body.method === 'account/login/start') {
          const type = asRecord(body.params)?.type
          if (type !== 'chatgpt' && type !== 'chatgptDeviceCode') {
            setJson(res, 502, { error: 'Only Codex-managed ChatGPT sign-in is available through WebUI', rpcCode: -32602 })
            return
          }
          try {
            const result = await appServer.rpc(body.method, { type })
            setJson(res, 200, { result: publicLoginChallenge(result, type) })
          } catch (error) {
            const code = asRecord(error)?.code
            setJson(res, 502, {
              error: getErrorMessage(error, 'Native sign-in failed'),
              ...(typeof code === 'number' ? { rpcCode: code } : {}),
            })
          }
          return
        }

        if (body.method.startsWith('conversation-transfer/')) {
          const params = asRecord(body.params) ?? {}
          const result = body.method === 'conversation-transfer/prepare'
            ? await transfers.prepare(readNonEmptyString(params.threadId), params.target as import('../types/codex.js').ResponseForkTarget | undefined, params.revertTarget as import('../types/codex.js').PortableRevertTarget | undefined)
            : body.method === 'conversation-transfer/status'
              ? await transfers.status(readNonEmptyString(params.id))
            : body.method === 'conversation-transfer/cancel'
              ? await transfers.cancel(readNonEmptyString(params.id))
              : body.method === 'conversation-transfer/create'
                ? await transfers.create(readNonEmptyString(params.id), readNonEmptyString(params.model), readNonEmptyString(params.modelProvider))
                : null
          setJson(res, 200, { result })
          return
        }
        if (body.method === 'turn/start') await transfers.assertReady(readNonEmptyString(asRecord(body.params)?.threadId))

        if (body.method === 'thread/start') {
          const cwd = readNonEmptyString(asRecord(body.params)?.cwd)
          if (!cwd) {
            setJson(res, 400, { error: 'Select an existing workspace on the App Server host before starting a conversation.' })
            return
          }
          try {
            if (!(await files.getMetadata(cwd)).isDirectory) {
              setJson(res, 400, { error: 'The remote workspace path is not a directory.' })
              return
            }
          } catch (error) {
            const guidance = asRecord(error)?.code === -32601
              ? 'Upgrade the remote Codex App Server. This version does not support the directory validation required to start a conversation.'
              : 'Could not validate the workspace. Check the directory, permissions and connection on the App Server host before retrying.'
            setJson(res, 502, { error: `${guidance} ${getErrorMessage(error, 'Directory validation failed.')}` })
            return
          }
        }

        const responseFork = body.method === 'thread/fork-at-response'
        if (responseFork) body.method = 'thread/fork'

        const snapshotEpoch = appServer.getSnapshotEpoch()
        let rpcResult: unknown
        try {
          if(body.method==='thread/delete')await transfers.assertNativeDeletion(readNonEmptyString(asRecord(body.params)?.threadId))
          const params = asRecord(body.params)
          rpcResult = responseFork
            ? await forkThreadAtCutoff(appServer, params ?? {})
            : params && ((body.method === 'thread/read' && params.includeTurns === true)
              || (body.method === 'thread/resume' && params.excludeTurns !== true && params.initialTurnsPage == null))
              ? await readRecentThread(appServer, body.method, params)
              : await callRpcWithArchiveRecovery(appServer, body.method, body.params ?? null)
        } catch (error) {
		          // Metadata-only reads authorize safety-sensitive actions. A cached
		          // idle snapshot is not current activity evidence after a read failure.
		          if (body.method === 'thread/read' && asRecord(body.params)?.includeTurns !== false && isEmptyThreadReadError(error)) {
		            const params = asRecord(body.params)
		            const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : ''
		            const snapshot = threadId ? appServer.getLastThreadReadSnapshot(threadId) : null
		            if (snapshot) {
		              setJson(res, 200, { result: snapshot })
		              return
		            }
		          }
          if (body.method === 'thread/read' && isThreadMaterializationPendingError(error)) {
            const params = asRecord(body.params)
            const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : ''
            if (threadId) {
              setJson(res, 200, {
                result: {
                  thread: {
                    id: threadId,
                    turns: [],
                    status: { type: 'inProgress' },
                  },
                },
              })
              return
            }
          }
          if (body.method.startsWith('project/') || ['turn/start', 'turn/steer', 'account/usage/read', 'thread/compact/start', 'thread/delete', 'review/start', 'thread/queue/add', 'thread/queue/update', 'thread/queue/delete', 'thread/queue/reorder', 'thread/queue/start', 'thread/settings/update', 'account/login/cancel', 'account/logout'].includes(body.method)) {
            setJson(res, 502, { error: getErrorMessage(error, body.method === 'account/usage/read' ? 'Account usage unavailable' : `Native ${body.method} request failed`), ...(typeof asRecord(error)?.code === 'number' ? { rpcCode: asRecord(error)!.code } : {}) })
            return
          }
          throw error
		        }
        const trimmedResult = trimThreadTurnsInRpcResult(body.method, rpcResult)
        const errorMergedResult = THREAD_METHODS_WITH_TURNS.has(body.method)
          ? mergeStreamTurnErrorsIntoThreadResult(appServer, trimmedResult)
          : trimmedResult
        modelPreferenceUsage.observe(body.method, rpcResult)
        if (body.method === 'turn/start') {
          try {
            const preferences = await modelPreferenceUsage.accepted(body.params, rpcResult, (method, params) => appServer.rpc(method, params))
            if (preferences) publishPreferences(preferences)
          } catch (error) {
            // Acceptance must remain successful: retrying here could submit a duplicate turn.
            console.warn('Accepted turn model preferences were not persisted:', error)
            for (const listener of preferenceErrorListeners) {
              try { listener(getErrorMessage(error, 'Model preferences could not be saved')) } catch { /* Other clients still receive the failure. */ }
            }
          }
        }

        const sanitizedResult = body.method === 'thread/turns/list'
          ? await presentTurnPage(appServer, readNonEmptyString(asRecord(body.params)?.threadId), rpcResult, asRecord(body.params)?.itemsView !== 'notLoaded')
          : await sanitizeThreadTurnsInlinePayloads(body.method, errorMergedResult)
        if (body.method === 'thread/start' && asRecord(body.params)?.projectId) {
          const expected = asRecord(body.params)!.projectId
          const thread = asRecord(asRecord(rpcResult)?.thread)
          if (thread?.projectId !== expected) throw new Error(`thread/start did not confirm native project ${expected}; inspect destination ${thread?.id || '(unknown)'} before retrying`)
        }
        const result = asRecord(asRecord(sanitizedResult)?.thread)
          ? await transfers.decorate(sanitizedResult)
          : sanitizedResult

	        if (THREAD_METHODS_WITH_THREAD_SNAPSHOT.has(body.method) && !asRecord(body.params)?.excludeTurns && snapshotEpoch === appServer.getSnapshotEpoch()) {
	          const rpcRecord = asRecord(result)
	          const rpcThread = asRecord(rpcRecord?.thread)
	          const rpcThreadId = typeof rpcThread?.id === 'string' ? rpcThread.id : ''
          if (rpcThreadId) {
            appServer.storeThreadReadSnapshot(rpcThreadId, result)
          }
        }

        setJson(res, 200, { result })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/server-requests/respond') {
        const payload = await readJsonBody(req)
        const submission = await appServer.respondToServerRequest(payload)
        setJson(res, 200, { ok: true, ...submission })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending') {
        setJson(res, 200, { data: appServer.listPendingServerRequests() })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/home-directory') {
        setJson(res, 200, { data: { path: process.env.CODEXUI_REMOTE_INITIAL_DIRECTORY?.trim() || '' } })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/composer-file-search') {
        const payload = asRecord(await readJsonBody(req))
        const rawCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : ''
        const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
        const limitRaw = typeof payload?.limit === 'number' ? payload.limit : 20
        const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))
        if (!rawCwd) {
          setJson(res, 400, { error: 'Missing cwd' })
          return
        }
        const cwd = rawCwd
        if (!projectPath(cwd).isAbsolute(cwd)) throw new Error('Expected absolute remote workspace path')
        const info = await files.getMetadata(cwd)
        if (!info.isDirectory) {
          setJson(res, 400, { error: 'cwd is not a directory' })
          return
        }

        try {
          const found = await appServer.rpc('fuzzyFileSearch', { query, roots: [cwd], cancellationToken: null }) as { files: Array<{ path: string }> }
          if (!Array.isArray(found?.files) || found.files.some(file => typeof file?.path !== 'string' || !file.path)) {
            throw new Error('Incompatible fuzzyFileSearch response: expected file paths')
          }
          setJson(res, 200, { data: found.files.slice(0, limit).map(file => ({ path: file.path })) })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to search files') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-pins') {
        const threadIds = await readPinnedThreadIds((method, params) => appServer.rpc(method, params))
        setJson(res, 200, { data: { threadIds } })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/reconnect') {
        await appServer.reconnect()
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/events') {
        if (released) {
          res.end()
          return
        }
        handleSseRequest(req, res, middleware.subscribeNotifications, dispose => {
          // Setup can reenter middleware disposal through stream/subscription callbacks.
          if (released) dispose()
          else activeSse.add(dispose)
        }, dispose => activeSse.delete(dispose))
        return
      }

      // API misses must not reach Vite or the production SPA fallback.
      if (url.pathname === '/codex-api' || url.pathname.startsWith('/codex-api/')) {
        setJson(res, 404, { error: 'Not found' })
        return
      }
      next()
    } catch (error) {
      const message = getErrorMessage(error, 'Unknown bridge error')
      setJson(res, 502, { error: message })
    }
  }

  middleware.files = sharedState.files
  middleware.dispose = () => {
    if (released) return
    released = true
    // A failing stream must not prevent other streams or the runtime from releasing.
    for (const dispose of activeSse) {
      try { dispose() } catch { /* Request cleanup is best effort during owner disposal. */ }
    }
    activeSse.clear()
    sharedState.owners = (sharedState.owners ?? 1) - 1
    if (sharedState.owners > 0) return
    const globalScope = globalThis as Record<string, unknown>
    if (globalScope[SHARED_BRIDGE_KEY] === sharedState) {
      delete globalScope[SHARED_BRIDGE_KEY]
    }
    disposeSharedBridgeState(sharedState)
  }
  middleware.subscribeNotifications = (
    listener: (value: { method: string; params: unknown; atIso: string }) => void,
  ) => {
    const onPreferences = (state: ModelPreferences) => listener({ method: 'model-preferences/changed', params: state, atIso: new Date().toISOString() })
    const onPreferenceError = (message: string) => listener({ method: 'model-preferences/error', params: { message }, atIso: new Date().toISOString() })
    preferenceListeners.add(onPreferences)
    preferenceErrorListeners.add(onPreferenceError)
    const unsubscribeAppServer = appServer.onNotification((notification: { method: string; params: unknown }) => {
      listener({
        ...notification,
        atIso: new Date().toISOString(),
      })
    })
    return () => {
      unsubscribeAppServer()
      preferenceListeners.delete(onPreferences)
      preferenceErrorListeners.delete(onPreferenceError)
    }
  }

  return middleware
}
