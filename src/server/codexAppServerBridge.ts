import { stageRemoteUpload } from './remoteUploads.js'
import { projectPath, ProjectFileService } from './appServerFileSystem.js'
import { handleSseRequest } from './bridgeSse.js'
export { refreshChatgptAuthTokensForExternalAuth } from './externalAuthRefresh.js'
import { createGitWorkspaceRoutes } from './gitWorkspaceRoutes.js'
import { normalizeStringArray, canonicalizeThreadListResponseForRead, readWorkspaceRootsState, applyWorkspaceRootsOperation, persistWorkspaceRoot } from './workspaceRootsStore.js'
export { canonicalizeWorkspaceRootsState, canonicalizeWorkspaceRootsStateForRead, canonicalizeThreadListResponseForRead, writeWorkspaceRootsState } from './workspaceRootsStore.js'
export type { WorkspaceRootsState } from './workspaceRootsStore.js'
import { createThreadPresentationStore } from './threadPresentationStore.js'
import { asRecord, getErrorMessage, getErrorCode, setJson, readJsonBody, isUnauthenticatedRateLimitError, isEmptyThreadReadError, isThreadMaterializationPendingError, isThreadNotFoundError } from './bridgeHttpUtils.js'
export { isUnauthenticatedRateLimitError, isEmptyThreadReadError, isThreadMaterializationPendingError, isThreadNotFoundError } from './bridgeHttpUtils.js'
import { sanitizeThreadTurnsInlinePayloads, THREAD_METHODS_WITH_TURNS } from './threadInlinePayloads.js'
export { sanitizeThreadTurnsInlinePayloads } from './threadInlinePayloads.js'
import appServerMethods from './appServerMethods.json'
import { AppServerClient as AppServerClientCore, STREAM_EVENT_BUFFER_LIMIT, type StreamEventFrame } from './appServerClient.js'
import { PersistentThreadIndex } from './persistentThreadIndex.js'
export { mergeSessionSkillInputsIntoTurns } from './threadSessionEnrichment.js'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handleAccountRoutes } from './accountRoutes.js'
import { CodexCredentialError, readCodexCredentialStore, readPublicAuthStatus } from './codexCredentials.js'
import { callRpcWithRateLimitDecodeRecovery } from './rateLimitDecodeRecovery.js'
import { handleSkillsRoutes } from './skillsRoutes.js'
import { TurnGenerationMetadataStore } from './turnGenerationMetadata.js'
import type { WorkspaceRootsOperation } from '../types/workspaceRoots.js'
import { isAbsoluteLikePath } from '../pathUtils.js'

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

