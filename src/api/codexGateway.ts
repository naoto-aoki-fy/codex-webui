import type { QuestionResponse, QuestionSubmission } from '../questionResponses'
import { listNativeProjects } from '../nativeProjects'
import type { Project } from '../server/protocol/0.167.2/v2/Project'
import type { TurnsPage } from '../server/protocol/0.167.2/v2/TurnsPage'
import { readThreadTurnOutcomes, type ThreadTurnOutcomes } from './normalizers/threadMetadata'
import {threadSecurity} from './threadSecurity'
import { fastModeAvailability, modelSelectionKey, parseModelSelection } from './modelCapabilities'
import { normalizeSkillsList, type SkillInfo, type SkillsListResponseEntry } from './normalizers/skills'
export type { SkillInfo } from './normalizers/skills'
import { normalizeDirectoryMcpServer, type DirectoryMcpServerStatus } from './normalizers/directoryMcp'
export type { DirectoryMcpServerStatus } from './normalizers/directoryMcp'
import {
  buildTurnIndexByTurnId,
  normalizeThreadIdFromPayload,
  normalizeThreadCwdFromPayload,
  normalizeThreadModelFromPayload,
  normalizeThreadModelProviderFromPayload,
  type ThreadTurnIndexById,
} from './normalizers/threadMetadata'
import {
  findReasoningModel as findReasoningModelInCatalog,
  normalizeReasoningEffort,
  resolveReasoningEffort,
  type ReasoningModel,
} from './modelCapabilities'
export { reasoningOptions, resolveReasoningEffort, type ReasoningModel } from './modelCapabilities'
import { pickCodexRateLimitSnapshot } from './normalizers/rateLimits'
export { pickCodexRateLimitSnapshot } from './normalizers/rateLimits'
import { nativeAppInputs } from './apps'
import { buildTurnInput, type FileAttachmentParam } from './turnInput'
export type { FileAttachmentParam } from './turnInput'
import { ref } from 'vue'
import {
  fetchPendingServerRequests,
  rpcCall,
  respondServerRequest,
  subscribeRpcNotifications,
  type RpcNotification,
  type BrowserConnectionState,
} from './codexRpcClient'
import type {
  CollaborationModeListResponse,
  ConfigReadResponse,
  ModelListParams,
  ModelListResponse,
  ReasoningEffort,
  ThreadForkResponse,
  ThreadListResponse,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  Turn,
} from './appServerDtos'
import { normalizeCodexApiError } from './codexErrors'
import {
  readActiveTurnIdFromResponse,
  normalizeThreadGroupsV2,
  normalizeThreadMessagesV2,
  normalizeThreadSummaryV2,
  readThreadInProgressFromResponse,
} from './normalizers/v2'
import type {
  SpeedMode,
  CollaborationModeKind,
  CollaborationModeOption,
  UiMessage,
  UiProjectGroup,
  UiThread,
  UiRateLimitSnapshot,
} from '../types/codex'
import { normalizePathForUi } from '../pathUtils.js'

type CurrentModelConfig = {
  modelProvider?: string
  model: string
  reasoningEffort: ReasoningEffort | ''
  speedMode: SpeedMode
}

type DirectoryMcpLoginResult = {
  authorizationUrl: string
}


export type ComposerFileSuggestion = {
  path: string
}

const DEFAULT_COLLABORATION_MODE_OPTIONS: CollaborationModeOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan' },
]



type ThreadSearchResult = {
  threadIds: string[]
  groups: UiProjectGroup[]
}

export type LocalDirectoryEntry = {
  name: string
  path: string
}

