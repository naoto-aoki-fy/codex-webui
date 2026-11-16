import { ModelPreferencesStore } from './modelPreferencesStore.js'
import { createModelPreferenceUsage } from './modelPreferenceUsage.js'
import type { ModelPreferences } from '../modelPreferences.js'
import { resolveAppServerUrl } from './appServerWebSocketClient.js'
import { NativeProjects } from './nativeProjects.js'
import { createConversationTransfers } from './conversationTransfer.js'
import { profileStateDirectory, getConnectionProfileId } from './connectionProfile.js'
import { WORKFLOW_CAPABILITIES, classifyCapabilityError } from './remoteCapabilities.js'
import { stageRemoteUpload, inspectRemoteUploads } from './remoteUploads.js'
import { projectPath, ProjectFileService } from './appServerFileSystem.js'
import { handleSseRequest } from './bridgeSse.js'
import { normalizeStringArray } from './workspaceRootsStore.js'
export type { WorkspaceRootsState } from './workspaceRootsStore.js'
import { createThreadPresentationStore } from './threadPresentationStore.js'
import { asRecord, getErrorMessage, getErrorCode, setJson, readJsonBody, isUnauthenticatedRateLimitError, isEmptyThreadReadError, isThreadMaterializationPendingError, isThreadNotFoundError } from './bridgeHttpUtils.js'
export { isUnauthenticatedRateLimitError, isEmptyThreadReadError, isThreadMaterializationPendingError, isThreadNotFoundError } from './bridgeHttpUtils.js'
import { sanitizeThreadTurnsInlinePayloads, THREAD_METHODS_WITH_TURNS } from './threadInlinePayloads.js'
export { sanitizeThreadTurnsInlinePayloads } from './threadInlinePayloads.js'
import appServerMethods from './appServerMethods.json'
import { AppServerClient as AppServerClientCore, STREAM_EVENT_BUFFER_LIMIT, type StreamEventFrame } from './appServerClient.js'
import { PersistentThreadIndex } from './persistentThreadIndex.js'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handleAccountRoutes } from './accountRoutes.js'
import { CodexCredentialError, readPublicAuthStatus } from './codexCredentials.js'
import { callRpcWithRateLimitDecodeRecovery } from './rateLimitDecodeRecovery.js'
import { handleSkillsRoutes } from './skillsRoutes.js'
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

const persistentThreadIndex = new PersistentThreadIndex(() => profileStateDirectory(getCodexHomeDir()))

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
  const { forkFromTurnIndex, expectedTurnId, ...forkParams } = params
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
  if (expectedTurnId && expectedTurnId !== ids[cutoff]) throw new Error('Source history changed at the selected response. Refresh the thread.')
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

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

const { readPinnedThreadIds } = createThreadPresentationStore()

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
    super({ threadIndex: persistentThreadIndex })
  }
}

class MethodCatalog {
  async listMethods(): Promise<string[]> { return appServerMethods.methods }
  async listNotificationMethods(): Promise<string[]> { return appServerMethods.notifications }
}