const persistentThreadIndex = new PersistentThreadIndex(getCodexHomeDir, () => [])
const turnGenerationMetadataStore = new TurnGenerationMetadataStore(getCodexHomeDir)

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

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function trimThreadTurnsInRpcResult(method: string, result: unknown): unknown {
  if (!THREAD_METHODS_WITH_TURNS.has(method)) return result

  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : null
  if (!record || !thread || !turns || turns.length <= THREAD_RESPONSE_TURN_LIMIT) return result
  const startTurnIndex = Math.max(0, turns.length - THREAD_RESPONSE_TURN_LIMIT)

  return {
    ...record,
    threadTurnStartIndex: startTurnIndex,
    thread: {
      ...thread,
      turns: turns.slice(startTurnIndex),
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
  const { forkFromTurnIndex, ...forkParams } = params
  if (!Number.isSafeInteger(forkFromTurnIndex) || (forkFromTurnIndex as number) < 0) {
    throw new Error('Invalid fork response cutoff')
  }
  const source = asRecord(await callRpcWithArchiveRecovery(appServer, 'thread/read', {
    threadId: params.threadId, includeTurns: true,
  }))
  const sourceTurns = asRecord(source?.thread)?.turns
  const cutoff = forkFromTurnIndex as number
  const prefix = Array.isArray(sourceTurns) ? sourceTurns.slice(0, cutoff + 1) : []
  const ids = prefix.map(turn => readNonEmptyString(asRecord(turn)?.id))
  if (ids.length !== cutoff + 1 || ids.some(id => !id)) {
    throw new Error('Fork response cutoff is outside the source history')
  }
  const result = await callRpcWithArchiveRecovery(appServer, 'thread/fork', {
    ...forkParams, lastTurnId: ids[cutoff],
  })
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
    return { ...record, forkCutoff: { sourceThreadId: params.threadId, turnIndex: cutoff, turnId: ids[cutoff], turnCount: ids.length } }
  } catch (error) {
    try {
      await callRpcWithArchiveRecovery(appServer, 'thread/archive', { threadId: id })
    } catch (cleanupError) {
      throw new Error(`${getErrorMessage(error, 'Fork failed')}; failed to archive incomplete fork ${id}: ${getErrorMessage(cleanupError, 'unknown error')}`)
    }
    throw error
  }
}

export async function callRpcWithArchiveRecovery(
  appServer: RpcExecutor,
  method: string,
  params: unknown,
): Promise<unknown> {
  try {
    const result = await callRpcWithRateLimitDecodeRecovery(appServer, method, params)
    if (method === 'thread/search') {
      const page = asRecord(result)
      if (Array.isArray(page?.data)) {
        const rows = page.data.map(asRecord)
        const normalized = asRecord(await canonicalizeThreadListResponseForRead({
          data: rows.map(row => {
            const thread = asRecord(row?.thread)
            const environments = Array.isArray(thread?.environments) ? thread.environments : []
            const cwd = typeof thread?.cwd === 'string' ? thread.cwd
              : environments.map(asRecord).find(env => typeof env?.cwd === 'string')?.cwd ?? ''
            return { ...thread, cwd }
          }),
        }))
        const threads = normalized?.data as unknown[]
        return { ...page, data: rows.map((row, index) => ({ ...row, thread: threads[index] })) }
      }
    }
    return method === 'thread/list'
      ? await canonicalizeThreadListResponseForRead(result)
      : result
  } catch (error) {
    const paramsRecord = asRecord(params)
    const threadId = readNonEmptyString(paramsRecord?.threadId)

    if (method === 'turn/start' && threadId && isThreadNotFoundError(error)) {
      await appServer.rpc('thread/resume', { threadId })
      return appServer.rpc(method, params ?? null)
    }

    if (method !== 'thread/archive') {
      throw error
    }

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

function scoreFileCandidate(path: string, query: string): number {
  if (!query) return 0
  const lowerPath = path.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const baseName = lowerPath.slice(lowerPath.lastIndexOf('/') + 1)
  if (baseName === lowerQuery) return 0
  if (baseName.startsWith(lowerQuery)) return 1
  if (baseName.includes(lowerQuery)) return 2
  if (lowerPath.includes(`/${lowerQuery}`)) return 3
  if (lowerPath.includes(lowerQuery)) return 4
  return 10
}

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

const {
  normalizePinnedThreadIds,
  updateThreadTitleCache,
  removeFromThreadTitleCache,
  mutateThreadTitleCache,
  readPinnedThreadIds,
  writePinnedThreadIds,
  readMergedThreadTitleCache,
} = createThreadPresentationStore(() => null, normalizeStringArray)

function bufferIndexOf(buf: Buffer, needle: Buffer, start = 0): number {
  for (let i = start; i <= buf.length - needle.length; i++) {
    let match = true
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { match = false; break }
    }
    if (match) return i
  }
  return -1
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
        const headerEnd = bufferIndexOf(part, headerSep)
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
      const destPath = await stageRemoteUpload(appServer, fileName, fileData, getCodexHomeDir())
      setJson(res, 200, { path: destPath })
    } catch (err) {
      setJson(res, 500, { error: getErrorMessage(err, 'Upload failed') })
    }
  })
  req.on('error', (err: Error) => {
    setJson(res, 500, { error: getErrorMessage(err, 'Upload stream error') })
  })
}