export type LocalDirectoryListing = {
  path: string
  parentPath: string
  entries: LocalDirectoryEntry[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function callRpc<T>(method: string, params?: unknown): Promise<T> {
  try {
    return await rpcCall<T>(method, params)
  } catch (error) {
    throw normalizeCodexApiError(error, `RPC ${method} failed`, method)
  }
}

function normalizeSpeedMode(value: unknown): SpeedMode {
  return typeof value === 'string' && value.trim().toLowerCase() === 'fast'
    ? 'fast'
    : 'standard'
}

const INITIAL_THREAD_LIST_LIMIT = 50
const BACKGROUND_THREAD_LIST_LIMIT = 100

type ThreadGroupsPage = {
  groups: UiProjectGroup[]
  nextCursor: string | null
}

type ThreadTurnPage = {
  questionResponses?: QuestionResponse[]
  messages: UiMessage[]
  olderCursor: string | null
  turnIndexByTurnId: ThreadTurnIndexById
}

async function getThreadGroupsPageV2(cursor: string | null, limit: number, archived = false): Promise<ThreadGroupsPage> {
  const payload = await callRpc<ThreadListResponse>('thread/list', {
    archived,
    limit,
    sortKey: 'updated_at',
    modelProviders: [],
    cursor,
  })
  return {
    groups: normalizeThreadGroupsV2(payload),
    nextCursor: typeof payload.nextCursor === 'string' && payload.nextCursor.length > 0
      ? payload.nextCursor
      : null,
  }
}

async function getThreadSummaryV2(threadId: string): Promise<UiThread> {
  const payload = await callRpc<ThreadReadResponse>('thread/read', {
    threadId,
    includeTurns: false,
  })
  return normalizeThreadSummaryV2(payload)
}

async function getThreadDetailV2(threadId: string, retainedTurnIds: string[]): Promise<{
  questionResponses?: QuestionResponse[]
  turnOutcomes?: ThreadTurnOutcomes
  nativeReadState?: import('../types/codex').NativeThreadReadState
  model: string
  modelProvider: string
  messages: UiMessage[]
  inProgress: boolean
  activeTurnId: string
  olderCursor: string | null
  turnIndexByTurnId: ThreadTurnIndexById
}> {
  const payload = await callRpc<ThreadReadResponse & { questionResponses?: QuestionResponse[] }>('thread/read', {
    threadId,
    includeTurns: true,
    ...(retainedTurnIds.length ? { retainedTurnIds } : {}),
  })
  const normalized = normalizeThreadMessagesV2(payload)
  return {
    model: normalizeThreadModelFromPayload(payload),
    modelProvider: normalizeThreadModelProviderFromPayload(payload),
    nativeReadState: (payload as ThreadReadResponse & { readState?: import('../types/codex').NativeThreadReadState | null }).readState ?? undefined,
    messages: normalized,
    ...(payload.questionResponses ? { questionResponses: payload.questionResponses } : {}),
    turnOutcomes: readThreadTurnOutcomes(payload),
    inProgress: readThreadInProgressFromResponse(payload),
    activeTurnId: readActiveTurnIdFromResponse(payload),
    olderCursor: readOlderCursor(payload),
    turnIndexByTurnId: buildTurnIndexByTurnId(payload),
  }
}

function readOlderCursor(payload: unknown): string | null {
  const cursor = (payload as { olderCursor?: unknown } | null)?.olderCursor
  return typeof cursor === 'string' && cursor ? cursor : null
}

async function readTurnsPage(threadId: string, cursor: string, limit: number, itemsView: 'full' | 'notLoaded') {
  const page = await callRpc<TurnsPage & { questionResponses?: QuestionResponse[] }>('thread/turns/list', { threadId, cursor: cursor || null, limit, itemsView, sortDirection: 'desc' })
  if (!Array.isArray(page?.data) || (page.nextCursor != null && typeof page.nextCursor !== 'string')) {
    throw new Error('Invalid native history page')
  }
  if (page.nextCursor === cursor) throw new Error('Native history repeated a cursor. Refresh the conversation.')
  return page
}

export async function getThreadGroupsPage(
  cursor: string | null = null,
  limit = INITIAL_THREAD_LIST_LIMIT,
): Promise<ThreadGroupsPage> {
  try {
    return await getThreadGroupsPageV2(cursor, limit)
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to load thread groups', 'thread/list')
  }
}

/** Native archived state; fetched only by the archive browser. */
export async function getArchivedThreadGroupsPage(cursor: string | null = null): Promise<ThreadGroupsPage> {
  return getThreadGroupsPageV2(cursor, INITIAL_THREAD_LIST_LIMIT, true)
}

export async function unarchiveThread(threadId: string): Promise<UiThread> {
  const result = await callRpc<ThreadReadResponse>('thread/unarchive', { threadId })
  if (result?.thread?.id !== threadId) throw new Error('Invalid thread/unarchive response; inspect the archive before retrying.')
  return normalizeThreadSummaryV2(result)
}

export function getBackgroundThreadListLimit(): number {
  return BACKGROUND_THREAD_LIST_LIMIT
}

export async function getThreadSummary(threadId: string): Promise<UiThread> {
  try {
    return await getThreadSummaryV2(threadId)
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to load thread ${threadId}`, 'thread/read')
  }
}

export async function getThreadDetail(threadId: string, retainedTurnIds: string[] = []): Promise<{
  questionResponses?: QuestionResponse[]
  turnOutcomes?: ThreadTurnOutcomes
  nativeReadState?: import('../types/codex').NativeThreadReadState
  model: string
  modelProvider: string
  messages: UiMessage[]
  inProgress: boolean
  activeTurnId: string
  olderCursor: string | null
  turnIndexByTurnId: ThreadTurnIndexById
}> {
  try {
    return await getThreadDetailV2(threadId, retainedTurnIds)
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to load thread ${threadId}`, 'thread/read')
  }
}

export async function getOlderThreadMessages(threadId: string, cursor: string, limit = 10, endTurnIndex = 0): Promise<ThreadTurnPage> {
  try {
    const page = await readTurnsPage(threadId, cursor, limit, 'full')
    const payload = { thread: { id: threadId, turns: [...page.data].reverse() } } as ThreadReadResponse
    const baseTurnIndex = endTurnIndex - page.data.length
    return {
      messages: normalizeThreadMessagesV2(payload, baseTurnIndex),
      ...(page.questionResponses ? { questionResponses: page.questionResponses } : {}),
      olderCursor: page.nextCursor ?? null,
      turnIndexByTurnId: buildTurnIndexByTurnId(payload, baseTurnIndex),
    }
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to load earlier messages for thread ${threadId}`, 'thread/turns/list')
  }
}

export function subscribeCodexNotifications(
  onNotification: (value: RpcNotification) => void,
  onConnectionState?: (state: BrowserConnectionState) => void,
): () => void {
  return subscribeRpcNotifications(onNotification, onConnectionState)
}

export type { RpcNotification }

export async function replyToServerRequest(
  id: number,
  payload: { result?: unknown; error?: { code?: number; message: string } },
): Promise<QuestionSubmission | undefined> {
  return respondServerRequest({
    id,
    ...payload,
  })
}

export async function getPendingServerRequests(): Promise<unknown[]> {
  return fetchPendingServerRequests()
}

export async function getAccountRateLimits(): Promise<UiRateLimitSnapshot | null> {
  try {
    const payload = await callRpc<unknown>('account/rateLimits/read')
    return pickCodexRateLimitSnapshot(payload)
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to load account rate limits', 'account/rateLimits/read')
  }
}

export type ResumedThread = {
  questionResponses?: QuestionResponse[]
  security?: import('./threadSecurity').ThreadSecurity | null
  turnOutcomes?: ThreadTurnOutcomes
  nativeReadState?: import('../types/codex').NativeThreadReadState
  model: string
  modelProvider: string
  messages: UiMessage[]
  inProgress: boolean
  activeTurnId: string
  olderCursor: string | null
  turnIndexByTurnId: ThreadTurnIndexById
}

const RESUME_THREAD_COALESCE_TTL_MS = 30_000
const recentResumeThreadById = new Map<string, { promise: Promise<ResumedThread>; retained: Set<string> }>()

// Restore background event delivery without fetching its history.
export async function resumeThreadSubscription(threadId: string): Promise<void> {
  await callRpc('thread/resume', { threadId, excludeTurns: true })
}

export async function resumeThread(threadId: string, retainedTurnIds: string[] = []): Promise<ResumedThread> {
  const existing = recentResumeThreadById.get(threadId)
  if (existing && retainedTurnIds.every(id => existing.retained.has(id))) return existing.promise

  const promise = (async () => {
    const payload = await callRpc<ThreadResumeResponse & { questionResponses?: QuestionResponse[] }>('thread/resume', {
      threadId, ...(retainedTurnIds.length ? { retainedTurnIds } : {}),
    })
    const messages = normalizeThreadMessagesV2(payload)
    return {
      security: threadSecurity(payload),
      model: normalizeThreadModelFromPayload(payload),
      modelProvider: normalizeThreadModelProviderFromPayload(payload),
      messages,
      ...(payload.questionResponses ? { questionResponses: payload.questionResponses } : {}),
      turnOutcomes: readThreadTurnOutcomes(payload),
      inProgress: readThreadInProgressFromResponse(payload),
      activeTurnId: readActiveTurnIdFromResponse(payload),
      olderCursor: readOlderCursor(payload),
      turnIndexByTurnId: buildTurnIndexByTurnId(payload),
    }
  })()

  const entry = { promise, retained: new Set(retainedTurnIds) }
  recentResumeThreadById.set(threadId, entry)
  const hardEvictionTimer = globalThis.setTimeout(() => {
    if (recentResumeThreadById.get(threadId) === entry) {
      recentResumeThreadById.delete(threadId)
    }
  }, RESUME_THREAD_COALESCE_TTL_MS)
  void promise.finally(() => {
    globalThis.clearTimeout(hardEvictionTimer)
    globalThis.setTimeout(() => {
      if (recentResumeThreadById.get(threadId) === entry) {
        recentResumeThreadById.delete(threadId)
      }
    }, 2000)
  }).catch(() => undefined)
  return promise
}

// A successful mutation discards even a Resume started while the mutation was
// pending. Detached requests still settle for their callers; their identity-guarded
// timers cannot delete a replacement, and completion never reinserts an entry.
// Failed mutations leave the current generation (including rejection retention) intact.
export function invalidateResumeThread(threadId: string): void {
  recentResumeThreadById.delete(threadId)
}

// Archive/name are not represented in ResumedThread. Start/fork create independent
// threads and do not mutate the source history, so none invalidate the source.
export async function archiveThread(threadId: string): Promise<void> {
  await callRpc('thread/archive', { threadId })
}

export async function renameThread(threadId: string, threadName: string): Promise<void> {
  await callRpc('thread/name/set', { threadId, name: threadName })
}

// A revert or reconnect can retire a snapshot while its native page is being read.
export async function getThreadDetailForRevert(threadId: string): Promise<ResumedThread> {
  try { return await getThreadDetail(threadId) }
  catch (cause) {
    if (!(cause instanceof Error) || !cause.message.includes('History changed while loading. Refresh the thread.')) throw cause
    return getThreadDetail(threadId)
  }
}

// Resume ensures the thread is loaded before the revert mutation.
export async function validateThreadRevert(threadId: string, beforeTurnId: string): Promise<void> {
  const payload = await callRpc<{ thread: { historyMode?: string; ephemeral?: boolean; status?: { type?: string } } }>(
    'thread/resume', { threadId, excludeTurns: true },
  )
  const thread = payload.thread
  if (thread.historyMode !== 'paginated' || thread.ephemeral !== false) {
    throw new Error('Editing history requires a persisted paginated thread.')
  }
  if (thread.status?.type === 'active' || thread.status?.type === 'inProgress') {
    throw new Error('Stop the active turn before editing history.')
  }
  // Confirm the persisted ID with native metadata pages before sending a mutation.
  let cursor: string | null = null
  const seen = new Set<string>()
  do {
    const page: TurnsPage = await readTurnsPage(threadId, cursor ?? '', 100, 'notLoaded')
    if (page.data.some(turn => turn.id === beforeTurnId)) return
    cursor = page.nextCursor
    if (cursor && seen.has(cursor)) throw new Error('Native history repeated a cursor. Refresh the conversation.')
    if (cursor) seen.add(cursor)
  } while (cursor)
  throw new Error('The selected turn is no longer available. Refresh the thread.')
}

export async function revertThreadHistory(threadId: string, beforeTurnId: string): Promise<void> {
  await callRpc('thread/revert', { threadId, beforeTurnId })
  invalidateResumeThread(threadId)
}

type StartedThread = {
  projectId?: string | null
  threadId: string
  model: string
  modelProvider: string
}

type ForkedThread = {
  projectId?: string | null
  threadId: string
  cwd: string
  model: string
  modelProvider?: string
  messages: UiMessage[]
}

export async function startThread(cwd?: string, model?: string, modelProvider?: string, projectId?: string): Promise<StartedThread> {
  try {
    const selection = parseModelSelection(model || '')
    model = selection.model
    modelProvider ||= selection.provider
    const params: Record<string, unknown> = {}
    if (projectId) params.projectId = projectId
    if (modelProvider) params.modelProvider = modelProvider
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      params.cwd = cwd.trim()
    }
    if (typeof model === 'string' && model.trim().length > 0) {
      params.model = model.trim()
    }
    const payload = await callRpc<ThreadStartResponse>('thread/start', params)
    const threadId = normalizeThreadIdFromPayload(payload)
    if (!threadId) {
      throw new Error('thread/start did not return a thread id')
    }
    return {
      threadId,
      projectId: payload.thread.projectId,
      model: normalizeThreadModelFromPayload(payload),
      modelProvider: normalizeThreadModelProviderFromPayload(payload),
    }
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to start a new thread', 'thread/start')
  }
}

export async function forkThreadFromResponse(threadId: string, turnId: string): Promise<ForkedThread> {
  const payload = await callRpc<ThreadForkResponse & { forkCutoff?: { sourceThreadId: string; turnId: string } }>('thread/fork-at-response', {
    threadId, turnId, persistExtendedHistory: true,
  })
  if (payload.forkCutoff?.sourceThreadId !== threadId || payload.forkCutoff.turnId !== turnId) {
    throw new Error('Backend did not verify the response fork cutoff; update the web backend')
  }
  const id = normalizeThreadIdFromPayload(payload)
  if (!id) throw new Error('thread/fork did not return a thread id')
  return {
    threadId: id,
    projectId: payload.thread.projectId,
    cwd: normalizeThreadCwdFromPayload(payload),
    model: normalizeThreadModelFromPayload(payload),
    modelProvider: normalizeThreadModelProviderFromPayload(payload),
    messages: normalizeThreadMessagesV2(payload),
  }
}

// A loaded thread cannot reliably be reconfigured by thread/resume. Fork its
// exact persisted prefix with supported overrides instead, before any new turn.

export async function forkThread(threadId: string): Promise<ForkedThread>
export async function forkThread(threadId: string, cwd: string | undefined, model: string | undefined): Promise<StartedThread>
export async function forkThread(
  threadId: string,
  cwd?: string,
  model?: string,
): Promise<StartedThread | ForkedThread> {
  if (arguments.length <= 1) {
    try {
      const payload = await callRpc<ThreadForkResponse & ThreadReadResponse & { thread?: { id?: string; cwd?: string } }>('thread/fork', {
        threadId,
        persistExtendedHistory: true,
      })
      const forkedThreadId = normalizeThreadIdFromPayload(payload)
      if (!forkedThreadId) {
        throw new Error('thread/fork did not return a thread id')
      }
      return {
        threadId: forkedThreadId,
        projectId: payload.thread.projectId,
        cwd: normalizeThreadCwdFromPayload(payload),
        model: normalizeThreadModelFromPayload(payload),
        modelProvider: normalizeThreadModelProviderFromPayload(payload),
        messages: normalizeThreadMessagesV2(payload),
      }
    } catch (error) {
      throw normalizeCodexApiError(error, `Failed to fork thread ${threadId}`, 'thread/fork')
    }
  }

  try {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) {
      throw new Error('thread/fork requires threadId')
    }
    const params: Record<string, unknown> = {
      threadId: normalizedThreadId,
    }
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      params.cwd = cwd.trim()
    }
    if (typeof model === 'string' && model.trim()) {
      const selection = parseModelSelection(model.trim())
      params.model = selection.model
      if (selection.provider) params.modelProvider = selection.provider
    }
    const payload = await callRpc<ThreadForkResponse>('thread/fork', params)
    const nextThreadId = normalizeThreadIdFromPayload(payload)
    if (!nextThreadId) {
      throw new Error('thread/fork did not return a thread id')
    }
    return {
      threadId: nextThreadId,
      projectId: payload.thread.projectId,
      model: normalizeThreadModelFromPayload(payload),
      modelProvider: normalizeThreadModelProviderFromPayload(payload),
    }
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to fork thread ${threadId}`, 'thread/fork')
  }
}