type CodexBridgeMiddleware = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  files: ProjectFileService
  projects: NativeProjects
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
  modelPreferences?: ModelPreferencesStore
  modelPreferenceUsage?: ReturnType<typeof createModelPreferenceUsage>
  preferenceListeners?: Set<(state: ModelPreferences) => void>
  preferenceErrorListeners?: Set<(message: string) => void>
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
  const modelPreferences = sharedState.modelPreferences ??= new ModelPreferencesStore()
  const modelPreferenceUsage = sharedState.modelPreferenceUsage ??= createModelPreferenceUsage(modelPreferences)
  const preferenceListeners = sharedState.preferenceListeners ??= new Set()
  const preferenceErrorListeners = sharedState.preferenceErrorListeners ??= new Set()
  const publishPreferences = (state: ModelPreferences) => {
    for (const listener of preferenceListeners) {
      try { listener({ ...state, connectionProfile: getConnectionProfileId() }) } catch { /* A closed browser must not fail a committed update. */ }
    }
  }
  const transfers = createConversationTransfers((method, params) => appServer.rpc(method, params))
  const files = sharedState.files ?? new ProjectFileService(appServer)
  const projects = new NativeProjects((m, p) => appServer.rpc(m, p), () => JSON.stringify([getConnectionProfileId(), resolveAppServerUrl(), appServer.getInitializationMetadata?.()?.codexHome ?? '']))
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

      if (await handleAccountRoutes(req, res, url)) {
        return
      }

      if (await handleSkillsRoutes(req, res, url, { appServer, readJsonBody })) {
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/uploads') {
        setJson(res, 200, await inspectRemoteUploads(getCodexHomeDir()))
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/upload-file') {
        handleFileUpload(req, res, appServer)
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/connection-diagnostics') {
        const state = url.searchParams.get('probe') === '1' ? await projects.read() : null
        const directory = process.env.CODEXUI_REMOTE_INITIAL_DIRECTORY?.trim() || state?.active[0] || state?.order[0] || null
        const generation = appServer.getConnectionGeneration()
        const diagnostics = appServer.capabilities
        let git: { available: boolean | null; detail: string } = { available: null, detail: 'Not checked. command/exec support does not establish Git availability.' }
        if (url.searchParams.get('probe') === '1' && directory && projectPath(directory).isAbsolute(directory)) {
          // Only read-only operations. Never probe writes or enumerate/read arbitrary files.
          const probeResults = await diagnostics.coalesceProbe(directory, () => Promise.allSettled([
            files.getMetadata(directory), files.readDirectory(directory),
            appServer.rpc('fuzzyFileSearch', { query: '__codexapp_capability_probe_no_match__', roots: [directory], cancellationToken: null }),
            appServer.rpc('command/exec', { command: ['git', '--version'], cwd: directory, timeoutMs: 3000, outputBytesCap: 4096 }),
          ]))
          const gitResult = probeResults[3]
          if (gitResult?.status === 'fulfilled') {
            const row = asRecord(gitResult.value)
            git = typeof row?.exitCode === 'number' ? { available: row.exitCode === 0, detail: String(row.stdout || row.stderr || `Exit ${row.exitCode}`).slice(0, 4096) }
              : { available: null, detail: 'Incompatible command/exec response' }
          } else if (gitResult?.status === 'rejected') git = { available: null, detail: getErrorMessage(gitResult.reason, 'Git availability unknown') }
        }
        if (generation !== appServer.getConnectionGeneration()) {
          setJson(res, 409, { error: 'Connection changed during diagnosis. Check compatibility again.' })
          return
        }
        setJson(res, 200, { data: { connection: appServer.getInitializationMetadata() ? 'initialized' : 'unknown-or-disconnected', platformOs: appServer.getInitializationMetadata()?.platformOs ?? null, profile: getConnectionProfileId(), generation, directory, workflows: WORKFLOW_CAPABILITIES, capabilities: diagnostics.snapshot(), authentication: appServer.getAuthenticationDiagnostics(), git } })
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
            : body.method === 'model-preferences/migrate' ? await modelPreferences.migrate(body.params)
            : null
          if (!result) { setJson(res, 400, { error: 'Unknown model preferences method' }); return }
          if (body.method !== 'model-preferences/read') publishPreferences(result)
          setJson(res, 200, { result: { ...result, connectionProfile: getConnectionProfileId() } })
          return
        }

        if (body.method === 'getAuthStatus') {
          setJson(res, 200, { result: await readPublicAuthStatus(appServer, body.params) })
          return
        }

        if (body.method.startsWith('conversation-transfer/')) {
          const params = asRecord(body.params) ?? {}
          const result = body.method === 'conversation-transfer/prepare'
            ? await transfers.prepare(readNonEmptyString(params.threadId), params.turnIndex as number | undefined, readNonEmptyString(params.turnId), params.revertTarget as import('../types/codex.js').PortableRevertTarget | undefined)
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
            const evidence = classifyCapabilityError(error)
            const guidance = evidence.support === 'unsupported'
              ? 'The connected server lacks fs/getMetadata, required for workspace validation. Upgrade the remote Codex app-server; check remote compatibility in account settings.'
              : `Remote workspace validation failed (${evidence.diagnosis}). Check the directory, permissions and connection on the App Server host before retrying.`
            setJson(res, 502, { error: `${guidance} ${evidence.detail}`, capability: 'fs/getMetadata', diagnosis: evidence.diagnosis })
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
          rpcResult = responseFork || (body.method === 'thread/fork' && params && Object.prototype.hasOwnProperty.call(params, 'forkFromTurnIndex'))
            ? await forkThreadAtCutoff(appServer, params ?? {})
            : body.method === 'thread/read' && params?.includeTurns === true && typeof appServer.readThreadPage === 'function'
              ? (await appServer.readThreadPage(readNonEmptyString(params.threadId), '', THREAD_RESPONSE_TURN_LIMIT)).result
              : await callRpcWithArchiveRecovery(appServer, body.method, body.params ?? null)
        } catch (error) {
	          if (body.method === 'account/rateLimits/read' && isUnauthenticatedRateLimitError(error)) {
	            setJson(res, 200, { result: null })
	            return
	          }
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
          if (['account/usage/read', 'thread/compact/start', 'thread/delete', 'review/start', 'thread/queue/add', 'thread/queue/update', 'thread/queue/delete', 'thread/queue/reorder', 'thread/queue/start', 'thread/settings/update', 'account/login/start', 'account/login/cancel'].includes(body.method) || body.method==='config/value/write'&&req.headers['x-codex-config-write-errors']==='1' || ['command/exec','command/exec/terminate'].includes(body.method)&&req.headers['x-codex-command-errors']==='1') {
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

        const sanitizedResult = await sanitizeThreadTurnsInlinePayloads(body.method, errorMergedResult)
        if (body.method === 'thread/start' && asRecord(body.params)?.projectId) {
          const expected = asRecord(body.params)!.projectId
          const thread = asRecord(asRecord(rpcResult)?.thread)
          if (thread?.projectId !== expected) throw new Error(`thread/start did not confirm native project ${expected}; inspect destination ${thread?.id || '(unknown)'} before retrying`)
        }
        const result = await transfers.decorate(sanitizedResult)

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

          if (typeof appServer.readThreadPage === 'function') {
            const page = await appServer.readThreadPage(threadId, beforeTurnId, limit)
            const result = await sanitizeThreadTurnsInlinePayloads('thread/read', mergeStreamTurnErrorsIntoThreadResult(appServer, page.result))
            setJson(res, 200, { ...page, result: await transfers.decorate(result) })
            return
          }
          throw new Error('Native history pagination is required. Upgrade the WebUI/Codex connection; full-history fallback is unavailable.')
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to load earlier thread messages') })
        }
        return
      }

      // Retired API: terminate here so SPA middleware cannot serve HTML.
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
        const state = await projects.read()
        setJson(res, 200, { data: state })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/home-directory') {
        const state = await projects.read()
        const path = process.env.CODEXUI_REMOTE_INITIAL_DIRECTORY?.trim() || state.active[0] || state.order[0]
        if (!path) { setJson(res, 409, { error: 'Enter an absolute workspace path on the App Server host, or set CODEXUI_REMOTE_INITIAL_DIRECTORY.' }); return }
        setJson(res, 200, { data: { path } })
        return
      }


      if (req.method === 'PUT' && url.pathname === '/codex-api/workspace-roots-state') {
        setJson(res, 409, { error: 'Workspace updates have changed. Reload this tab before editing projects.' })
        return
      }

      if (req.method === 'PATCH' && url.pathname === '/codex-api/workspace-roots-state') {
        const record = asRecord(await readJsonBody(req))
        if (!record || !['delete', 'rename', 'move'].includes(String(record.type)) || typeof record.projectId !== 'string' || !record.projectId
          || (record.type === 'rename' && (typeof record.name !== 'string' || !record.name.trim()))
          || (record.type === 'move' && record.beforeProjectId != null && typeof record.beforeProjectId !== 'string')) {
          setJson(res, 400, { error: 'Expected a native project operation with projectId; legacy path writes are disabled' })
          return
        }
        const state = await projects.operation(record as { type: 'delete' | 'rename' | 'move'; projectId: string; name?: string; beforeProjectId?: string | null })
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

        const selection = await projects.register(normalizedPath)
        setJson(res, 200, { data: selection })
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
      if (error instanceof CodexCredentialError) {
        setJson(res, error.statusCode, { error: error.message, code: error.code })
        return
      }
      const message = getErrorMessage(error, 'Unknown bridge error')
      setJson(res, 502, { error: message })
    }
  }

  middleware.files = sharedState.files
  middleware.projects = projects
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