// Preserve the public zero-argument constructor and bridge-owned store instances.
export class AppServerClient extends AppServerClientCore {
  constructor() {
    super({ threadIndex: persistentThreadIndex, metadataStore: turnGenerationMetadataStore })
  }
}

class MethodCatalog {
  async listMethods(): Promise<string[]> { return appServerMethods.methods }
  async listNotificationMethods(): Promise<string[]> { return appServerMethods.notifications }
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
  methodCatalog: MethodCatalog
  files: ProjectFileService
}

const SHARED_BRIDGE_KEY = '__codexRemoteSharedBridge__'
const SHARED_BRIDGE_VERSION = 'external-websocket-files-v2'

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
    // Old workers may be awaiting disk/RPC work when hot reload replaces the bridge.
    // Prevent those continuations from scheduling or submitting another prompt.
    const legacyWorker = (existing as SharedBridgeState & {
      backendQueueProcessor?: { dispose(): void } & Record<string, unknown>
    }).backendQueueProcessor
    if (legacyWorker) {
      legacyWorker.dispose()
      for (const method of ['scheduleThreadQueueDrain', 'processThreadQueue', 'startQueuedTurn']) {
        legacyWorker[method] = async () => undefined
      }
      existing.appServer.rpc = async () => { throw new Error('Retired app-server bridge') }
    }
    disposeSharedBridgeState(existing)
  }

  const appServer = new AppServerClient()
  const created: SharedBridgeState = {
    version: SHARED_BRIDGE_VERSION,
    appServer,
    methodCatalog: new MethodCatalog(),
    files: new ProjectFileService(appServer),
  }
  globalScope[SHARED_BRIDGE_KEY] = created
  return created
}