async function resolveCollaborationModeModel(mode: CollaborationModeKind, model?: string): Promise<string> {
  if (model?.trim()) return model.trim()
  try {
    const config = await getCurrentModelConfig()
    if (config.model.trim()) return config.model.trim()
  } catch {}
  try {
    const catalog = await getAvailableModelIds()
    if (catalog.ids.length) return catalog.ids[0]!
  } catch {}
  throw new Error(`${mode === 'plan' ? 'Plan' : 'Default'} mode requires an available model. Wait for models to load and try again.`)
}

export async function startThreadTurn(
  threadId: string,
  text: string,
  imageUrls: string[] = [],
  model?: string,
  effort?: ReasoningEffort,
  skills?: Array<{ name: string; path: string }>,
  fileAttachments: FileAttachmentParam[] = [],
  collaborationMode?: CollaborationModeKind,
  speedMode?: SpeedMode,
  apps?: import('./apps').AppReference[],
): Promise<string> {
  try {
    const normalizedModel = model?.trim() ?? ''
    const { input, attachments } = buildTurnInput(text, imageUrls, skills, fileAttachments)
    if (apps?.length) input.push(...nativeAppInputs(apps))
    const params: Record<string, unknown> = {
      threadId,
      input,
    }
    if (attachments.length > 0) params.attachments = attachments
    const resolvedModel = collaborationMode ? await resolveCollaborationModeModel(collaborationMode, normalizedModel) : normalizedModel
    const reasoningModel = findReasoningModel(resolvedModel)
    if (speedMode === 'fast' && fastModeAvailability(reasoningModel) !== 'supported') {
      throw new Error('Fast mode support is unavailable or unknown for this provider/model. Select Standard mode or a supported model.')
    }
    if (speedMode) params.serviceTierForTurn = speedMode === 'fast' ? 'fast' : 'default'
    const resolvedEffort = resolveReasoningEffort(reasoningModel, effort)
    if (resolvedModel) params.model = parseModelSelection(resolvedModel).model
    if (resolvedEffort) params.effort = resolvedEffort
    if (collaborationMode) {
      params.collaborationMode = {
        mode: collaborationMode,
        settings: {
          model: parseModelSelection(resolvedModel).model,
          reasoning_effort: resolvedEffort || null,
          developer_instructions: null,
        },
      }
    }
    const payload = await callRpc<{ turn?: Turn }>('turn/start', params)
    invalidateResumeThread(threadId)
    const turnId = typeof payload?.turn?.id === 'string' ? payload.turn.id.trim() : ''
    return turnId
  } catch (error) {
    const normalized = normalizeCodexApiError(error, `Failed to start turn for thread ${threadId}`, 'turn/start')
    if (/modelProviderMismatch|This chat uses .+current provider/is.test(normalized.message)) {
      throw new Error(`The app-server rejected this thread's provider. No message was accepted. This server must support running a fork with its selected provider independently of the server default. ${normalized.message}`)
    }
    throw normalized
  }
}

export async function interruptThreadTurn(threadId: string, turnId?: string): Promise<void> {
  const normalizedThreadId = threadId.trim()
  const normalizedTurnId = turnId?.trim() || ''
  if (!normalizedThreadId) return

  try {
    if (!normalizedTurnId) {
      throw new Error('turn/interrupt requires turnId')
    }
    await callRpc('turn/interrupt', { threadId: normalizedThreadId, turnId: normalizedTurnId })
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to interrupt turn for thread ${normalizedThreadId}`, 'turn/interrupt')
  }
}

export async function setCodexSpeedMode(mode: SpeedMode): Promise<void> {
  const normalizedMode: SpeedMode = mode === 'fast' ? 'fast' : 'standard'
  await callRpc('config/batchWrite', {
    edits: [
      {
        keyPath: 'features.fast_mode',
        value: true,
        mergeStrategy: 'upsert',
      },
      {
        keyPath: 'service_tier',
        value: normalizedMode === 'fast' ? 'fast' : null,
        mergeStrategy: normalizedMode === 'fast' ? 'upsert' : 'replace',
      },
    ],
    filePath: null,
    expectedVersion: null,
  })
}

// Model capabilities come exclusively from the running Codex app-server.
export const reasoningCatalog = ref<ReasoningModel[]>([])

// Tokens retain no composable/component objects and never duplicate catalog data.
// The boolean records whether this lifecycle has a successful refresh since its last failure.
const reasoningCatalogOwners = new Map<symbol, boolean>()
let reasoningCatalogRefreshSequence = 0
let reasoningCatalogPublishedSequence = 0

export function acquireReasoningCatalog() {
  const token = Symbol('reasoning catalog lifecycle')
  reasoningCatalogOwners.set(token, false)
  function refresh(sequence: number) {
    return {
      publish(models: ReasoningModel[]): void {
        if (!reasoningCatalogOwners.has(token)) return
        // Retain lifecycle success ownership even when a newer catalog already won.
        reasoningCatalogOwners.set(token, true)
        if (sequence < reasoningCatalogPublishedSequence) return
        reasoningCatalogPublishedSequence = sequence
        reasoningCatalog.value = models
      },
      fail(): void {
        if (!reasoningCatalogOwners.has(token)) return
        reasoningCatalogOwners.set(token, false)
        if (sequence < reasoningCatalogPublishedSequence) return
        if (![...reasoningCatalogOwners.values()].some(Boolean)) reasoningCatalog.value = []
      },
    }
  }
  return {
    // Order refresh initiation across instances, without changing request scheduling.
    // Only successful publication advances authority; pending/failed work does not.
    beginRefresh() {
      return refresh(++reasoningCatalogRefreshSequence)
    },
    publish(models: ReasoningModel[]): void {
      refresh(++reasoningCatalogRefreshSequence).publish(models)
    },
    fail(): void {
      refresh(++reasoningCatalogRefreshSequence).fail()
    },
    release(): void {
      if (!reasoningCatalogOwners.delete(token)) return
      if (reasoningCatalogOwners.size === 0) reasoningCatalog.value = []
    },
  }
}

export function findReasoningModel(model: string): ReasoningModel | null {
  return findReasoningModelInCatalog(reasoningCatalog.value, model)
}

type ModelProvider = { id: string; displayName?: string; name?: string; isDefault?: boolean; defaultModel?: string }
type ModelCatalog = { ids: string[]; models: ReasoningModel[]; defaultProvider?: string; failures?: string[] }

function unsupportedCatalogMethod(error: unknown): boolean {
  return /-32601|-32602|method.*(not found|unsupported|unknown)|unknown.*method|unsupported.*method|invalid params|unknown field.*modelProvider/i.test(String(error))
}

async function loadModelCatalog(): Promise<ModelCatalog> {
  async function pages(modelProvider?: string): Promise<ReasoningModel[]> {
    const models: ReasoningModel[] = []
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await callRpc<ModelListResponse>('model/list', {
        ...(modelProvider ? { modelProvider } : {}),
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      } satisfies ModelListParams)
      if (!Array.isArray(page?.data)) throw new Error('Invalid model list response')
      for (const model of page.data) {
        if (model && ((typeof model.id === 'string' && model.id.trim()) || (typeof model.model === 'string' && model.model.trim()))) models.push({ ...model, modelProvider: (model as ReasoningModel).modelProvider?.trim() || undefined })
      }
      cursor = page?.nextCursor?.trim() || undefined
      if (!cursor || seen.has(cursor)) break
      seen.add(cursor)
    } while (cursor)
    return models
  }
  function catalog(models: ReasoningModel[], extra = {}): ModelCatalog {
    return { ids: [...new Set(models.filter(m => !m.hidden).map((m) => modelSelectionKey(m.modelProvider || '', m.id?.trim() || m.model?.trim() || '')))], models, ...extra }
  }
  async function legacy(): Promise<ModelCatalog> {
    try { return catalog(await pages()) } catch { return catalog([]) }
  }
  let providers: ModelProvider[]
  let defaultProvider: string | undefined
  try {
    const result = await callRpc<{ data?: ModelProvider[]; providers?: ModelProvider[]; defaultProvider?: string; defaultModelProvider?: string; defaultProviderId?: string }>('modelProvider/list', {})
    providers = [...new Map((result.data ?? result.providers ?? []).filter((p) => typeof p?.id === 'string' && p.id.trim()).map((p) => [p.id.trim(), { ...p, id: p.id.trim() }])).values()]
    defaultProvider = result.defaultProvider || result.defaultProviderId || result.defaultModelProvider || providers.find((p) => p.isDefault)?.id
    defaultProvider = defaultProvider?.trim() || undefined
  } catch (error) {
    if (!unsupportedCatalogMethod(error)) return { ids: [], models: [] }
    // config/read exposes custom provider tables through its flattened config fields.
    // Only explicit IDs are usable; do not guess built-in providers or the default.
    try {
      const { config } = await callRpc<ConfigReadResponse>('config/read', {})
      const configured = config.model_providers
      providers = configured && typeof configured === 'object' && !Array.isArray(configured)
        ? Object.entries(configured).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
          .map(([id, value]) => ({ id, name: typeof (value as Record<string, unknown>).name === 'string' ? String((value as Record<string, unknown>).name) : id })) : []
      defaultProvider = config.model_provider?.trim() || undefined
      if (defaultProvider && !providers.some(p => p.id === defaultProvider)) providers.push({ id: defaultProvider })
    } catch { return legacy() }
  }
  if (!providers.length) return legacy()
  const models: ReasoningModel[] = []
  const failures: string[] = []
  // Serial provider walks bound fanout to one RPC, including pagination.
  for (const provider of providers) {
    try {
      const data = await pages(provider.id)
      const providerDefaultModel = provider.defaultModel?.trim()
        || data.find(model => model.isDefault)?.id?.trim()
        || data.find(model => model.isDefault)?.model?.trim()
      models.push(...data.map(model => ({ ...model, modelProvider: provider.id,
        ...(providerDefaultModel ? { providerDefaultModel } : {}),
        providerDisplayName: provider.displayName || provider.name || provider.id })))
    } catch { failures.push(provider.id) }
  }
  return catalog(models, { defaultProvider, failures })
}

let pendingModelCatalog: Promise<ModelCatalog> | undefined
export function getAvailableModelIds(): Promise<ModelCatalog> {
  if (!pendingModelCatalog) pendingModelCatalog = loadModelCatalog().finally(() => { pendingModelCatalog = undefined })
  return pendingModelCatalog
}

export async function getCurrentModelConfig(): Promise<CurrentModelConfig> {
  const payload = await callRpc<ConfigReadResponse>('config/read', {})
  const model = payload.config.model ?? ''
  const reasoningEffort = normalizeReasoningEffort(payload.config.model_reasoning_effort)
  const speedMode = normalizeSpeedMode(payload.config.service_tier)
  return { model, modelProvider: payload.config.model_provider?.trim() || undefined, reasoningEffort, speedMode }
}

export async function listDirectoryMcpServers(): Promise<DirectoryMcpServerStatus[]> {
  const servers: DirectoryMcpServerStatus[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  do {
    const params: Record<string, unknown> = {}
    if (cursor) params.cursor = cursor
    const payload = await callRpc<{ data?: unknown[]; nextCursor?: string | null; next_cursor?: string | null }>('mcpServerStatus/list', params)
    for (const item of payload.data ?? []) {
      const server = normalizeDirectoryMcpServer(item)
      if (server) servers.push(server)
    }
    cursor = readString(payload.nextCursor ?? payload.next_cursor)
    if (!cursor || seenCursors.has(cursor)) break
    seenCursors.add(cursor)
  } while (cursor)
  return servers
}

export async function reloadDirectoryMcpServers(): Promise<void> {
  await callRpc('config/mcpServer/reload', {})
}

export async function startDirectoryMcpLogin(name: string): Promise<DirectoryMcpLoginResult> {
  const payload = await callRpc<{ authorizationUrl?: string; authorization_url?: string }>('mcpServer/oauth/login', { name })
  return {
    authorizationUrl: readString(payload.authorizationUrl ?? payload.authorization_url) ?? '',
  }
}

function normalizeCollaborationModeLabel(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (segment) => segment.toUpperCase())
}

export async function getAvailableCollaborationModes(): Promise<CollaborationModeOption[]> {
  try {
    const payload = await callRpc<CollaborationModeListResponse>('collaborationMode/list', {})
    const seen = new Set<CollaborationModeKind>()
    const normalized: CollaborationModeOption[] = []

    for (const row of payload.data) {
      const mode = row.mode
      if (mode !== 'default' && mode !== 'plan') continue
      if (seen.has(mode)) continue
      seen.add(mode)
      normalized.push({
        value: mode,
        label: normalizeCollaborationModeLabel(row.name || mode) || (mode === 'plan' ? 'Plan' : 'Default'),
      })
    }

    if (normalized.length > 0) {
      for (const fallback of DEFAULT_COLLABORATION_MODE_OPTIONS) {
        if (!seen.has(fallback.value)) {
          normalized.push(fallback)
        }
      }
      return normalized.sort((first, second) => (
        first.value === second.value ? 0 : first.value === 'default' ? -1 : 1
      ))
    }
  } catch {
    // Fall back to static options when the app-server does not expose presets.
  }

  return DEFAULT_COLLABORATION_MODE_OPTIONS
}

export async function getProjects(): Promise<Project[]> {
  try {
    return await listNativeProjects(rpcCall)
  } catch (error) {
    if (asRecord(error)?.rpcCode === -32601) {
      throw new Error('The connected server does not support native Projects. Upgrade Codex App Server.')
    }
    throw error
  }
}

export async function getHomeDirectory(): Promise<string> {
  const response = await fetch('/codex-api/home-directory')
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error('Failed to load home directory')
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  return typeof data.path === 'string' ? data.path.trim() : ''
}

export async function listLocalDirectories(path: string, options?: { showHidden?: boolean }): Promise<LocalDirectoryListing> {
  const query = new URLSearchParams({ path })
  if (options?.showHidden === true) {
    query.set('showHidden', '1')
  }
  const response = await fetch(`/codex-local-directories?${query.toString()}`)
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to load local directories')
    throw new Error(message)
  }

  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {}
  const entriesRaw = Array.isArray(data.entries) ? data.entries : []

  return {
    path: typeof data.path === 'string' ? normalizePathForUi(data.path) : '',
    parentPath: typeof data.parentPath === 'string' ? normalizePathForUi(data.parentPath) : '',
    entries: entriesRaw.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      const entryPath = typeof record.path === 'string' ? normalizePathForUi(record.path) : ''
      return name && entryPath ? [{ name, path: entryPath }] : []
    }),
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error(`Expected JSON response from ${response.url || 'request'}`)
  }
}

export async function searchComposerFiles(cwd: string, query: string, limit = 20): Promise<ComposerFileSuggestion[]> {
  const trimmedCwd = cwd.trim()
  if (!trimmedCwd) return []
  const response = await fetch('/codex-api/composer-file-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: trimmedCwd,
      query: query.trim(),
      limit,
    }),
  })
  const payload = (await response.json()) as unknown
  if (!response.ok) {
    const message = getErrorMessageFromPayload(payload, 'Failed to search files')
    throw new Error(message)
  }
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const data = Array.isArray(record.data) ? record.data : []
  const suggestions: ComposerFileSuggestion[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const rawPath = row.path
    const value = typeof rawPath === 'string' ? rawPath.trim() : ''
    if (!value) continue
    suggestions.push({ path: value })
  }
  return suggestions
}

export async function searchThreads(query: string): Promise<ThreadSearchResult> {
  const threads: ThreadListResponse['data'] = []
  const cursors = new Set<string>()
  let cursor: string | null = null
  if (!query.trim()) return { threadIds: [], groups: [] }
  do {
    const page: { data: Array<{ thread: ThreadListResponse['data'][number] }>; nextCursor: string | null } =
      await callRpc('thread/search', {
        searchTerm: query.trim(), archived: false, sortKey: 'updated_at',
        sortDirection: 'desc', limit: 100, cursor,
      })
    threads.push(...page.data.map(row => row.thread))
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor)) throw new Error('Thread search returned a repeated pagination cursor')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return { threadIds: threads.map(thread => thread.id), groups: normalizeThreadGroupsV2({ data: threads, nextCursor: null }) }
}

function getErrorMessageFromPayload(payload: unknown, fallback: string): string {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
  const message = record.message
  if (typeof message === 'string' && message.trim().length > 0) {
    return message
  }
  const error = record.error
  return typeof error === 'string' && error.trim().length > 0 ? error : fallback
}

type ThreadPinnedState = { threadIds: string[] }

export async function getPinnedThreadState(): Promise<ThreadPinnedState> {
  const response = await fetch('/codex-api/thread-pins')
  const payload = await readJsonResponse(response)
  if (!response.ok) throw new Error(getErrorMessageFromPayload(payload, 'Failed to load native pins'))
  const data = (payload as { data?: ThreadPinnedState }).data
  if (!Array.isArray(data?.threadIds) || data.threadIds.some(id => typeof id !== 'string')) throw new Error('Malformed native pin state')
  return data
}

export async function setThreadPinned(threadId: string, pinned: boolean, beforeThreadId?: string): Promise<void> {
  await callRpc('thread/section/move', {
    threadId,
    sectionId: pinned ? '01984de2-8f74-7c91-a3b2-5c5e937cf318' : null,
    ...(pinned && beforeThreadId ? { beforeThreadId } : {}),
  })
}

export async function getSkillsList(cwds?: string[]): Promise<SkillInfo[]> {
  try {
    const params: Record<string, unknown> = {}
    if (cwds && cwds.length > 0) params.cwds = cwds
    const payload = await callRpc<{ data: SkillsListResponseEntry[] }>('skills/list', params)
    return normalizeSkillsList(payload.data)
  } catch {
    return []
  }
}

const FILE_UPLOAD_TIMEOUT_MS = 60_000

export async function uploadFile(file: File): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FILE_UPLOAD_TIMEOUT_MS)
  try {
    const form = new FormData()
    form.append('file', file)
    const resp = await fetch('/codex-api/upload-file', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { path?: string }
    return data.path ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

export const THREAD_GOAL_STATUSES = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const
export type ThreadGoalStatus = typeof THREAD_GOAL_STATUSES[number]
export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

function normalizeThreadGoal(value: unknown): ThreadGoal {
  const row = asRecord(value)
  if (!row || typeof row.threadId !== 'string' || !row.threadId.trim()
    || typeof row.objective !== 'string'
    || !THREAD_GOAL_STATUSES.includes(row.status as ThreadGoalStatus)) {
    throw new Error('Thread goal response was malformed')
  }
  return {
    threadId: row.threadId,
    objective: row.objective,
    status: row.status as ThreadGoalStatus,
    tokenBudget: readNumber(row.tokenBudget),
    tokensUsed: readNumber(row.tokensUsed) ?? 0,
    timeUsedSeconds: readNumber(row.timeUsedSeconds) ?? 0,
    createdAt: readNumber(row.createdAt) ?? 0,
    updatedAt: readNumber(row.updatedAt) ?? 0,
  }
}

export async function getThreadGoal(threadId: string): Promise<ThreadGoal | null> {
  if (!threadId.trim()) return null
  const result = await callRpc<{ goal?: unknown }>('thread/goal/get', { threadId: threadId.trim() })
  return result.goal == null ? null : normalizeThreadGoal(result.goal)
}

export async function setThreadGoal(threadId: string, changes: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }): Promise<ThreadGoal> {
  if (!threadId.trim()) throw new Error('thread/goal/set requires threadId')
  const result = await callRpc<{ goal: unknown }>('thread/goal/set', { ...changes, threadId: threadId.trim() })
  return normalizeThreadGoal(result.goal)
}

export async function clearThreadGoal(threadId: string): Promise<boolean> {
  if (!threadId.trim()) return false
  return (await callRpc<{ cleared: boolean }>('thread/goal/clear', { threadId: threadId.trim() })).cleared === true
}

// Revision comes from the row actually seen; never retry a conflict with a newer revision.
export async function markNativeThreadRead(threadId: string, expectedRevision: string): Promise<import('../types/codex').NativeThreadReadState> {
  const result = await callRpc<{ readState: import('../types/codex').NativeThreadReadState }>('thread/readState/update', { threadId, operation: { type: 'read' }, expectedRevision })
  return result.readState
}

export async function prepareConversationTransfer(threadId: string, target?: import('../types/codex').ResponseForkTarget, revertTarget?: import('../types/codex').PortableRevertTarget): Promise<{ id: string; messageCount: number; sourceModelProvider?: string }> {
  return callRpc('conversation-transfer/prepare', { threadId, target, revertTarget })
}
export async function cancelConversationTransfer(id: string): Promise<void> {
  await callRpc('conversation-transfer/cancel', { id })
}
export async function createConversationTransfer(id: string, modelId: string): Promise<StartedThread & { draftText?: string }> {
  const { model, provider } = parseModelSelection(modelId)
  if (!model || !provider) throw new Error('Select a configured provider and model.')
  try {
    return await callRpc('conversation-transfer/create', { id, model, modelProvider: provider })
  } catch (cause) {
    // Read the durable receipt only. Appending history is never retried.
    let receipt: (StartedThread & { stage: string; draftText?: string }) | undefined
    try { receipt = await callRpc('conversation-transfer/status', { id }) } catch { /* preserve the original error */ }
    if (receipt?.stage === 'ready' && receipt.threadId && receipt.model === model && receipt.modelProvider === provider) return receipt
    throw new Error(`Transfer ${id}: destination ${receipt?.threadId || 'not acknowledged'}, stage ${receipt?.stage || 'unknown'}. ${cause instanceof Error ? cause.message : String(cause)} Do not replay injection.`)
  }
}

/** Regenerate remote rollout evidence without reloading conversation items. */
export async function refreshThreadGenerationMetadata(threadId: string): Promise<void> {
  await callRpc('thread/generationMetadata/refresh', { threadId })
}