export function createCodexBridgeMiddleware(): CodexBridgeMiddleware {
  const sharedState = getSharedBridgeState()
  sharedState.owners = (sharedState.owners ?? 0) + 1
  let released = false
  const activeSse = new Set<() => void>()
  const { appServer, methodCatalog } = sharedState
  const files = sharedState.files ?? new ProjectFileService(appServer)
  const gitWorkspaceRoutes = createGitWorkspaceRoutes({ readJsonBody, getCodexHomeDir, persistWorkspaceRoot, appServer })
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

      if (await handleAccountRoutes(req, res, url, { appServer })) {
        return
      }

      if (await handleSkillsRoutes(req, res, url, { appServer, readJsonBody })) {
        return
      }

      // Native history cannot be rebuilt by scanning this host.
      if (req.method === 'POST' && url.pathname === '/codex-api/thread-index/rebuild') {
        setJson(res, 501, { error: 'Local session scanning is unavailable. Use native App Server thread history.' })
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

	        if (body.method === 'generate-thread-title') {
	          setJson(res, 200, { result: { title: '' } })
	          return
	        }

        if (body.method === 'getAuthStatus') {
          setJson(res, 200, { result: await readPublicAuthStatus(appServer, body.params) })
          return
        }

        if (body.method === 'thread/start') {
          const cwd = readNonEmptyString(asRecord(body.params)?.cwd)
          if (!cwd || !(await files.getMetadata(cwd)).isDirectory) {
            setJson(res, 400, { error: 'Select an existing workspace before starting a conversation.' })
            return
          }
        }

        const responseFork = body.method === 'thread/fork-at-response'
        if (responseFork) body.method = 'thread/fork'

        const snapshotEpoch = appServer.getSnapshotEpoch()
        let rpcResult: unknown
        try {
          const params = asRecord(body.params)
          rpcResult = responseFork || (body.method === 'thread/fork' && params && Object.prototype.hasOwnProperty.call(params, 'forkFromTurnIndex'))
            ? await forkThreadAtCutoff(appServer, params ?? {})
            : await callRpcWithArchiveRecovery(appServer, body.method, body.params ?? null)
        } catch (error) {
	          if (body.method === 'account/rateLimits/read' && isUnauthenticatedRateLimitError(error)) {
	            setJson(res, 200, { result: null })
	            return
	          }
		          if (body.method === 'thread/read' && isEmptyThreadReadError(error)) {
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
		          throw error
		        }
        const trimmedResult = trimThreadTurnsInRpcResult(body.method, rpcResult)
        const errorMergedResult = THREAD_METHODS_WITH_TURNS.has(body.method)
          ? mergeStreamTurnErrorsIntoThreadResult(appServer, trimmedResult)
          : trimmedResult
        const sanitizedResult = await sanitizeThreadTurnsInlinePayloads(body.method, errorMergedResult)
        const result = sanitizedResult

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

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-turn-page') {
        try {
          const threadId = url.searchParams.get('threadId')?.trim() ?? ''
          const beforeTurnId = url.searchParams.get('beforeTurnId')?.trim() ?? ''
          const limitRaw = url.searchParams.get('limit')?.trim() ?? String(THREAD_RESPONSE_TURN_LIMIT)
          const limit = Math.max(1, Math.min(50, Number.parseInt(limitRaw, 10) || THREAD_RESPONSE_TURN_LIMIT))
          if (!threadId) {
            setJson(res, 400, { error: 'Missing threadId' })
            return
          }

          const threadReadResult = mergeStreamTurnErrorsIntoThreadResult(appServer, await appServer.readThreadForTurnPage(threadId))
          const record = asRecord(threadReadResult)
          const thread = asRecord(record?.thread)
          if (!record || !thread) {
            setJson(res, 502, { error: 'thread/read returned an invalid thread response' })
            return
          }

          const turns = Array.isArray(thread.turns) ? thread.turns : []
          const beforeIndex = beforeTurnId
            ? turns.findIndex((turn) => asRecord(turn)?.id === beforeTurnId)
            : turns.length
          if (beforeTurnId && beforeIndex < 0) {
            setJson(res, 200, {
              result: {
                ...record,
                thread: {
                  ...thread,
                  turns: [],
                },
              },
              startTurnIndex: 0,
              hasMoreOlder: false,
            })
            return
          }

          const endIndex = beforeIndex
          const startIndex = Math.max(0, endIndex - limit)
          const pageTurns = turns.slice(startIndex, endIndex)
          const pagedResult = {
            ...record,
            thread: {
              ...thread,
              turns: pageTurns,
            },
          }
          const sanitized = await sanitizeThreadTurnsInlinePayloads('thread/read', pagedResult)
          const result = sanitized

          setJson(res, 200, {
            result,
            startTurnIndex: startIndex,
            hasMoreOlder: startIndex > 0,
          })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to load earlier thread messages') })
        }
        return
      }

      // Retired API: terminate here so SPA middleware cannot serve HTML.
      if (['/codex-api/thread/rollback-files', '/codex-api/github-clone', '/codex-api/local-directory', '/codex-api/projectless-thread-cwd', '/codex-api/project-root-suggestion'].includes(url.pathname) || url.pathname.startsWith('/codex-api/telegram/') || url.pathname === '/codex-api/worktree/create-permanent' || url.pathname === '/codex-api/thread-file-change-fallback' || url.pathname === '/codex-api/thread-live-state' || url.pathname === '/codex-api/thread-stream-events') {
        setJson(res, 404, { error: 'Not found' })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/server-requests/respond') {
        const payload = await readJsonBody(req)
        await appServer.respondToServerRequest(payload)
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending') {
        setJson(res, 200, { data: appServer.listPendingServerRequests() })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/meta/methods') {
        const methods = await methodCatalog.listMethods()
        setJson(res, 200, { data: methods })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/meta/notifications') {
        const methods = await methodCatalog.listNotificationMethods()
        setJson(res, 200, { data: methods })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/workspace-roots-state') {
        const state = await readWorkspaceRootsState()
        setJson(res, 200, { data: state })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/home-directory') {
        const state = await readWorkspaceRootsState()
        const path = process.env.CODEXUI_REMOTE_INITIAL_DIRECTORY?.trim() || state.active[0] || state.order[0]
        if (!path) { setJson(res, 409, { error: 'Enter an absolute workspace path on the App Server host, or set CODEXUI_REMOTE_INITIAL_DIRECTORY.' }); return }
        setJson(res, 200, { data: { path } })
        return
      }

      if (await gitWorkspaceRoutes.handleWorktreeRoutes(req, res, url)) return

      if (req.method === 'PUT' && url.pathname === '/codex-api/workspace-roots-state') {
        setJson(res, 409, { error: 'Workspace updates have changed. Reload this tab before editing projects.' })
        return
      }

      if (req.method === 'PATCH' && url.pathname === '/codex-api/workspace-roots-state') {
        const record = asRecord(await readJsonBody(req))
        let operation: WorkspaceRootsOperation
        if (record?.type !== 'delete' || typeof record.path !== 'string' || !isAbsoluteLikePath(record.path.trim())) {
          setJson(res, 400, { error: 'Expected a delete project operation with a stable path' })
          return
        }
        operation = { type: 'delete', path: record.path.trim() }
        const state = await applyWorkspaceRootsOperation(operation)
        setJson(res, 200, { data: state })
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/project-root') {
        const payload = asRecord(await readJsonBody(req))
        const rawPath = typeof payload?.path === 'string' ? payload.path.trim() : ''
        if (!rawPath) {
          setJson(res, 400, { error: 'Missing path' })
          return
        }

        const normalizedPath = rawPath
        if (!projectPath(rawPath).isAbsolute(rawPath)) throw new Error('Expected absolute remote workspace path')
        const info = await files.getMetadata(normalizedPath)
        if (!info.isDirectory) {
          setJson(res, 400, { error: 'Path exists but is not a directory' })
          return
        }

        await persistWorkspaceRoot(normalizedPath)
        setJson(res, 200, { data: { path: normalizedPath } })
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
          const files = found.files.map(file => file.path)
          const scored = files
            .map((path) => ({ path, score: scoreFileCandidate(path, query) }))
            .filter((row) => query.length === 0 || row.score < 10)
            .sort((a, b) => (a.score - b.score) || a.path.localeCompare(b.path))
            .slice(0, limit)
            .map((row) => ({ path: row.path }))
          setJson(res, 200, { data: scored })
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to search files') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-titles') {
        const cache = await readMergedThreadTitleCache()
        setJson(res, 200, { data: cache })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/thread-pins') {
        const threadIds = await readPinnedThreadIds()
        setJson(res, 200, { data: { threadIds } })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/thread-titles') {
        const payload = asRecord(await readJsonBody(req))
        const id = typeof payload?.id === 'string' ? payload.id : ''
        const title = typeof payload?.title === 'string' ? payload.title : ''
        if (!id) {
          setJson(res, 400, { error: 'Missing id' })
          return
        }
        await mutateThreadTitleCache((cache) => title
          ? updateThreadTitleCache(cache, id, title)
          : removeFromThreadTitleCache(cache, id))
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/codex-api/thread-pins') {
        const payload = asRecord(await readJsonBody(req))
        const threadIds = normalizePinnedThreadIds(payload?.threadIds)
        await writePinnedThreadIds(threadIds)
        setJson(res, 200, { ok: true })
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

      next()
    } catch (error) {
      if (error instanceof CodexCredentialError) {
        setJson(res, error.statusCode, { error: error.message, code: error.code })
        return
      }
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
    const unsubscribeAppServer = appServer.onNotification((notification: { method: string; params: unknown }) => {
      listener({
        ...notification,
        atIso: new Date().toISOString(),
      })
    })
    return () => {
      unsubscribeAppServer()
    }
  }

  return middleware
}
