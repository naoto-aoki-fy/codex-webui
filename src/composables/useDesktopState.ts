import { reloadForConnectionProfile } from '../utils/browserConnectionProfile'
import { modelSelectionKey, parseModelSelection } from '../api/modelCapabilities'
import { markNativeThreadRead } from '../api/codexGateway'
import { orderModelIdsByUsage, buildModelCatalogIds, resolveModelPreference } from '../utils/desktopModelPreferences'
import {
  toProjectNameFromWorkspaceRoot,
  getRemoteProjectDisplayName,
  getWorkspaceProjectOrderPaths,
  getWorkspaceProjectOrderNames,
  getWorkspaceProjectId,
  collectDuplicateProjectLeafNames,
  filterGroupsByWorkspaceRoots,
} from '../utils/desktopProjectGroups'
export {
  collectWorkspaceRootPathsForProjectRemoval,
  filterGroupsByWorkspaceRoots,
} from '../utils/desktopProjectGroups'
import {
  extractLocalImagePathFromUrl,
  readPlanUpdate,
  asRecord,
  readString,
  readNumber,
  readThreadTokenUsageUpdate,
  extractThreadIdFromNotification,
  readTurnErrorMessage,
  readNotificationErrorState,
  normalizePendingServerRequestMethod,
  readTurnActivity,
  liveReasoningMessageId,
  readReasoningStartedItemId,
  readReasoningDelta,
  readReasoningSectionBreakMessageId,
  readReasoningCompletedId,
  readAgentMessageStartedId,
  readAgentMessageDelta,
  readAgentMessageCompleted,
  readCompletedImageView,
  readCommandOutputDelta,
  isAgentContentEvent,
  type TurnActivityState,
} from './desktopNotificationReaders'
import {
  MODEL_USAGE_STORAGE_KEY,
  loadModelUsageOrder,
  REASONING_BY_MODEL_STORAGE_KEY,
  NEW_THREAD_COLLABORATION_MODE_CONTEXT,
  NEW_THREAD_MODEL_CONTEXT,
  normalizeStoredModelId,
  createStringKeyedRecord,
  cloneStringKeyedRecord,
  omitStringKeyedRecordKey,
  pruneThreadContextStateMap,
  isNewThreadContextId,
  toThreadContextId,
  loadSelectedModelMap,
  readSelectedModel,
  saveSelectedModelMap,
  loadReasoningPreferences,
  loadSelectedCollaborationModeMap,
  readSelectedCollaborationMode,
  writeSelectedCollaborationModeForContext,
  saveSelectedCollaborationModeMap,
  loadThreadTokenUsageMap,
  saveThreadTokenUsageMap,
  loadSelectedThreadId,
  saveSelectedThreadId,
} from './desktopStatePersistence'
import {
  areStringArraysEqual,
  areMessageArraysEqual,
  mergeMessages,
  normalizeMessageText,
  isOptimisticUserMessage,
  hasOptimisticUserMessages,
  removeRedundantLiveAgentMessages,
  upsertMessage,
} from '../utils/desktopMessageReconciliation'
import { computed, ref, watch } from 'vue'
import { formatTurnDuration, parseIsoTimestamp } from '../utils/turnTiming'
import {

  archiveThread,
  forkThread,
  configureFreshFork,
  forkThreadFromResponse,
  getAvailableCollaborationModes,
  getAccountRateLimits,
  renameThread,
  getAvailableModelIds,
  acquireReasoningCatalog,
  reasoningCatalog,
  reasoningOptions,
  resolveReasoningEffort,
  findReasoningModel,
  getCurrentModelConfig,
  getPendingServerRequests,
  getSkillsList,
  getThreadDetail,
  getOlderThreadMessages,
  getBackgroundThreadListLimit,
  interruptThreadTurn,
  pickCodexRateLimitSnapshot,
  replyToServerRequest,
  revertThreadHistory,
  validateThreadRevert,
  invalidateResumeThread,
  resumeThreadSubscription,
  getThreadGroupsPage,
  getWorkspaceRootsState,
  getWorkspaceRootsStateGeneration,
  setCodexSpeedMode,
  updateWorkspaceRootsState,
  invalidateWorkspaceRootsStateCache,
  resumeThread,

  startThread,
  subscribeCodexNotifications,
  startThreadTurn,
  type RpcNotification,
  type SkillInfo,
  type WorkspaceRootsState,
} from '../api/codexGateway'
import { CodexApiError } from '../api/codexErrors'
import { normalizeFileChangeStatus, toUiFileChanges } from '../api/normalizers/v2'
import { readGenerationMetadata, mergeGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata'
import type {
  CollaborationModeKind,
  CollaborationModeOption,
  CommandExecutionData,
  UiPendingRequestState,
  ReasoningEffort,
  SpeedMode,
  UiFileChange,
  UiLiveOverlay,
  UiMessage,
  UiPlanData,
  UiProjectGroup,
  UiRateLimitSnapshot,
  UiServerRequest,
  UiServerRequestReply,
  UiThreadTokenUsage,
  UiThread,
} from '../types/codex'
import { getPathParent, normalizePathForUi, toProjectName } from '../pathUtils.js'

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

export function findAdjacentThreadId(threads: UiThread[], threadId: string): string {
  const targetIndex = threads.findIndex((thread) => thread.id === threadId)
  if (targetIndex < 0) return ''
  return threads[targetIndex + 1]?.id ?? threads[targetIndex - 1]?.id ?? ''
}

const EVENT_SYNC_DEBOUNCE_MS = 220
const BACKGROUND_THREAD_PAGINATION_DELAY_MS = 10_000
const RATE_LIMIT_REFRESH_DEBOUNCE_MS = 500
const TURN_START_FOLLOW_UP_SYNC_DELAY_MS = 3000
const RECENT_THREAD_MESSAGE_LOAD_REUSE_MS = 2000
const RECENT_THREAD_LIST_LOAD_REUSE_MS = 2000
const LOCAL_THREAD_CONFIRMATION_GRACE_MS = 120_000
const LOCAL_THREAD_RECONCILIATION_INTERVAL_MS = 5000
const RECENT_SKILLS_LOAD_REUSE_MS = 2000
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const CODEX_CLI_MISSING_MESSAGE = 'Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'
type SelectThreadResult = 'ok' | 'not-found' | 'error'

function isCodexCliMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('Codex CLI is not available')
}

function isThreadNotFoundError(error: unknown): boolean {
  if (error instanceof CodexApiError && error.status === 404) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\b404\b|thread.*not found|conversation.*not found|no such thread|no rollout found for thread id/i.test(message)
}

type TurnSummaryState = {
  turnId: string
  durationMs: number
}

type TurnErrorState = {
  message: string
  transient: boolean
}

type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type TurnCompletedInfo = {
  threadId: string
  turnId: string
  completedAtMs: number
  startedAtMs?: number
}

const WORKED_MESSAGE_TYPE = 'worked'

function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.turnId === second.turnId && first.durationMs === second.durationMs
}

function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.label !== second.label) return false
  if (first.details.length !== second.details.length) return false
  for (let index = 0; index < first.details.length; index += 1) {
    if (first.details[index] !== second.details[index]) return false
  }
  return true
}

function buildTurnSummaryMessage(summary: TurnSummaryState): UiMessage {
  return {
    id: `turn-summary:${summary.turnId}`,
    role: 'system',
    text: `Worked for ${formatTurnDuration(summary.durationMs)}`,
    messageType: WORKED_MESSAGE_TYPE,
    turnId: summary.turnId,
  }
}

function findLastAssistantMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index
    }
  }
  return -1
}

function insertTurnSummaryMessage(messages: UiMessage[], summary: TurnSummaryState): UiMessage[] {
  const summaryMessage = buildTurnSummaryMessage(summary)
  const sanitizedMessages = messages.filter((message) => message.messageType !== WORKED_MESSAGE_TYPE)
  const insertIndex = findLastAssistantMessageIndex(sanitizedMessages)
  if (insertIndex < 0) {
    return [...sanitizedMessages, summaryMessage]
  }
  const next = [...sanitizedMessages]
  next.splice(insertIndex, 0, summaryMessage)
  return next
}

function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return (
    first.id === second.id &&
    first.title === second.title &&
    first.projectName === second.projectName &&
    first.cwd === second.cwd &&
    first.createdAtIso === second.createdAtIso &&
    first.updatedAtIso === second.updatedAtIso &&
    first.preview === second.preview &&
    first.nativeReadState?.revision === second.nativeReadState?.revision &&
    first.unread === second.unread &&
    first.inProgress === second.inProgress &&
    first.pendingRequestState === second.pendingRequestState
  )
}

function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  const nextEntries = Object.entries(stateMap).filter(([threadId]) => threadIds.has(threadId))
  if (nextEntries.length === Object.keys(stateMap).length) {
    return stateMap
  }
  return Object.fromEntries(nextEntries) as Record<string, T>
}

export function removeThreadFromGroups(groups: UiProjectGroup[], threadId: string): UiProjectGroup[] {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return groups

  let changed = false
  const nextGroups: UiProjectGroup[] = []

  for (const group of groups) {
    const nextThreads = group.threads.filter((thread) => thread.id !== normalizedThreadId)
    const removedFromGroup = nextThreads.length !== group.threads.length
    if (removedFromGroup) {
      changed = true
    }
    if (nextThreads.length > 0) {
      nextGroups.push(removedFromGroup ? { ...group, threads: nextThreads } : group)
    } else if (group.threads.length === 0) {
      nextGroups.push(group)
    }
  }

  return changed ? nextGroups : groups
}

function mergeThreadGroups(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
): UiProjectGroup[] {
  const previousGroupsByName = new Map(previous.map((group) => [group.projectName, group]))
  const mergedGroups: UiProjectGroup[] = incoming.map((incomingGroup) => {
    const previousGroup = previousGroupsByName.get(incomingGroup.projectName)
    const previousThreadsById = new Map(previousGroup?.threads.map((thread) => [thread.id, thread]) ?? [])

    const mergedThreads = incomingGroup.threads.map((incomingThread) => {
      const previousThread = previousThreadsById.get(incomingThread.id)
      if (previousThread && areThreadFieldsEqual(previousThread, incomingThread)) {
        return previousThread
      }
      return incomingThread
    })

    if (
      previousGroup &&
      previousGroup.projectName === incomingGroup.projectName &&
      areThreadArraysEqual(previousGroup.threads, mergedThreads)
    ) {
      return previousGroup
    }

    return {
      projectName: incomingGroup.projectName,
      threads: mergedThreads,
    }
  })

  return areGroupArraysEqual(previous, mergedGroups) ? previous : mergedGroups
}

function mergeIncomingWithLocalThreads(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
  inProgressById: Record<string, boolean>,
  awaitingConfirmation: Map<string, number>,
): UiProjectGroup[] {
  const incomingThreadIds = new Set(flattenThreads(incoming).map((thread) => thread.id))
  const localThreads = flattenThreads(previous).filter(
    (thread) => (inProgressById[thread.id] === true || awaitingConfirmation.has(thread.id))
      && !incomingThreadIds.has(thread.id),
  )
  if (localThreads.length === 0) return incoming

  const groupsByProject = new Map(incoming.map((group) => [group.projectName, {
    projectName: group.projectName,
    threads: [...group.threads],
  }]))
  for (const thread of localThreads) {
    let group = groupsByProject.get(thread.projectName)
    if (!group) {
      group = { projectName: thread.projectName, threads: [] }
      groupsByProject.set(thread.projectName, group)
    }
    group.threads.push(thread)
  }
  return Array.from(groupsByProject.values()).map((group) => ({
    ...group,
    threads: group.threads.sort(
      (first, second) => new Date(second.updatedAtIso).getTime() - new Date(first.updatedAtIso).getTime(),
    ),
  }))
}

function toOptimisticThreadTitle(message: string): string {
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) return 'Untitled thread'
  return firstLine.slice(0, 80)
}

function toForkedThreadTitle(title: string): string {
  const normalizedTitle = title.trim() || 'Untitled thread'
  return /^fork:\s+/iu.test(normalizedTitle) ? normalizedTitle : `Fork: ${normalizedTitle}`
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const persistedMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const livePlanMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveAgentMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveReasoningTextByThreadId = ref<Record<string, string>>({})
  const liveCommandsByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveFileChangeMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const inProgressById = ref<Record<string, boolean>>({})
  type FileAttachment = { label: string; path: string; fsPath: string }
  type PendingTurnRequest = {
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    effort: ReasoningEffort | ''
    collaborationMode: CollaborationModeKind
  }
  const availableModelIds = ref<string[]>([])
  const modelUsageOrder = ref(loadModelUsageOrder())
  const orderedModelIds = computed(() => orderModelIdsByUsage(availableModelIds.value, modelUsageOrder.value))

  function recordModelUsage(modelId: string): void {
    const model = modelId.trim()
    if (!model || modelUsageOrder.value[0] === model) return
    modelUsageOrder.value = [model, ...modelUsageOrder.value.filter((id) => id !== model)]
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MODEL_USAGE_STORAGE_KEY, JSON.stringify(modelUsageOrder.value))
      }
    } catch {
      // Keep in-memory ordering working when storage is unavailable.
    }
  }
  const availableCollaborationModes = ref<CollaborationModeOption[]>([
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan' },
  ])
  const selectedCollaborationModeByContext = ref<Record<string, CollaborationModeKind>>(
    loadSelectedCollaborationModeMap(),
  )
  const selectedModelIdByContext = ref<Record<string, string>>(loadSelectedModelMap())
  const selectedCollaborationMode = ref<CollaborationModeKind>(
    readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value),
  )
  const selectedModelId = ref(readSelectedModel(selectedModelIdByContext.value, selectedThreadId.value))
  const reasoningByModel = ref(loadReasoningPreferences())
  // Automatic catalog fallbacks affect the display, never the saved user choice.
  const automaticModelByContext = ref(createStringKeyedRecord<string>())
  const selectedReasoningEffort = computed(() => readReasoningEffortForThread(selectedThreadId.value))
  const selectedSpeedMode = ref<SpeedMode>('standard')
  const codexCliMissingError = ref('')
  try {
    window.localStorage.removeItem('codex-web-local.project-order.v1')
    window.localStorage.removeItem('codex-web-local.project-display-name.v1')
  } catch { /* Storage may be unavailable. */ }
  const projectDisplayNameById = ref<Record<string, string>>({})
  const loadedVersionByThreadId = ref<Record<string, string>>({})
  const loadedMessagesByThreadId = ref<Record<string, boolean>>({})
  const hasMoreOlderMessagesByThreadId = ref<Record<string, boolean>>({})
  const loadingOlderMessagesByThreadId = ref<Record<string, boolean>>({})
  let backendInstanceId = ''
  const connectionErrorMessage = 'App-server disconnected. Reconnect and inspect the thread before resending a turn.'
  const transportState = ref('connected')
  const recoveryByThreadId = ref<Record<string, string>>({})
  const recoveryDismissTimerByThreadId = new Map<string, ReturnType<typeof setTimeout>>()
  const unknownOutcomeByThreadId = ref<Record<string, boolean>>({})
  const lostApprovalByThreadId = ref<Record<string, boolean>>({})
  const selectedRecoveryState = computed(() => recoveryByThreadId.value[selectedThreadId.value] ?? '')
  const selectedUnknownOutcome = computed(() => unknownOutcomeByThreadId.value[selectedThreadId.value] === true)
  const selectedLostApproval = computed(() => lostApprovalByThreadId.value[selectedThreadId.value] === true)
  const resumedThreadById = ref<Record<string, boolean>>({})
  const turnIndexByTurnIdByThreadId = ref<Record<string, Record<string, number>>>({})
  const turnSummaryByThreadId = ref<Record<string, TurnSummaryState>>({})
  const turnActivityByThreadId = ref<Record<string, TurnActivityState>>({})
  const turnErrorByThreadId = ref<Record<string, TurnErrorState>>({})
  const activeTurnIdByThreadId = ref<Record<string, string>>({})
  const generationMetadataByThreadId = ref<Record<string, Record<string, TurnGenerationMetadata>>>({})
  function retainGenerationMetadata(threadId: string, turnId: string, metadata: TurnGenerationMetadata) {
    const current = generationMetadataByThreadId.value[threadId]?.[turnId]
    const merged = mergeGenerationMetadata(current, metadata)
    if (JSON.stringify(current) === JSON.stringify(merged)) return
    generationMetadataByThreadId.value = {
      ...generationMetadataByThreadId.value,
      [threadId]: { ...generationMetadataByThreadId.value[threadId], [turnId]: merged },
    }
  }
  const interruptBlockedUntilPersistedByThreadId = ref<Record<string, boolean>>({})
  const threadListedByServerById = ref<Record<string, boolean>>({})
  // Separate from the interrupt gate, which is cleared on turn start/completion.
  const localThreadConfirmationDeadlineById = new Map<string, number>()
  let localThreadReconciliationTimer: number | null = null
  const persistedUserMessageByThreadId = ref<Record<string, boolean>>({})
  const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({})
  const pendingTurnRequestByThreadId = ref<Record<string, PendingTurnRequest>>({})
  const codexRateLimit = ref<UiRateLimitSnapshot | null>(null)
  const threadTokenUsageByThreadId = ref<Record<string, UiThreadTokenUsage>>(loadThreadTokenUsageMap())


  const installedSkills = ref<SkillInfo[]>([])
  const accountRateLimitSnapshots = ref<UiRateLimitSnapshot[]>([])

  const isLoadingThreads = ref(false)
  const isLoadingMessages = ref(false)
  // Only non-silent initial reads own the selected conversation's indicator.
  const visibleMessageLoads = new Set<string>()
  function syncMessageLoading(): void {
    isLoadingMessages.value = visibleMessageLoads.has(selectedThreadId.value)
  }
  watch(selectedThreadId, syncMessageLoading, { flush: 'sync' })
  const isThreadListFullyLoaded = ref(false)
  const isSendingMessage = ref(false)
  const isInterruptingTurn = ref(false)
  const isUpdatingSpeedMode = ref(false)
  const isRollingBack = ref(false)

  const error = ref('')
  const isPolling = ref(false)
  const hasLoadedThreads = ref(false)

  function shouldReuseAttachedImageFromPrompt(promptText: string): boolean {
    const normalized = promptText.trim().toLowerCase()
    if (!normalized) return false
    return /\b(attached image|attached screenshot|save the attached|copy (the )?screenshot|save screenshot)\b/i.test(normalized)
  }

  function findLatestUserLocalImageUrl(threadId: string): string {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    for (let index = persisted.length - 1; index >= 0; index -= 1) {
      const message = persisted[index]
      if (message.role !== 'user' || !Array.isArray(message.images) || message.images.length === 0) continue
      for (let imageIndex = message.images.length - 1; imageIndex >= 0; imageIndex -= 1) {
        const imageUrl = message.images[imageIndex]?.trim() ?? ''
        if (!imageUrl) continue
        if (extractLocalImagePathFromUrl(imageUrl)) return imageUrl
      }
    }
    return ''
  }
  // Work may begin before polling starts; only stop invalidates its ownership.
  let lifecycleGeneration = 0
  let catalogOwnership: ReturnType<typeof acquireReasoningCatalog> | null = null
  function ensureCatalogOwnership() {
    return catalogOwnership ??= acquireReasoningCatalog()
  }
  // Error ownership is per selection, independent of coalesced per-thread history reads.
  let selectionGeneration = 0
  let stopNotificationStream: (() => void) | null = null
  let eventSyncTimer: number | null = null
  let eventSyncGeneration = 0
  let rateLimitRefreshTimer: number | null = null
  const delayedTurnSyncTimerByThreadId = new Map<string, number>()
  let loadThreadsPromise: Promise<void> | null = null
  let threadListLoadGeneration = 0
  const loadMessagePromiseByThreadId = new Map<string, Promise<void>>()
  const reconnectingThreadHistory = new Set<string>()
  let pendingServerRequestsVersion = 0
  type HistoryReadOwner = { olderPageBoundary?: string }
  const historyReadOwnerByThreadId = new Map<string, HistoryReadOwner>()

  function historyReadOwner(threadId: string): HistoryReadOwner {
    let owner = historyReadOwnerByThreadId.get(threadId)
    if (!owner) {
      owner = {}
      historyReadOwnerByThreadId.set(threadId, owner)
    }
    return owner
  }

  function invalidateThreadHistory(threadId: string, dropPayload = true): void {
    historyReadOwnerByThreadId.delete(threadId)
    loadMessagePromiseByThreadId.delete(threadId)
    reconnectingThreadHistory.delete(threadId)
    visibleMessageLoads.delete(threadId)
    lastMessageLoadAtByThreadId.delete(threadId)
    lastMessageLoadFailureAtByThreadId.delete(threadId)
    if (dropPayload) {
      loadedMessagesByThreadId.value = omitKey(loadedMessagesByThreadId.value, threadId)
      loadedVersionByThreadId.value = omitKey(loadedVersionByThreadId.value, threadId)
      persistedMessagesByThreadId.value = omitKey(persistedMessagesByThreadId.value, threadId)
      turnIndexByTurnIdByThreadId.value = omitKey(turnIndexByTurnIdByThreadId.value, threadId)
      hasMoreOlderMessagesByThreadId.value = omitKey(hasMoreOlderMessagesByThreadId.value, threadId)
      loadingOlderMessagesByThreadId.value = omitKey(loadingOlderMessagesByThreadId.value, threadId)
    }
    syncMessageLoading()
  }

  const realtimeRevisionByThreadId = new Map<string, number>()
  let optimisticMessageSequence = 0
  const refreshSkillsPromiseByDirectory = new Map<string, Promise<void>>()
  let lastThreadListLoadAt = 0
  let hasLoadedSkills = false
  let lastSkillsLoadAt = 0
  let lastSkillsLoadKey = ''
  let rateLimitRefreshPromise: Promise<void> | null = null
  let pendingThreadsRefresh = false
  let pendingThreadsRefreshForce = false
  const pendingThreadMessageRefresh = new Set<string>()
  const lastMessageLoadAtByThreadId = new Map<string, number>()
  const lastMessageLoadFailureAtByThreadId = new Map<string, number>()
  let threadListNextCursor: string | null = null
  let threadListBackgroundTimer: number | null = null
  let threadListGeneration = 0
  let pendingForcedThreadLoad = false
  let remainingThreadPageRequest: { generation: number; cursor: string } | null = null
  let hasLoadedAllThreadPages = false
  let loadedThreadListGroups: UiProjectGroup[] = []
  let loadedThreadListRootsState: WorkspaceRootsState | null = null
  let projectOperationPromise: Promise<void> = Promise.resolve()
  let workspaceRootsRefreshPromise: Promise<WorkspaceRootsState | null> | null = null
  let activeReasoningItemId = ''
  const pendingTurnStartsById = new Map<string, TurnStartedInfo>()

  const allThreads = computed(() => flattenThreads(projectGroups.value))
  const selectedThread = computed(() =>
    allThreads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
  )
  const isSelectedThreadInterruptPending = computed(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return false
    return interruptBlockedUntilPersistedByThreadId.value[threadId] === true
  })
  const selectedThreadServerRequests = computed<UiServerRequest[]>(() => {
    const rows: UiServerRequest[] = []
    const selected = selectedThreadId.value
    if (selected && Array.isArray(pendingServerRequestsByThreadId.value[selected])) {
      rows.push(...pendingServerRequestsByThreadId.value[selected])
    }
    if (Array.isArray(pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
    }
    return rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
  })
  const selectedLiveOverlay = computed<UiLiveOverlay | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null

    const isInProgress = inProgressById.value[threadId] === true
    const activity = isInProgress ? turnActivityByThreadId.value[threadId] : undefined
    const reasoningText = isInProgress
      ? (liveReasoningTextByThreadId.value[threadId] ?? '').trim()
      : ''
    const liveErrorText = (turnErrorByThreadId.value[threadId]?.message ?? '').trim()
    let latestPersistedTurnErrorText = ''
    if (!isInProgress && liveErrorText) {
      const persistedMessages = persistedMessagesByThreadId.value[threadId] ?? []
      for (let index = persistedMessages.length - 1; index >= 0; index -= 1) {
        const message = persistedMessages[index]
        if (message.messageType !== 'turnError') continue
        latestPersistedTurnErrorText = normalizeMessageText(message.text)
        break
      }
    }
    const errorText =
      !isInProgress && liveErrorText && latestPersistedTurnErrorText === liveErrorText
        ? ''
        : liveErrorText

    if (!isInProgress && !activity && !reasoningText && !errorText) return null
    return {
      activityLabel: activity?.label || 'Thinking',
      activityDetails: activity?.details ?? [],
      reasoningText,
      errorText,
      generationMetadata: generationMetadataByThreadId.value[threadId]?.[activeTurnIdByThreadId.value[threadId]]
        ?? persistedMessagesByThreadId.value[threadId]?.find((message) =>
          message.turnId === activeTurnIdByThreadId.value[threadId] && message.generationMetadata)?.generationMetadata,
    }
  })
  const codexQuota = computed<UiRateLimitSnapshot | null>(() => codexRateLimit.value)
  const selectedThreadTokenUsage = computed<UiThreadTokenUsage | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null
    return threadTokenUsageByThreadId.value[threadId] ?? null
  })
  const messages = computed<UiMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const livePlan = livePlanMessagesByThreadId.value[threadId] ?? []
    const liveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
    const liveAgentById = new Map(liveAgent.map((message) => [message.id, message]))
    const persistedIds = new Set(persisted.map((message) => message.id))
    const liveCommands = liveCommandsByThreadId.value[threadId] ?? []
    const liveFileChanges = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    const combined = [
      ...persisted.map((message) => liveAgentById.get(message.id) ?? message),
      ...livePlan, ...liveCommands, ...liveFileChanges,
      ...liveAgent.filter((message) => !persistedIds.has(message.id)),
    ].map((message) => {
      const metadata = message.turnId ? generationMetadataByThreadId.value[threadId]?.[message.turnId] : undefined
      if (message.role !== 'assistant' || !metadata) return message
      return { ...message, generationMetadata: mergeGenerationMetadata(metadata, message.generationMetadata) }
    })

    const summary = turnSummaryByThreadId.value[threadId]
    if (!summary) return combined
    return insertTurnSummaryMessage(combined, summary)
  })
  const hasMoreOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? hasMoreOlderMessagesByThreadId.value[threadId] === true : false
  })
  const isLoadingOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? loadingOlderMessagesByThreadId.value[threadId] === true : false
  })

  function getFirstPersistedTurnId(threadId: string): string {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    for (const message of persisted) {
      const turnId = message.turnId?.trim() ?? ''
      if (turnId) return turnId
    }
    return ''
  }

  // Explicit composer choices survive backend defaults, including after reload.
  const explicitModelStorageKey = 'codex-web-local.explicit-model-contexts.v1'
  const explicitModelContexts = new Set<string>((() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(explicitModelStorageKey) || '[]')
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && !!selectedModelIdByContext.value[id]) : []
    } catch { return [] }
  })())
  function persistExplicitModelContexts(): void {
    try { window.localStorage.setItem(explicitModelStorageKey, JSON.stringify([...explicitModelContexts])) } catch { /* Storage is optional. */ }
  }
  // A legacy catalog belongs to the server's configured provider. When older
  // config/read omits that identity, effective thread metadata is the evidence.
  let legacyCatalogIds = new Set<string>()
  let legacyCatalogProvider = ''
  const effectiveThreadProviders = new Map<string, string>()
  const configuringForks = new Set<string>()
  const replacementThreadIds = new Map<string, string>()
  const blockedProviderContext = ref('')
  const blockedProviderNotice = ref('')
  const supersededForkDrafts = new Map<string, string>()
  const freshForkStorageKey = 'codex-web-local.fresh-forks.v1'
  const freshForks = ref<Record<string, string>>((() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(freshForkStorageKey) || '{}')
      return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([, model]) => typeof model === 'string')) as Record<string, string> : {}
    } catch { return {} }
  })())
  function markFreshFork(threadId: string, model: string | null): void {
    if (model === null && !Object.prototype.hasOwnProperty.call(freshForks.value, threadId)) return
    const next = { ...freshForks.value }
    if (model === null) delete next[threadId]
    else next[threadId] = model
    freshForks.value = next
    try { window.localStorage.setItem(freshForkStorageKey, JSON.stringify(next)) } catch { /* Storage is optional. */ }
  }

  const modelSelectionNotice = computed(() => {
    if (blockedProviderContext.value === selectedThreadId.value && blockedProviderContext.value) {
      return blockedProviderNotice.value
    }
    return Object.prototype.hasOwnProperty.call(freshForks.value, selectedThreadId.value)
      ? 'Fresh fork: choose a provider and model before sending. After the first message, changing providers requires another fork. The app-server must support the selected provider.'
      : ''
  })
  function resolveThreadReplacement(threadId: string): string {
    return replacementThreadIds.get(threadId) || threadId
  }

  function resolveSelectionProvider(model: string, threadProvider = ''): string {
    const selection = parseModelSelection(model)
    if (selection.provider) return selection.provider
    const matches = reasoningCatalog.value.filter(entry => entry.id?.trim() === selection.model || entry.model?.trim() === selection.model)
    const providers = new Set(matches.map(entry => entry.modelProvider?.trim() || ''))
    if (providers.size === 1 && !providers.has('')) return [...providers][0]!
    if (providers.size > 1) return ''
    return legacyCatalogIds.has(selection.model) ? legacyCatalogProvider || threadProvider : ''
  }

  function readModelIdForThread(threadId: string): string {
    const contextId = isNewThreadContextId(toThreadContextId(threadId)) ? NEW_THREAD_MODEL_CONTEXT : toThreadContextId(threadId)
    const automatic = automaticModelByContext.value[contextId]
    if (automatic !== undefined) return automatic
    return normalizeStoredModelId(selectedModelIdByContext.value[contextId]) || readSelectedModel(selectedModelIdByContext.value, threadId).trim()
  }

  function ensureAvailableModelIds(...modelIds: string[]): void {
    const nextModelIds = [...availableModelIds.value]
    for (const modelId of modelIds) {
      const normalizedModelId = modelId.trim()
      if (normalizedModelId && !nextModelIds.includes(normalizedModelId)) {
        nextModelIds.push(normalizedModelId)
      }
    }
    if (!areStringArraysEqual(availableModelIds.value, nextModelIds)) {
      availableModelIds.value = nextModelIds
    }
  }

  function readAvailableSelectedModel(modelId: string): string {
    const normalizedModelId = modelId.trim()
    if (availableModelIds.value.length === 0) return normalizedModelId
    if (normalizedModelId && availableModelIds.value.includes(normalizedModelId)) return normalizedModelId
    return availableModelIds.value[0] ?? ''
  }

  function setSelectedThreadId(nextThreadId: string, options: { persist?: boolean } = {}): void {
    if (selectedThreadId.value === nextThreadId) return
    selectionGeneration += 1
    selectedThreadId.value = nextThreadId
    if (options.persist !== false) {
      saveSelectedThreadId(nextThreadId)
    }
    ensureAvailableModelIds(readModelIdForThread(nextThreadId))
    selectedModelId.value = readAvailableSelectedModel(readModelIdForThread(nextThreadId))
    selectedCollaborationMode.value = readSelectedCollaborationMode(
      selectedCollaborationModeByContext.value,
      nextThreadId,
    )
    activeReasoningItemId = ''
  }

  function setSelectedModelIdForThread(threadId: string, modelId: string): void {
    const requested = modelId.trim()
    const currentProvider = effectiveThreadProviders.get(threadId) || resolveSelectionProvider(readModelIdForThread(threadId))
    const requestedProvider = resolveSelectionProvider(requested, currentProvider)
    const model = modelSelectionKey(requestedProvider, parseModelSelection(requested).model)
    const context = isNewThreadContextId(toThreadContextId(threadId)) ? NEW_THREAD_MODEL_CONTEXT : toThreadContextId(threadId)
    const next = cloneStringKeyedRecord(selectedModelIdByContext.value)
    if (!isNewThreadContextId(toThreadContextId(threadId)) && !Object.prototype.hasOwnProperty.call(freshForks.value, threadId) && (!currentProvider || !requestedProvider || currentProvider !== requestedProvider)) {
      blockedProviderContext.value = threadId
      error.value = currentProvider && requestedProvider
        ? 'Fork this conversation to use a different model provider.'
        : 'Model provider could not be confirmed. Refresh the model list before changing models.'
      blockedProviderNotice.value = error.value
      return
    }
    if (error.value === blockedProviderNotice.value) error.value = ''
    blockedProviderContext.value = ''
    blockedProviderNotice.value = ''
    explicitModelContexts.add(context)
    ++modelRefreshVersion
    automaticModelByContext.value = omitStringKeyedRecordKey(automaticModelByContext.value, context)
    if (model) { next[context] = model; if (isNewThreadContextId(toThreadContextId(threadId))) next[NEW_THREAD_MODEL_CONTEXT] = model }
    else delete next[context]
    selectedModelIdByContext.value = next
    if (threadId.trim() === selectedThreadId.value) selectedModelId.value = readModelIdForThread(threadId)
    ensureAvailableModelIds(model)
    saveSelectedModelMap(next)
    persistExplicitModelContexts()
    recordModelUsage(model)
  }

  function setSelectedModelId(modelId: string): void {
    setSelectedModelIdForThread(selectedThreadId.value, modelId)
  }

  function setThreadModelId(threadId: string, modelId: string, provider?: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    const confirmedProvider = provider?.trim() || parseModelSelection(modelId).provider
    if (confirmedProvider) effectiveThreadProviders.set(normalizedThreadId, confirmedProvider)
    if (explicitModelContexts.has(normalizedThreadId)) return
    const incoming = parseModelSelection(modelId.trim())
    const effectiveProvider = confirmedProvider || resolveSelectionProvider(modelId) || resolveSelectionProvider(readModelIdForThread(threadId))
    const normalizedModelId = modelSelectionKey(effectiveProvider, incoming.model || parseModelSelection(readModelIdForThread(threadId)).model)
    automaticModelByContext.value = omitStringKeyedRecordKey(automaticModelByContext.value, normalizedThreadId)
    if (normalizedModelId) {
      const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
      nextModelMap[normalizedThreadId] = normalizedModelId
      selectedModelIdByContext.value = nextModelMap
    } else {
      selectedModelIdByContext.value = omitStringKeyedRecordKey(selectedModelIdByContext.value, normalizedThreadId)
    }
    ensureAvailableModelIds(normalizedModelId)
    if (selectedThreadId.value === normalizedThreadId) {
      selectedModelId.value = readModelIdForThread(selectedThreadId.value)
    }
    saveSelectedModelMap(selectedModelIdByContext.value)
  }

  function setThreadTokenUsage(threadId: string, usage: UiThreadTokenUsage | null): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    if (!usage) {
      if (!(normalizedThreadId in threadTokenUsageByThreadId.value)) return
      threadTokenUsageByThreadId.value = omitKey(threadTokenUsageByThreadId.value, normalizedThreadId)
      saveThreadTokenUsageMap(threadTokenUsageByThreadId.value)
      return
    }

    const current = threadTokenUsageByThreadId.value[normalizedThreadId]
    if (current && JSON.stringify(current) === JSON.stringify(usage)) return

    threadTokenUsageByThreadId.value = {
      ...threadTokenUsageByThreadId.value,
      [normalizedThreadId]: usage,
    }
    saveThreadTokenUsageMap(threadTokenUsageByThreadId.value)
  }

  function setSelectedCollaborationMode(mode: CollaborationModeKind): void {
    const nextMode: CollaborationModeKind = mode === 'plan' ? 'plan' : 'default'
    const contextId = toThreadContextId(selectedThreadId.value)
    const currentMode = readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value)
    if (currentMode === nextMode && selectedCollaborationMode.value === nextMode) return
    selectedCollaborationMode.value = nextMode
    selectedCollaborationModeByContext.value = writeSelectedCollaborationModeForContext(
      selectedCollaborationModeByContext.value,
      contextId,
      nextMode,
    )
    saveSelectedCollaborationModeMap(selectedCollaborationModeByContext.value)
  }

  function setSelectedCollaborationModeForThread(threadId: string, mode: CollaborationModeKind): void {
    const nextMode = mode === 'plan' ? 'plan' : 'default'
    selectedCollaborationModeByContext.value = writeSelectedCollaborationModeForContext(
      selectedCollaborationModeByContext.value,
      threadId,
      nextMode,
    )
    if (threadId.trim() === selectedThreadId.value) {
      selectedCollaborationMode.value = nextMode
    }
    saveSelectedCollaborationModeMap(selectedCollaborationModeByContext.value)
  }

  function setCodexRateLimit(nextSnapshot: UiRateLimitSnapshot | null): void {
    codexRateLimit.value = nextSnapshot
  }

  function setPendingTurnRequest(threadId: string, request: PendingTurnRequest): void {
    pendingTurnRequestByThreadId.value = {
      ...pendingTurnRequestByThreadId.value,
      [threadId]: request,
    }
  }

  function clearPendingTurnRequest(threadId: string): void {
    if (!pendingTurnRequestByThreadId.value[threadId]) return
    pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId)
  }

  function reasoningModelForThread(threadId: string) {
    return findReasoningModel(readModelIdForThread(threadId))
  }

  function reasoningPreferenceKey(threadId: string): string {
    const selection = parseModelSelection(readModelIdForThread(threadId))
    return JSON.stringify([selection.provider || 'codex', selection.model])
  }

  function readReasoningEffortForThread(threadId: string): ReasoningEffort | '' {
    return resolveReasoningEffort(reasoningModelForThread(threadId), reasoningByModel.value[reasoningPreferenceKey(threadId)])
  }

  function readReasoningOptionsForThread(threadId: string) {
    return reasoningOptions(reasoningModelForThread(threadId))
  }

  const availableReasoningEfforts = computed(() => readReasoningOptionsForThread(selectedThreadId.value))

  function setSelectedReasoningEffort(effort: ReasoningEffort | '', threadId = selectedThreadId.value): void {
    const modelId = readModelIdForThread(threadId)
    if (!modelId) return
    const resolved = resolveReasoningEffort(reasoningModelForThread(threadId), effort)
    if (!resolved) return
    reasoningByModel.value[reasoningPreferenceKey(threadId)] = resolved
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(REASONING_BY_MODEL_STORAGE_KEY, JSON.stringify(reasoningByModel.value))
      }
    } catch {
      // Preserve the in-memory preference when storage is unavailable.
    }
  }

  async function updateSelectedSpeedMode(mode: SpeedMode): Promise<void> {
    const nextMode: SpeedMode = mode === 'fast' ? 'fast' : 'standard'
    if (isUpdatingSpeedMode.value || selectedSpeedMode.value === nextMode) {
      return
    }

    const previousMode = selectedSpeedMode.value
    selectedSpeedMode.value = nextMode
    isUpdatingSpeedMode.value = true
    error.value = ''

    try {
      await setCodexSpeedMode(nextMode)
    } catch (unknownError) {
      selectedSpeedMode.value = previousMode
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to update Fast mode'
    } finally {
      isUpdatingSpeedMode.value = false
    }
  }

  async function refreshCollaborationModes(): Promise<void> {
    const generation = lifecycleGeneration
    try {
      const modes = await getAvailableCollaborationModes()
      if (generation !== lifecycleGeneration) return
      availableCollaborationModes.value = modes
      if (!modes.some((mode) => mode.value === selectedCollaborationMode.value)) {
        setSelectedCollaborationMode('default')
      }
    } catch {
      // Keep the last known collaboration mode choices on transient failures.
    }
  }

  function buildPendingTurnDetails(
    modelId: string,
    effort: ReasoningEffort | '',
    collaborationMode: CollaborationModeKind = selectedCollaborationMode.value,
  ): string[] {
    const selection = parseModelSelection(modelId)
    const modelLabel = selection.provider ? `${selection.provider} — ${selection.model}` : selection.model || 'default'
    const effortLabel = effort || 'default'
    const modeLabel = collaborationMode === 'plan' ? 'Plan' : 'Default'
    const speedLabel = selectedSpeedMode.value === 'fast' ? 'Fast' : 'Standard'
    return [`Mode: ${modeLabel}`, `Model: ${modelLabel}`, `Thinking: ${effortLabel}`, `Speed: ${speedLabel}`]
  }

  let modelRefreshVersion = 0
  async function refreshModelPreferences(): Promise<void> {
    const publication = ensureCatalogOwnership().beginRefresh()
    const generation = lifecycleGeneration
    const version = ++modelRefreshVersion
    const threadId = selectedThreadId.value
    codexCliMissingError.value = ''
    try {
      const config = await getCurrentModelConfig()
      if (generation !== lifecycleGeneration) return
      const fetchedCatalog = await getAvailableModelIds()
      const catalog = { ...fetchedCatalog }
      if (generation !== lifecycleGeneration) return
      if (version !== modelRefreshVersion || threadId !== selectedThreadId.value) return
      const context = isNewThreadContextId(toThreadContextId(threadId)) ? NEW_THREAD_MODEL_CONTEXT : toThreadContextId(threadId)
      automaticModelByContext.value = omitStringKeyedRecordKey(automaticModelByContext.value, context)
      legacyCatalogIds = new Set(catalog.models.every(entry => !entry.modelProvider?.trim())
        ? catalog.ids.filter(id => !parseModelSelection(id).provider) : [])
      legacyCatalogProvider = config.modelProvider?.trim() || catalog.defaultProvider?.trim() || ''
      // Older servers return a single unqualified catalog; bind it only to the
      // server's configured provider, never to a saved unavailable provider.
      if (config.modelProvider && catalog.models.length && catalog.models.every((entry) => !entry.modelProvider)) {
        catalog.models = catalog.models.map((entry) => ({ ...entry, modelProvider: config.modelProvider }))
        catalog.ids = catalog.ids.map((id) => modelSelectionKey(config.modelProvider!, id))
      }
      const defaultProvider = config.modelProvider || catalog.defaultProvider || ''
      const qualify = (value: string) => value && !parseModelSelection(value).provider
        ? modelSelectionKey(defaultProvider, value) : value
      const saved = qualify(readModelIdForThread(threadId))
      const configured = modelSelectionKey(defaultProvider, config.model)
      const ids = buildModelCatalogIds(catalog.ids, saved, configured)
      const model = parseModelSelection(saved).provider ? saved : resolveModelPreference(ids, saved, configured)
      if (model && !ids.includes(model)) ids.push(model)
      availableModelIds.value = ids
      automaticModelByContext.value[context] = model
      if (context !== NEW_THREAD_MODEL_CONTEXT) {
        const savedDefault = normalizeStoredModelId(selectedModelIdByContext.value[NEW_THREAD_MODEL_CONTEXT])
        automaticModelByContext.value[NEW_THREAD_MODEL_CONTEXT] = qualify(savedDefault) || resolveModelPreference(ids, '', configured)
      }
      selectedModelId.value = model
      publication.publish(catalog.models)
      if (defaultProvider) {
        for (const entry of catalog.models) {
          if (entry.modelProvider !== defaultProvider) continue
          const id = entry.id?.trim() || entry.model?.trim() || ''
          const key = JSON.stringify([defaultProvider, id])
          const legacy = reasoningByModel.value[JSON.stringify(['codex', id])]
          if (!(key in reasoningByModel.value) && legacy) reasoningByModel.value[key] = legacy
        }
      }
      selectedSpeedMode.value = config.speedMode
    } catch (error) {
      if (generation !== lifecycleGeneration) return
      if (version !== modelRefreshVersion || threadId !== selectedThreadId.value) return
      publication.fail()
      if (isCodexCliMissingError(error)) codexCliMissingError.value = CODEX_CLI_MISSING_MESSAGE
    }
  }

  async function refreshRateLimits(): Promise<void> {
    const generation = lifecycleGeneration
    if (rateLimitRefreshPromise) {
      await rateLimitRefreshPromise
      return
    }

    rateLimitRefreshPromise = (async () => {
      try {
        const snapshot = await getAccountRateLimits()
        if (generation !== lifecycleGeneration) return
        setCodexRateLimit(snapshot)
        accountRateLimitSnapshots.value = snapshot ? [snapshot] : []
      } catch {
        // Keep the last known rate-limit state if the endpoint is temporarily unavailable.
      } finally {
        if (generation === lifecycleGeneration) rateLimitRefreshPromise = null
      }
    })()

    await rateLimitRefreshPromise
  }

  function scheduleRateLimitRefresh(): void {
    const generation = lifecycleGeneration
    if (typeof window === 'undefined') {
      void refreshRateLimits()
      return
    }

    if (rateLimitRefreshTimer !== null) {
      window.clearTimeout(rateLimitRefreshTimer)
    }

    rateLimitRefreshTimer = window.setTimeout(() => {
      if (generation !== lifecycleGeneration) return
      rateLimitRefreshTimer = null
      void refreshRateLimits()
    }, RATE_LIMIT_REFRESH_DEBOUNCE_MS)
  }

  function clearDelayedTurnSync(threadId: string): void {
    if (!threadId || typeof window === 'undefined') return
    const timerId = delayedTurnSyncTimerByThreadId.get(threadId)
    if (timerId === undefined) return
    window.clearTimeout(timerId)
    delayedTurnSyncTimerByThreadId.delete(threadId)
  }

  function scheduleDelayedTurnSync(threadId: string): void {
    const generation = lifecycleGeneration
    if (!threadId || typeof window === 'undefined') return
    clearDelayedTurnSync(threadId)
    const timerId = window.setTimeout(() => {
      if (generation !== lifecycleGeneration) return
      delayedTurnSyncTimerByThreadId.delete(threadId)
      pendingThreadMessageRefresh.add(threadId)
      void syncFromNotifications()
    }, TURN_START_FOLLOW_UP_SYNC_DELAY_MS)
    delayedTurnSyncTimerByThreadId.set(threadId, timerId)
  }

  function applyNativeThreadName(threadId: string, title: string): void {
    sourceGroups.value = sourceGroups.value.map(group => ({
      ...group, threads: group.threads.map(thread => thread.id === threadId ? { ...thread, title } : thread),
    }))
    applyThreadFlags()
  }

  function getThreadPendingRequests(threadId: string): UiServerRequest[] {
    if (!threadId) return []
    return Array.isArray(pendingServerRequestsByThreadId.value[threadId])
      ? pendingServerRequestsByThreadId.value[threadId]
      : []
  }

  function isApprovalRequestMethod(method: string): boolean {
    return (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'item/permissions/requestApproval' ||
      method === 'execCommandApproval' ||
      method === 'applyPatchApproval'
    )
  }

  function readPendingRequestState(requests: UiServerRequest[]): UiPendingRequestState | null {
    if (requests.some((request) => isApprovalRequestMethod(request.method))) {
      return 'approval'
    }
    return requests.length > 0 ? 'response' : null
  }

  function applyThreadFlags(): void {
    const withTitles = sourceGroups.value
    const flaggedGroups: UiProjectGroup[] = withTitles.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const inProgress = inProgressById.value[thread.id] === true
        const pendingRequestState = readPendingRequestState(getThreadPendingRequests(thread.id))
        const unread = thread.nativeReadState?.firstUnread != null

        return {
          ...thread,
          inProgress,
          unread,
          pendingRequestState,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string): void {
    localThreadConfirmationDeadlineById.set(threadId, Date.now() + LOCAL_THREAD_CONFIRMATION_GRACE_MS)
    scheduleLocalThreadReconciliation()
    const nowIso = new Date().toISOString()
    const normalizedCwd = normalizePathForUi(cwd)
    const projectName = toProjectName(normalizedCwd)
    const nextThread: UiThread = {
      id: threadId,
      title: toOptimisticThreadTitle(firstMessageText),
      projectName,
      cwd: normalizedCwd,
      hasWorktree: normalizedCwd.includes('/.codex/worktrees/') || normalizedCwd.includes('/.git/worktrees/'),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      preview: firstMessageText,
      unread: false,
      inProgress: false,
    }

    const existingGroupIndex = sourceGroups.value.findIndex((group) => group.projectName === projectName)
    if (existingGroupIndex >= 0) {
      const existingGroup = sourceGroups.value[existingGroupIndex]
      const remainingThreads = existingGroup.threads.filter((thread) => thread.id !== threadId)
      const nextGroup: UiProjectGroup = {
        projectName,
        threads: [nextThread, ...remainingThreads],
      }
      const nextGroups = [...sourceGroups.value]
      nextGroups.splice(existingGroupIndex, 1, nextGroup)
      sourceGroups.value = nextGroups
    } else {
      sourceGroups.value = [{ projectName, threads: [nextThread] }, ...sourceGroups.value]
    }

    applyThreadFlags()
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    for (const threadId of localThreadConfirmationDeadlineById.keys()) {
      if (!activeThreadIds.has(threadId)) localThreadConfirmationDeadlineById.delete(threadId)
    }
    scheduleLocalThreadReconciliation()
    const currentThreadId = selectedThreadId.value.trim()
    if (currentThreadId) {
      activeThreadIds.add(currentThreadId)
    }
    for (const threadId of historyReadOwnerByThreadId.keys()) {
      if (!activeThreadIds.has(threadId)) invalidateThreadHistory(threadId, false)
    }
    automaticModelByContext.value = pruneThreadContextStateMap(automaticModelByContext.value, activeThreadIds)
    const nextSelectedModelMap = pruneThreadContextStateMap(selectedModelIdByContext.value, activeThreadIds)
    if (nextSelectedModelMap !== selectedModelIdByContext.value) {
      selectedModelIdByContext.value = nextSelectedModelMap
      selectedModelId.value = readAvailableSelectedModel(readModelIdForThread(selectedThreadId.value))
      saveSelectedModelMap(nextSelectedModelMap)
      for (const context of explicitModelContexts) {
        if (!nextSelectedModelMap[context]) explicitModelContexts.delete(context)
      }
      persistExplicitModelContexts()
      for (const id of effectiveThreadProviders.keys()) {
        if (!activeThreadIds.has(id)) effectiveThreadProviders.delete(id)
      }
    }
    const nextSelectedCollaborationModeMap = pruneThreadContextStateMap(
      selectedCollaborationModeByContext.value,
      activeThreadIds,
    )
    if (nextSelectedCollaborationModeMap !== selectedCollaborationModeByContext.value) {
      selectedCollaborationModeByContext.value = nextSelectedCollaborationModeMap
      selectedCollaborationMode.value = readSelectedCollaborationMode(
        nextSelectedCollaborationModeMap,
        selectedThreadId.value,
      )
      saveSelectedCollaborationModeMap(nextSelectedCollaborationModeMap)
    }
    hasMoreOlderMessagesByThreadId.value = pruneThreadStateMap(hasMoreOlderMessagesByThreadId.value, activeThreadIds)
    loadingOlderMessagesByThreadId.value = pruneThreadStateMap(loadingOlderMessagesByThreadId.value, activeThreadIds)
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    for (const threadId of realtimeRevisionByThreadId.keys()) {
      if (!activeThreadIds.has(threadId)) realtimeRevisionByThreadId.delete(threadId)
    }
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    turnIndexByTurnIdByThreadId.value = pruneThreadStateMap(turnIndexByTurnIdByThreadId.value, activeThreadIds)
    persistedMessagesByThreadId.value = pruneThreadStateMap(persistedMessagesByThreadId.value, activeThreadIds)
    liveAgentMessagesByThreadId.value = pruneThreadStateMap(liveAgentMessagesByThreadId.value, activeThreadIds)
    liveReasoningTextByThreadId.value = pruneThreadStateMap(liveReasoningTextByThreadId.value, activeThreadIds)
    liveCommandsByThreadId.value = pruneThreadStateMap(liveCommandsByThreadId.value, activeThreadIds)
    liveFileChangeMessagesByThreadId.value = pruneThreadStateMap(liveFileChangeMessagesByThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    activeTurnIdByThreadId.value = pruneThreadStateMap(activeTurnIdByThreadId.value, activeThreadIds)
    interruptBlockedUntilPersistedByThreadId.value = pruneThreadStateMap(
      interruptBlockedUntilPersistedByThreadId.value,
      activeThreadIds,
    )
    threadListedByServerById.value = pruneThreadStateMap(threadListedByServerById.value, activeThreadIds)
    persistedUserMessageByThreadId.value = pruneThreadStateMap(persistedUserMessageByThreadId.value, activeThreadIds)
    threadTokenUsageByThreadId.value = pruneThreadStateMap(threadTokenUsageByThreadId.value, activeThreadIds)
    inProgressById.value = pruneThreadStateMap(inProgressById.value, activeThreadIds)
    const nextPending: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  const pendingNativeReadUpdates = new Set<string>()

  function markThreadAsRead(threadId: string, observedRevision?: string): void {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    if (!thread || selectedThreadId.value !== threadId) return
    if (observedRevision !== undefined && thread.nativeReadState?.revision !== observedRevision) return

    if (thread.nativeReadState) {
      if (thread.nativeReadState.firstUnread == null || pendingNativeReadUpdates.has(threadId)) return
      const revision = thread.nativeReadState.revision
      pendingNativeReadUpdates.add(threadId)
      void markNativeThreadRead(threadId, revision).then(state => {
        const current = flattenThreads(sourceGroups.value).find(row => row.id === threadId)
        if (current?.nativeReadState?.revision === revision) current.nativeReadState = state
        applyThreadFlags()
      }).catch(cause => {
        error.value = `Native read state update failed. Select the thread again to retry: ${cause instanceof Error ? cause.message : String(cause)}`
      }).finally(() => pendingNativeReadUpdates.delete(threadId))
      return
    }
  }

  function setTurnSummaryForThread(threadId: string, summary: TurnSummaryState | null): void {
    if (!threadId) return

    const previous = turnSummaryByThreadId.value[threadId]
    if (summary) {
      if (areTurnSummariesEqual(previous, summary)) return
      turnSummaryByThreadId.value = {
        ...turnSummaryByThreadId.value,
        [threadId]: summary,
      }
    } else {
      if (previous) {
        turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
      }
    }
  }

  function setThreadInProgress(threadId: string, nextInProgress: boolean): void {
    if (!threadId) return
    const currentValue = inProgressById.value[threadId] === true
    if (currentValue === nextInProgress) return
    if (nextInProgress) {
      inProgressById.value = {
        ...inProgressById.value,
        [threadId]: true,
      }
    } else {
      if (localThreadConfirmationDeadlineById.has(threadId)) {
        // Long-running first turns still get an indexing grace period after completion.
        localThreadConfirmationDeadlineById.set(threadId, Date.now() + LOCAL_THREAD_CONFIRMATION_GRACE_MS)
        scheduleLocalThreadReconciliation()
      }
      inProgressById.value = omitKey(inProgressById.value, threadId)
      clearCompletedTurnLiveState(threadId)
      clearInterruptPersistenceGate(threadId)
    }
    scheduleLocalThreadReconciliation()
    applyThreadFlags()
    if (!nextInProgress && !hasActiveInProgressThreads() && threadListNextCursor) {
      scheduleRemainingThreadPages()
    }
  }

  function clearInterruptPersistenceGate(threadId: string): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId]) {
      interruptBlockedUntilPersistedByThreadId.value = omitKey(interruptBlockedUntilPersistedByThreadId.value, threadId)
    }
    if (threadListedByServerById.value[threadId]) {
      threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    }
    if (persistedUserMessageByThreadId.value[threadId]) {
      persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    }
  }

  function blockInterruptUntilThreadIsPersisted(threadId: string): void {
    if (!threadId) return
    interruptBlockedUntilPersistedByThreadId.value = {
      ...interruptBlockedUntilPersistedByThreadId.value,
      [threadId]: true,
    }
    if (threadListedByServerById.value[threadId]) {
      threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    }
    if (persistedUserMessageByThreadId.value[threadId]) {
      persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    }
  }

  function maybeUnblockInterruptForPersistedThread(threadId: string): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    if (threadListedByServerById.value[threadId] !== true) return
    if (persistedUserMessageByThreadId.value[threadId] !== true) return
    clearInterruptPersistenceGate(threadId)
  }

  function maybeUnblockInterruptForActiveTurn(threadId: string, turnId: string): void {
    if (!threadId || !turnId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    clearInterruptPersistenceGate(threadId)
  }

  function markServerListedThreads(serverThreadIds: Set<string>): void {
    const pendingThreadIds = Object.keys(interruptBlockedUntilPersistedByThreadId.value)
    if (pendingThreadIds.length === 0) return

    let nextListedState = threadListedByServerById.value
    let changed = false
    for (const threadId of pendingThreadIds) {
      if (!serverThreadIds.has(threadId) || nextListedState[threadId] === true) continue
      nextListedState = {
        ...nextListedState,
        [threadId]: true,
      }
      changed = true
    }

    if (!changed) return
    threadListedByServerById.value = nextListedState
    for (const threadId of pendingThreadIds) {
      maybeUnblockInterruptForPersistedThread(threadId)
    }
  }

  function markThreadMessagesPersisted(threadId: string, messages: UiMessage[]): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    if (!messages.some((message) => message.role === 'user')) return
    if (persistedUserMessageByThreadId.value[threadId] !== true) {
      persistedUserMessageByThreadId.value = {
        ...persistedUserMessageByThreadId.value,
        [threadId]: true,
      }
    }
    maybeUnblockInterruptForPersistedThread(threadId)
  }

  function setTurnActivityForThread(threadId: string, activity: TurnActivityState | null): void {
    if (!threadId) return

    const previous = turnActivityByThreadId.value[threadId]
    if (!activity) {
      if (previous) {
        turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      }
      return
    }

    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const mergedDetails = Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3)
    const nextActivity: TurnActivityState = {
      label: normalizedLabel,
      details: mergedDetails,
    }

    if (areTurnActivitiesEqual(previous, nextActivity)) return
    turnActivityByThreadId.value = {
      ...turnActivityByThreadId.value,
      [threadId]: nextActivity,
    }
  }

  function setTurnErrorForThread(
    threadId: string,
    message: string | null,
    options: { transient?: boolean } = {},
  ): void {
    if (!threadId) return

    const previous = turnErrorByThreadId.value[threadId]
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (!normalizedMessage) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    const transient = options.transient === true
    // Transport/read failures must not hide an execution failure.
    if (transient && previous && !previous.transient) return
    if (previous?.message === normalizedMessage && previous.transient === transient) return

    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage, transient },
    }
  }

  function clearTransientTurnErrorForThread(threadId: string): void {
    if (!threadId) return
    if (!turnErrorByThreadId.value[threadId]?.transient) return
    setTurnErrorForThread(threadId, null)
  }

  function currentThreadVersion(threadId: string): string {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    return thread?.updatedAtIso ?? ''
  }

  function setPersistedMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = persistedMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    persistedMessagesByThreadId.value = {
      ...persistedMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function appendOptimisticUserMessage(
    threadId: string,
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): string {
    const existing = persistedMessagesByThreadId.value[threadId] ?? []
    const nextMessage: UiMessage = {
      id: `optimistic-user:${threadId}:${Date.now()}:${optimisticMessageSequence++}`,
      role: 'user',
      text,
      images: imageUrls.length > 0 ? [...imageUrls] : undefined,
      skills: skills.length > 0 ? skills.map((skill) => ({ name: skill.name, path: skill.path })) : undefined,
      fileAttachments: fileAttachments.length > 0 ? fileAttachments.map((file) => ({ ...file })) : undefined,
      messageType: 'userMessage.optimistic',
      turnIndex: inferNextTurnIndex(threadId),
    }
    setPersistedMessagesForThread(threadId, [...existing, nextMessage])
    return nextMessage.id
  }

  function setLiveAgentMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveAgentMessagesByThreadId.value = {
      ...liveAgentMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function setLiveFileChangeMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveFileChangeMessagesByThreadId.value = {
      ...liveFileChangeMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function setLivePlanMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = livePlanMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    livePlanMessagesByThreadId.value = {
      ...livePlanMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function upsertLivePlanMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = livePlanMessagesByThreadId.value[threadId] ?? []
    nextMessage = { ...nextMessage, turnId: nextMessage.turnId
      || previous.find((message) => message.id === nextMessage.id)?.turnId || activeTurnIdByThreadId.value[threadId] }
    const next = upsertMessage(previous, nextMessage)
    setLivePlanMessagesForThread(threadId, next)
  }

  function upsertLiveAgentMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    nextMessage = { ...nextMessage, turnId: nextMessage.turnId
      || previous.find((message) => message.id === nextMessage.id)?.turnId || activeTurnIdByThreadId.value[threadId] }
    const next = upsertMessage(previous, nextMessage)
    setLiveAgentMessagesForThread(threadId, next)
  }

  function upsertLiveFileChangeMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLiveFileChangeMessagesForThread(threadId, next)
  }

  function setLiveReasoningText(threadId: string, text: string): void {
    if (!threadId) return
    const normalized = text.trim()
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    if (normalized.length === 0) {
      if (!previous) return
      liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
      return
    }
    if (previous === normalized) return
    liveReasoningTextByThreadId.value = {
      ...liveReasoningTextByThreadId.value,
      [threadId]: normalized,
    }
  }

  function appendLiveReasoningText(threadId: string, delta: string): void {
    if (!threadId) return
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    setLiveReasoningText(threadId, `${previous}${delta}`)
  }

  function clearLiveReasoningForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveReasoningTextByThreadId.value)) return
    liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
  }

  function clearLivePlansForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in livePlanMessagesByThreadId.value)) return
    livePlanMessagesByThreadId.value = omitKey(livePlanMessagesByThreadId.value, threadId)
  }

  function clearLiveFileChangesForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveFileChangeMessagesByThreadId.value)) return
    liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
  }

  function clearCompletedTurnLiveState(threadId: string): void {
    if (!threadId) return
    clearLivePlansForThread(threadId)
    clearLiveReasoningForThread(threadId)
    setTurnActivityForThread(threadId, null)
    if (threadId === selectedThreadId.value) {
      activeReasoningItemId = ''
    }
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
    if (activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }
    clearPendingTurnRequest(threadId)
  }

  function readPlanDelta(notification: RpcNotification): { threadId: string; message: UiMessage } | null {
    if (notification.method !== 'item/plan/delta') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const delta = readString(params?.delta)
    if (!threadId || !turnId || !delta) return null

    const messageId = `${turnId}:plan`
    const existing = (livePlanMessagesByThreadId.value[threadId] ?? []).find((message) => message.id === messageId)
    const nextText = `${existing?.text ?? ''}${delta}`
    const nextPlan: UiPlanData | undefined = existing?.plan
      ? { ...existing.plan, isStreaming: true }
      : undefined

    return {
      threadId,
      message: {
        id: messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'plan.live',
        plan: nextPlan,
      },
    }
  }

  function normalizeServerRequest(params: unknown): UiServerRequest | null {
    const row = asRecord(params)
    if (!row) return null

    const id = row.id
    const rawMethod = readString(row.method)
    const requestParams = row.params
    if (typeof id !== 'number' || !Number.isInteger(id) || !rawMethod) {
      return null
    }

    const requestParamRecord = asRecord(requestParams)
    const method = normalizePendingServerRequestMethod(rawMethod, requestParamRecord)
    const threadId = (
      readString(requestParamRecord?.threadId) ||
      readString(requestParamRecord?.thread_id) ||
      readString(requestParamRecord?.conversationId) ||
      readString(requestParamRecord?.conversation_id) ||
      GLOBAL_SERVER_REQUEST_SCOPE
    )
    const turnId = readString(requestParamRecord?.turnId) || readString(requestParamRecord?.turn_id)
    const itemId = (
      readString(requestParamRecord?.itemId) ||
      readString(requestParamRecord?.item_id) ||
      readString(requestParamRecord?.callId) ||
      readString(requestParamRecord?.call_id)
    )
    const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString()

    return {
      id,
      method,
      threadId,
      turnId,
      itemId,
      receivedAtIso,
      params: requestParams ?? null,
    }
  }

  function readToolRequestUserInputQuestionIds(request: UiServerRequest): string[] {
    if (request.method !== 'item/tool/requestUserInput') return []
    const params = asRecord(request.params)
    const questions = Array.isArray(params?.questions) ? params.questions : []
    const questionIds: string[] = []

    for (const row of questions) {
      const question = asRecord(row)
      const id = readString(question?.id).trim()
      if (id) {
        questionIds.push(id)
      }
    }

    return questionIds
  }

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) {
      nextRows.splice(index, 1, request)
    } else {
      nextRows.push(request)
    }

    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
    applyThreadFlags()
  }

  function removePendingServerRequestById(requestId: number): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }
    pendingServerRequestsByThreadId.value = next
    applyThreadFlags()
  }

  function replacePendingServerRequests(requests: UiServerRequest[]): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const request of requests) {
      const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
      const current = next[threadId] ?? []
      current.push(request)
      next[threadId] = current
    }

    for (const rows of Object.values(next)) {
      rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
    }

    pendingServerRequestsByThreadId.value = next
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (!request) return true
      upsertPendingServerRequest(request)
      return true
    }

    if (notification.method === 'server/request/resolved') {
      const row = asRecord(notification.params)
      const id = row?.id
      if (typeof id === 'number' && Number.isInteger(id)) {
        removePendingServerRequestById(id)
      }
      return true
    }

    return false
  }

  function sanitizeDisplayText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim()
  }

  function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
    if (notification.method !== 'turn/started') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    return {
      threadId,
      turnId,
      startedAtMs,
    }
  }

  function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
    if (notification.method !== 'turn/completed') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const completedAtMs =
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined

    return {
      threadId,
      turnId,
      completedAtMs,
      startedAtMs,
    }
  }

  function inferNextTurnIndex(threadId: string): number {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    let maxTurnIndex = -1
    for (const message of persisted) {
      if (isOptimisticUserMessage(message)) continue
      if (typeof message.turnIndex === 'number' && Number.isFinite(message.turnIndex)) {
        maxTurnIndex = Math.max(maxTurnIndex, message.turnIndex)
      }
    }
    return maxTurnIndex + 1
  }

  function setTurnIndexForThread(threadId: string, turnId: string, turnIndex: number): void {
    if (!threadId || !turnId || !Number.isInteger(turnIndex) || turnIndex < 0) return
    const previous = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    if (previous[turnId] === turnIndex) return
    turnIndexByTurnIdByThreadId.value = {
      ...turnIndexByTurnIdByThreadId.value,
      [threadId]: {
        ...previous,
        [turnId]: turnIndex,
      },
    }
  }

  function replaceTurnIndexLookupForThread(threadId: string, nextLookup: Record<string, number>): void {
    const previous = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    const previousEntries = Object.entries(previous)
    const nextEntries = Object.entries(nextLookup)
    if (
      previousEntries.length === nextEntries.length
      && previousEntries.every(([turnId, turnIndex]) => nextLookup[turnId] === turnIndex)
    ) {
      return
    }

    turnIndexByTurnIdByThreadId.value = {
      ...turnIndexByTurnIdByThreadId.value,
      [threadId]: { ...nextLookup },
    }
  }

  function rebindLiveFileChangeTurnIndices(threadId: string): void {
    const current = liveFileChangeMessagesByThreadId.value[threadId]
    if (!current || current.length === 0) return

    const turnIndexByTurnId = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    let changed = false
    const next = current.map((message) => {
      if (typeof message.turnIndex === 'number' || !message.turnId) {
        return message
      }
      const turnIndex = turnIndexByTurnId[message.turnId]
      if (typeof turnIndex !== 'number') return message
      changed = true
      return { ...message, turnIndex }
    })

    if (!changed) return
    liveFileChangeMessagesByThreadId.value = {
      ...liveFileChangeMessagesByThreadId.value,
      [threadId]: next,
    }
  }

  function readCommandExecutionStarted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/started') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status: 'inProgress', aggregatedOutput: '', exitCode: null },
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCommandExecutionCompleted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const statusRaw = readString(item.status)
    const status: CommandExecutionData['status'] =
      statusRaw === 'failed' ? 'failed' : statusRaw === 'declined' ? 'declined' : statusRaw === 'interrupted' ? 'interrupted' : 'completed'
    const aggregatedOutput = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status, aggregatedOutput, exitCode },
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCompletedFileChange(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'fileChange') return null
    const id = readString(item.id)
    if (!id) return null
    const threadId = readString(params?.threadId)
    const turnId = readString(params?.turnId)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined

    const fileChanges = toUiFileChanges(item.changes)
    const fileChangeStatus = normalizeFileChangeStatus(item.status)
    if (fileChanges.length === 0 || fileChangeStatus !== 'completed') return null

    return {
      id,
      role: 'system',
      text: '',
      messageType: 'fileChange',
      fileChangeStatus,
      fileChanges,
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function upsertLiveCommand(threadId: string, msg: UiMessage): void {
    const previous = liveCommandsByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, msg)
    if (next === previous) return
    liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
  }

  function removeLiveCommandsPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveCommandsByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((m) => m.id))
    const next = current.filter((m) => !persistedIds.has(m.id))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    } else {
      liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
    }
  }

  function removeLiveFileChangesPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveFileChangeMessagesByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((message) => message.id))
    const persistedTurnIds = new Set(
      persistedMessages
        .filter((message) => message.messageType === 'fileChange' && typeof message.turnId === 'string' && message.turnId.length > 0)
        .map((message) => message.turnId as string),
    )
    const persistedTurnIndices = new Set(
      persistedMessages
        .filter((message) => message.messageType === 'fileChange' && typeof message.turnIndex === 'number')
        .map((message) => message.turnIndex as number),
    )
    const next = current.filter((message) => (
      !persistedIds.has(message.id)
      && !(message.turnId && persistedTurnIds.has(message.turnId))
      && !(typeof message.turnIndex === 'number' && persistedTurnIndices.has(message.turnIndex))
    ))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
    } else {
      liveFileChangeMessagesByThreadId.value = { ...liveFileChangeMessagesByThreadId.value, [threadId]: next }
    }
  }

  function applyRealtimeUpdates(notification: RpcNotification): void {
    if (notification.method === 'thread/readState/changed') {
      const params = asRecord(notification.params)
      const state = asRecord(params?.readState)
      const thread = flattenThreads(sourceGroups.value).find(row => row.id === params?.threadId)
      if (thread && state && typeof state.revision === 'string' && 'firstUnread' in state) {
        thread.nativeReadState = state as import('../types/codex').NativeThreadReadState
        applyThreadFlags()
      }
      return
    }

    const completion = readTurnCompletedInfo(notification)
    if (completion) {
      const activeTurnId = activeTurnIdByThreadId.value[completion.threadId]
      if (activeTurnId && activeTurnId !== completion.turnId) {
        // Retire only this old turn's timing entry. All thread-scoped state belongs
        // to the newer turn; notification-driven history synchronization still runs.
        pendingTurnStartsById.delete(completion.turnId)
        return
      }
    }
    if (notification.method === 'app-server/subscriptionRecovery' || notification.method === 'app-server/subscriptionFailed') {
      const params = asRecord(notification.params)
      const threadId = readString(params?.threadId)
      if (!threadId) return
      const state = readString(params?.state) || 'failed'
      const pendingDismissal = recoveryDismissTimerByThreadId.get(threadId)
      if (pendingDismissal !== undefined) clearTimeout(pendingDismissal)
      recoveryDismissTimerByThreadId.delete(threadId)
      recoveryByThreadId.value = { ...recoveryByThreadId.value, [threadId]: state }
      if (state === 'recovered') {
        const timer = setTimeout(() => {
          // A late callback must not dismiss a newer recovery notification.
          if (recoveryDismissTimerByThreadId.get(threadId) !== timer) return
          recoveryDismissTimerByThreadId.delete(threadId)
          recoveryByThreadId.value = omitKey(recoveryByThreadId.value, threadId)
        }, 3000)
        recoveryDismissTimerByThreadId.set(threadId, timer)
      }
      invalidateResumeThread(threadId)
      resumedThreadById.value = { ...resumedThreadById.value, [threadId]: state === 'recovered' }
      loadedMessagesByThreadId.value = omitKey(loadedMessagesByThreadId.value, threadId)
      loadedVersionByThreadId.value = omitKey(loadedVersionByThreadId.value, threadId)
      if (state === 'recovered' && selectedThreadId.value === threadId) {
        void loadMessages(threadId, { silent: true, force: true }).catch(() => {})
      }
      return
    }
    if (notification.method === 'app-server/reconnected') {
      transportState.value = 'connected'
      void recoverBridgeState(true)
      return
    }
    if (notification.method === 'app-server/disconnected') {
      const message = connectionErrorMessage
      transportState.value = 'disconnected'
      for (const threadId of Object.keys(pendingServerRequestsByThreadId.value)) {
        lostApprovalByThreadId.value = { ...lostApprovalByThreadId.value, [threadId]: true }
      }
      for (const threadId of Object.keys(resumedThreadById.value)) invalidateResumeThread(threadId)
      resumedThreadById.value = {}
      pendingServerRequestsByThreadId.value = {}
      for (const threadId of Object.keys(inProgressById.value)) {
        if (inProgressById.value[threadId] !== true) continue
        unknownOutcomeByThreadId.value = { ...unknownOutcomeByThreadId.value, [threadId]: true }
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
        setTurnErrorForThread(threadId, message, { transient: true })
        clearPendingTurnRequest(threadId)
      }
      activeTurnIdByThreadId.value = {}
      error.value = message
      return
    }
    if (handleServerRequestNotification(notification)) {
      return
    }

    if (notification.method === 'account/rateLimits/updated') {
      scheduleRateLimitRefresh()
    }

    if (notification.method === 'thread/name/updated') {
      const params = asRecord(notification.params)
      const threadId = readString(params?.threadId)
      const threadName = readString(params?.threadName)
      if (threadId && threadName) {
        applyNativeThreadName(threadId, threadName)
      }
    }

    if (notification.method === 'account/rateLimits/updated') {
      setCodexRateLimit(pickCodexRateLimitSnapshot(notification.params))
      return
    }

    const tokenUsageUpdate = readThreadTokenUsageUpdate(notification)
    if (tokenUsageUpdate) {
      setThreadTokenUsage(tokenUsageUpdate.threadId, tokenUsageUpdate.usage)
      return
    }

    const turnActivity = readTurnActivity(notification)
    if (turnActivity) {
      setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    }

    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (notificationThreadId && (
      notification.method.startsWith('turn/') || notification.method.startsWith('item/') || notification.method === 'error'
    )) {
      realtimeRevisionByThreadId.set(notificationThreadId, (realtimeRevisionByThreadId.get(notificationThreadId) ?? 0) + 1)
    }
    if (notificationThreadId && (notification.method === 'turn/started' || notification.method === 'turn/generationMetadata')) {
      const params = asRecord(notification.params)
      const turn = asRecord(params?.turn)
      const turnId = readString(turn?.id) || readString(params?.turnId)
      const metadata = readGenerationMetadata(turn?.generationMetadata ?? params?.generationMetadata)
      if (turnId && metadata) {
        retainGenerationMetadata(notificationThreadId, turnId, metadata)
      }
    }
    const notificationErrorState = readNotificationErrorState(notification)
    if (!notificationErrorState && notificationThreadId) {
      clearTransientTurnErrorForThread(notificationThreadId)
    }

    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      setTurnIndexForThread(startedTurn.threadId, startedTurn.turnId, inferNextTurnIndex(startedTurn.threadId))
      activeTurnIdByThreadId.value = {
        ...activeTurnIdByThreadId.value,
        [startedTurn.threadId]: startedTurn.turnId,
      }
      maybeUnblockInterruptForActiveTurn(startedTurn.threadId, startedTurn.turnId)
      clearLivePlansForThread(startedTurn.threadId)
      clearLiveFileChangesForThread(startedTurn.threadId)
      setTurnSummaryForThread(startedTurn.threadId, null)
      setTurnErrorForThread(startedTurn.threadId, null)
      setThreadInProgress(startedTurn.threadId, true)
    }

    const completedTurn = readTurnCompletedInfo(notification)
    const turnErrorMessage = readTurnErrorMessage(notification)
    const completedThreadId = completedTurn?.threadId ?? extractThreadIdFromNotification(notification)
    if (completedTurn) {
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) {
        pendingTurnStartsById.delete(completedTurn.turnId)
      }

      const rawDurationMs =
        readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number'
          ? completedTurn.completedAtMs - completedTurn.startedAtMs
          : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)

      const durationMs = typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0
      setTurnSummaryForThread(completedTurn.threadId, {
        turnId: completedTurn.turnId,
        durationMs,
      })
      if (activeTurnIdByThreadId.value[completedTurn.threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, completedTurn.threadId)
      }
      setThreadInProgress(completedTurn.threadId, false)
      setTurnActivityForThread(completedTurn.threadId, null)
      clearPendingTurnRequest(completedTurn.threadId)
    }

    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
      }
      error.value = turnErrorMessage
    } else if (completedTurn) {
      setTurnErrorForThread(completedTurn.threadId, null)
    }

    if (notificationErrorState) {
      const errorThreadId = notificationThreadId
      if (errorThreadId) {
        setTurnErrorForThread(errorThreadId, notificationErrorState.message, {
          transient: notificationErrorState.transient,
        })
        if (notificationErrorState.transient !== true) {
          setThreadInProgress(errorThreadId, false)
          setTurnActivityForThread(errorThreadId, null)
          clearPendingTurnRequest(errorThreadId)
          if (activeTurnIdByThreadId.value[errorThreadId]) {
            activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, errorThreadId)
          }
        }
      }
      error.value = notificationErrorState.message
    }

    const planUpdate = readPlanUpdate(notification)
    if (planUpdate) {
      upsertLivePlanMessage(planUpdate.threadId, planUpdate.message)
      setTurnActivityForThread(planUpdate.threadId, {
        label: 'Planning',
        details: planUpdate.message.plan?.steps.map((step) => step.step).slice(0, 2) ?? [],
      })
    }

    const planDelta = readPlanDelta(notification)
    if (planDelta) {
      upsertLivePlanMessage(planDelta.threadId, planDelta.message)
      setTurnActivityForThread(planDelta.threadId, {
        label: 'Planning',
        details: [],
      })
    }

    if (!notificationThreadId || notificationThreadId !== selectedThreadId.value) return

    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) {
      activeReasoningItemId = ''
    }

    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) {
      const existing = (liveAgentMessagesByThreadId.value[notificationThreadId] ?? [])
        .find((message) => message.id === liveAgentMessageDelta.messageId)
        ?? (persistedMessagesByThreadId.value[notificationThreadId] ?? [])
          .find((message) => message.id === liveAgentMessageDelta.messageId)
      const nextText = `${existing?.text ?? ''}${liveAgentMessageDelta.delta}`
      upsertLiveAgentMessage(notificationThreadId, {
        id: liveAgentMessageDelta.messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'agentMessage.live',
      })
    }

    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      upsertLiveAgentMessage(notificationThreadId, completedAgentMessage)
    }

    const completedImageView = readCompletedImageView(notification)
    if (completedImageView) {
      upsertLiveAgentMessage(notificationThreadId, completedImageView)

    }

    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      activeReasoningItemId = startedReasoningItemId
    }

    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) {
      appendLiveReasoningText(notificationThreadId, liveReasoningDelta.delta)
    }

    const sectionBreakMessageId = readReasoningSectionBreakMessageId(notification)
    if (sectionBreakMessageId) {
      const current = liveReasoningTextByThreadId.value[notificationThreadId] ?? ''
      if (current.trim().length > 0 && !current.endsWith('\n\n')) {
        setLiveReasoningText(notificationThreadId, `${current}\n\n`)
      }
    }

    const completedReasoningMessageId = readReasoningCompletedId(notification)
    if (completedReasoningMessageId) {
      if (completedReasoningMessageId === liveReasoningMessageId(activeReasoningItemId)) {
        activeReasoningItemId = ''
      }
    }

    const commandStarted = readCommandExecutionStarted(notification)
    if (commandStarted) {
      upsertLiveCommand(notificationThreadId, commandStarted)
      setTurnActivityForThread(notificationThreadId, { label: 'Running command', details: [commandStarted.commandExecution?.command ?? ''] })
    }

    const commandDelta = readCommandOutputDelta(notification)
    if (commandDelta) {
      const current = (liveCommandsByThreadId.value[notificationThreadId] ?? []).find((m) => m.id === commandDelta.itemId)
      if (current?.commandExecution) {
        upsertLiveCommand(notificationThreadId, {
          ...current,
          commandExecution: { ...current.commandExecution, aggregatedOutput: `${current.commandExecution.aggregatedOutput}${commandDelta.delta}` },
        })
      }
    }

    const commandCompleted = readCommandExecutionCompleted(notification)
    if (commandCompleted) {
      upsertLiveCommand(notificationThreadId, commandCompleted)
    }

    const completedFileChange = readCompletedFileChange(notification)
    if (completedFileChange) {
      upsertLiveFileChangeMessage(notificationThreadId, completedFileChange)
    }

    if (isAgentContentEvent(notification)) {
      activeReasoningItemId = ''
      clearLiveReasoningForThread(notificationThreadId)
    }

    if (notification.method === 'turn/completed') {
      activeReasoningItemId = ''
      clearLiveReasoningForThread(notificationThreadId)
      if (liveCommandsByThreadId.value[notificationThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, notificationThreadId)
      }
      const completedThreadId = extractThreadIdFromNotification(notification)
      if (completedThreadId) {
        clearDelayedTurnSync(completedThreadId)
        setThreadInProgress(completedThreadId, false)
        setTurnActivityForThread(completedThreadId, null)
        clearPendingTurnRequest(completedThreadId)
        if (turnErrorMessage) {
          clearLivePlansForThread(completedThreadId)
          setLiveAgentMessagesForThread(completedThreadId, [])
          clearLiveReasoningForThread(completedThreadId)
          if (liveCommandsByThreadId.value[completedThreadId]) {
            liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, completedThreadId)
          }
        }
      }
    }

  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    const generation = lifecycleGeneration
    if (notification.method === 'thread/tokenUsage/updated' || notification.method === 'thread/readState/changed') return

    const method = notification.method
    const shouldRefreshMessages =
      method === 'turn/started' ||
      method === 'turn/completed' ||
      method === 'thread/reverted' ||
      method === 'error'
    const shouldRefreshThreads =
      method.startsWith('thread/') ||
      method === 'turn/completed'

    if (!shouldRefreshMessages && !shouldRefreshThreads) return

    const threadId = extractThreadIdFromNotification(notification)
    if (threadId && method === 'thread/reverted') {
      invalidateResumeThread(threadId)
      invalidateThreadHistory(threadId)
      setLiveAgentMessagesForThread(threadId, [])
      clearLiveReasoningForThread(threadId)
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
    }
    if (threadId && shouldRefreshMessages) {
      pendingThreadMessageRefresh.add(threadId)
    }

    if (shouldRefreshThreads) {
      pendingThreadsRefresh = true
      pendingThreadsRefreshForce = true
    }

    if (eventSyncTimer !== null || typeof window === 'undefined') return
    eventSyncTimer = window.setTimeout(() => {
      if (generation !== lifecycleGeneration) return
      eventSyncTimer = null
      void syncFromNotifications()
    }, EVENT_SYNC_DEBOUNCE_MS)
  }

  function applyWorkspaceRootsState(rootsState: WorkspaceRootsState): void {
    const nextLabels: Record<string, string> = {}
    const ids = getWorkspaceProjectOrderPaths(rootsState)
    const names = getWorkspaceProjectOrderNames(rootsState, collectDuplicateProjectLeafNames(loadedThreadListGroups, rootsState))
    for (const rootPath of rootsState.order) {
      const leafName = toProjectNameFromWorkspaceRoot(rootPath)
      const parentLeafName = toProjectName(getPathParent(rootPath))
      const label = (parentLeafName.startsWith('.') && parentLeafName !== leafName ? `${leafName} ${parentLeafName}` : '')
      if (!label) continue
      nextLabels[rootPath] = label
      nextLabels[names[ids.indexOf(rootPath)] ?? rootPath] = label
    }
    for (const remote of rootsState.remoteProjects ?? []) nextLabels[remote.id] = getRemoteProjectDisplayName(remote)
    projectDisplayNameById.value = nextLabels
    loadedThreadListRootsState = rootsState
    applyThreadGroups(loadedThreadListGroups, rootsState)
  }

  function queueProjectOperation(operation: () => Promise<void>): Promise<void> {
    const run = projectOperationPromise.then(operation).catch((cause: unknown) => {
      error.value = cause instanceof Error ? cause.message : 'Failed to update projects'
    })
    projectOperationPromise = run
    return run
  }

  function refreshWorkspaceRoots(): Promise<WorkspaceRootsState | null> {
    if (workspaceRootsRefreshPromise) return workspaceRootsRefreshPromise
    let refreshedState: WorkspaceRootsState | null = null
    const run = queueProjectOperation(async () => {
      invalidateWorkspaceRootsStateCache()
      refreshedState = await getWorkspaceRootsState()
      applyWorkspaceRootsState(refreshedState)
    }).then(() => refreshedState).finally(() => {
      if (workspaceRootsRefreshPromise === run) workspaceRootsRefreshPromise = null
    })
    workspaceRootsRefreshPromise = run
    return run
  }

  async function loadWorkspaceRootsStateForThreadList(): Promise<WorkspaceRootsState | null> {
    const generation = lifecycleGeneration
    try {
      return await getWorkspaceRootsState()
    } catch (cause) {
      if (generation === lifecycleGeneration) error.value = cause instanceof Error ? cause.message : 'Failed to load projects'
      return loadedThreadListRootsState
    }
  }

  function applyThreadGroups(groups: UiProjectGroup[], rootsState: WorkspaceRootsState | null): void {
    const visibleGroups = filterGroupsByWorkspaceRoots(groups, rootsState)
    const serverThreadIds = new Set(flattenThreads(visibleGroups).map((thread) => thread.id))
    markServerListedThreads(serverThreadIds)
    // Filter local candidates as well: retention must never resurrect a removed workspace.
    const visibleLocalGroups = filterGroupsByWorkspaceRoots(sourceGroups.value, rootsState)
    const visibleLocalIds = new Set(flattenThreads(visibleLocalGroups).map((thread) => thread.id))
    const now = Date.now()
    for (const [threadId, deadline] of localThreadConfirmationDeadlineById) {
      if (serverThreadIds.has(threadId) || !visibleLocalIds.has(threadId)
        || (now >= deadline && inProgressById.value[threadId] !== true)) {
        localThreadConfirmationDeadlineById.delete(threadId)
      }
    }
    const mergedWithLocal = mergeIncomingWithLocalThreads(
      visibleLocalGroups,
      visibleGroups,
      inProgressById.value,
      localThreadConfirmationDeadlineById,
    )
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, mergedWithLocal)
    scheduleLocalThreadReconciliation()
    inProgressById.value = pruneThreadStateMap(
      inProgressById.value,
      new Set(flattenThreads(sourceGroups.value).map((thread) => thread.id)),
    )
    applyThreadFlags()
  }

  function removeArchivedThreadFromLoadedLists(threadId: string): void {
    invalidateThreadHistory(threadId)
    localThreadConfirmationDeadlineById.delete(threadId)
    scheduleLocalThreadReconciliation()
    loadedThreadListGroups = removeThreadFromGroups(loadedThreadListGroups, threadId)
    sourceGroups.value = removeThreadFromGroups(sourceGroups.value, threadId)
    inProgressById.value = omitKey(inProgressById.value, threadId)
    applyThreadFlags()
  }

  function scheduleLocalThreadReconciliation(): void {
    const generation = lifecycleGeneration
    if (typeof window === 'undefined') return
    const now = Date.now()
    const needsReconciliation = Array.from(localThreadConfirmationDeadlineById).some(
      ([threadId, deadline]) => now < deadline || inProgressById.value[threadId] !== true,
    )
    if (!needsReconciliation) {
      if (localThreadReconciliationTimer !== null) window.clearTimeout(localThreadReconciliationTimer)
      localThreadReconciliationTimer = null
      return
    }
    if (localThreadReconciliationTimer !== null) return
    // One shared timer and the existing coalesced loader, regardless of chat count.
    localThreadReconciliationTimer = window.setTimeout(() => {
      if (generation !== lifecycleGeneration) return
      localThreadReconciliationTimer = null
      void loadThreads().catch(() => {
        // Even if the bridge stays unavailable, the local retention lease is bounded.
      }).finally(() => {
        if (generation === lifecycleGeneration) applyThreadGroups(loadedThreadListGroups, loadedThreadListRootsState)
      })
    }, LOCAL_THREAD_RECONCILIATION_INTERVAL_MS)
  }

  function mergeThreadGroupPages(previous: UiProjectGroup[], incoming: UiProjectGroup[]): UiProjectGroup[] {
    if (previous.length === 0) return incoming
    if (incoming.length === 0) return previous

    const threadById = new Map<string, UiThread>()
    for (const thread of flattenThreads(previous)) {
      threadById.set(thread.id, thread)
    }
    for (const thread of flattenThreads(incoming)) {
      threadById.set(thread.id, thread)
    }
    const groupsByProject = new Map<string, UiThread[]>()
    for (const thread of threadById.values()) {
      const existing = groupsByProject.get(thread.projectName)
      if (existing) existing.push(thread)
      else groupsByProject.set(thread.projectName, [thread])
    }

    return Array.from(groupsByProject.entries())
      .map(([projectName, threads]) => ({
        projectName,
        threads: threads.sort(
          (first, second) => new Date(second.updatedAtIso).getTime() - new Date(first.updatedAtIso).getTime(),
        ),
      }))
      .sort((first, second) => {
        const firstUpdated = new Date(first.threads[0]?.updatedAtIso ?? 0).getTime()
        const secondUpdated = new Date(second.threads[0]?.updatedAtIso ?? 0).getTime()
        return secondUpdated - firstUpdated
      })
  }

  function hasActiveInProgressThreads(): boolean {
    return Object.values(inProgressById.value).some((value) => value === true)
  }

  function invalidateThreadListGeneration(): number {
    threadListGeneration += 1
    remainingThreadPageRequest = null
    if (threadListBackgroundTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(threadListBackgroundTimer)
      threadListBackgroundTimer = null
    }
    return threadListGeneration
  }

  function scheduleRemainingThreadPages(): void {
    if (!threadListNextCursor || remainingThreadPageRequest || loadThreadsPromise || hasActiveInProgressThreads()) return
    const generation = threadListGeneration
    const cursor = threadListNextCursor
    if (typeof window === 'undefined') {
      void loadRemainingThreadPages()
      return
    }
    if (threadListBackgroundTimer !== null) window.clearTimeout(threadListBackgroundTimer)
    threadListBackgroundTimer = window.setTimeout(() => {
      if (generation !== threadListGeneration || cursor !== threadListNextCursor) return
      threadListBackgroundTimer = null
      if (hasActiveInProgressThreads()) return
      void loadRemainingThreadPages()
    }, BACKGROUND_THREAD_PAGINATION_DELAY_MS)
  }

  async function loadRemainingThreadPages(): Promise<void> {
    if (remainingThreadPageRequest || loadThreadsPromise || !threadListNextCursor || hasActiveInProgressThreads()) return
    const request = { generation: threadListGeneration, cursor: threadListNextCursor }
    remainingThreadPageRequest = request
    let applied = false
    try {
      const page = await getThreadGroupsPage(request.cursor, getBackgroundThreadListLimit())
      if (request !== remainingThreadPageRequest || request.generation !== threadListGeneration
        || request.cursor !== threadListNextCursor) return
      threadListNextCursor = page.nextCursor === request.cursor ? null : page.nextCursor
      hasLoadedAllThreadPages = threadListNextCursor === null
      isThreadListFullyLoaded.value = hasLoadedAllThreadPages
      loadedThreadListGroups = mergeThreadGroupPages(loadedThreadListGroups, page.groups)
      // Roots may have changed while this history request was in flight.
      applyThreadGroups(loadedThreadListGroups, loadedThreadListRootsState)
      applied = true
    } catch {
      // Retain the last list and cursor; retry only after a later refresh.
    } finally {
      if (request === remainingThreadPageRequest && request.generation === threadListGeneration) {
        remainingThreadPageRequest = null
        if (applied) scheduleRemainingThreadPages()
      }
    }
  }

  async function loadThreads(options: { force?: boolean } = {}): Promise<void> {
    const lifecycle = lifecycleGeneration
    if (loadThreadsPromise) {
      if (options.force === true && !pendingForcedThreadLoad) {
        pendingForcedThreadLoad = true
        invalidateThreadListGeneration()
        invalidateWorkspaceRootsStateCache()
      }
      return loadThreadsPromise
    }
    if (options.force !== true && hasLoadedThreads.value
      && Date.now() - lastThreadListLoadAt < RECENT_THREAD_LIST_LOAD_REUSE_MS) return

    const requestGeneration = ++threadListLoadGeneration
    let completedGeneration = -1
    const run = (async () => {
      let force = options.force === true
      let failure: unknown
      do {
        pendingForcedThreadLoad = false
        failure = undefined
        const generation = invalidateThreadListGeneration()
        if (force) invalidateWorkspaceRootsStateCache()
        if (!hasLoadedThreads.value) isLoadingThreads.value = true
        try {
          const rootsGeneration = getWorkspaceRootsStateGeneration()
          const [page, requestedRootsState] = await Promise.all([
            getThreadGroupsPage(),
            loadWorkspaceRootsStateForThreadList(),
          ])
          if (generation === threadListGeneration) {
            // A registration or edit can invalidate roots while the thread page loads.
            const rootsState = rootsGeneration === getWorkspaceRootsStateGeneration()
              ? requestedRootsState
              : await loadWorkspaceRootsStateForThreadList()
            if (generation === threadListGeneration) {
              loadedThreadListGroups = hasLoadedThreads.value
                ? mergeThreadGroupPages(loadedThreadListGroups, page.groups)
                : page.groups
              threadListNextCursor = hasLoadedThreads.value && !force && !hasLoadedAllThreadPages
                ? threadListNextCursor
                : page.nextCursor
              hasLoadedAllThreadPages = threadListNextCursor === null
              isThreadListFullyLoaded.value = hasLoadedAllThreadPages
              if (rootsState) applyWorkspaceRootsState(rootsState)
              else applyThreadGroups(loadedThreadListGroups, loadedThreadListRootsState)
              completedGeneration = generation
              hasLoadedThreads.value = true
              lastThreadListLoadAt = Date.now()
              const threads = flattenThreads(projectGroups.value)
              pruneThreadScopedState(threads)
              if (!selectedThreadId.value) setSelectedThreadId(threads[0]?.id ?? '')
            }
          }
        } catch (cause) {
          if (generation === threadListGeneration) failure = cause
        }
        if (lifecycle !== lifecycleGeneration || requestGeneration !== threadListLoadGeneration) return
        force = pendingForcedThreadLoad
      } while (pendingForcedThreadLoad)
      if (failure) throw failure
    })().finally(() => {
      if (loadThreadsPromise !== run) return
      loadThreadsPromise = null
      isLoadingThreads.value = false
      if (completedGeneration === threadListGeneration && !hasLoadedAllThreadPages) scheduleRemainingThreadPages()
    })
    loadThreadsPromise = run
    return run
  }

  async function loadMessages(threadId: string, options: { silent?: boolean; force?: boolean } = {}) {
    const generation = lifecycleGeneration
    if (!threadId) {
      return
    }
    const owner = historyReadOwner(threadId)
    const isCurrent = () => generation === lifecycleGeneration && historyReadOwnerByThreadId.get(threadId) === owner
    const recentLoadFailure =
      Date.now() - (lastMessageLoadFailureAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS
    if (options.force !== true && turnErrorByThreadId.value[threadId]?.transient && (options.silent === true || recentLoadFailure)) {
      return
    }

    const existingLoad = loadMessagePromiseByThreadId.get(threadId)
    if (existingLoad) {
      await existingLoad
      // A send/completion that arrived during this read still needs a fresh snapshot.
      if (isCurrent() && options.force === true) await loadMessages(threadId, options)
      return
    }

    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    if (shouldShowLoading) {
      visibleMessageLoads.add(threadId)
      syncMessageLoading()
    }

    const loadPromise = (async () => {
      try {
      const version = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const loadedRecently =
        Date.now() - (lastMessageLoadAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS
      const canReuseLoadedMessages =
        flattenThreads(sourceGroups.value).find(row => row.id === threadId)?.nativeReadState?.firstUnread == null &&
        options.force !== true &&
        alreadyLoaded &&
        (version.length === 0 || loadedVersion === version) &&
        (
          loadedRecently ||
          inProgressById.value[threadId] !== true
        )

      if (canReuseLoadedMessages && resumedThreadById.value[threadId] === true) {
        markThreadAsRead(threadId)
        return
      }

      const observedReadRevision = flattenThreads(sourceGroups.value).find(row => row.id === threadId)?.nativeReadState?.revision
      const needsResume = resumedThreadById.value[threadId] !== true
      const realtimeRevision = realtimeRevisionByThreadId.get(threadId) ?? 0
      const resumedThread = needsResume ? await resumeThread(threadId) : null
      if (!isCurrent()) return
      const detail = resumedThread ?? await getThreadDetail(threadId)
      if (!isCurrent()) return
      const currentThread = flattenThreads(sourceGroups.value).find(row => row.id === threadId)
      if ('nativeReadState' in detail && currentThread?.nativeReadState?.revision === observedReadRevision && currentThread) {
        currentThread.nativeReadState = detail.nativeReadState
        applyThreadFlags()
      }
      const currentActiveTurnId = activeTurnIdByThreadId.value[threadId]
      const hasNewerTurnState = realtimeRevision !== (realtimeRevisionByThreadId.get(threadId) ?? 0)
        || (inProgressById.value[threadId] === true && !detail.inProgress
          && (currentActiveTurnId
            ? !detail.messages.some((message) => message.turnId === currentActiveTurnId)
            : Boolean(pendingTurnRequestByThreadId.value[threadId])))

      if (detail.model || detail.modelProvider) {
        setThreadModelId(threadId, detail.model, detail.modelProvider)
      }
      if (resumedThread) {
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const { messages: nextMessages, inProgress, activeTurnId, turnIndexByTurnId } = detail
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      const firstFreshIndex = nextMessages.reduce((first, message) => Math.min(first, message.turnIndex ?? Infinity), Infinity)
      // A capped detail snapshot cannot invalidate history preceding its range.
      // Empty snapshots still retain their existing replacement semantics.
      const earlierMessages = Number.isFinite(firstFreshIndex)
        ? previousPersisted.filter(message => typeof message.turnIndex === 'number' && message.turnIndex < firstFreshIndex)
        : []
      const retainsOlderPage = earlierMessages.length > 0 || Boolean(owner.olderPageBoundary && nextMessages.some(message => message.turnId === owner.olderPageBoundary))
      if (!retainsOlderPage) delete owner.olderPageBoundary
      const earlierIndices = retainsOlderPage ? Object.fromEntries(
        Object.entries(turnIndexByTurnIdByThreadId.value[threadId] ?? {}).filter(([, index]) => index < firstFreshIndex),
      ) : {}
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: retainsOlderPage ? hasMoreOlderMessagesByThreadId.value[threadId] === true : detail.hasMoreOlder === true,
      }
      markThreadMessagesPersisted(threadId, nextMessages)
      replaceTurnIndexLookupForThread(threadId, { ...earlierIndices, ...turnIndexByTurnId })
      rebindLiveFileChangeTurnIndices(threadId)
      const mergedMessages = mergeMessages(previousPersisted, nextMessages, {
        preserveMissing: options.silent === true || hasOptimisticUserMessages(previousPersisted),
      })
      setPersistedMessagesForThread(threadId, mergeMessages(earlierMessages, mergedMessages, { preserveMissing: true }))

      const previousLiveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
      const nextLiveAgent = removeRedundantLiveAgentMessages(previousLiveAgent, nextMessages, {
        preferSnapshotOnMismatch: reconnectingThreadHistory.has(threadId),
      })
      setLiveAgentMessagesForThread(threadId, nextLiveAgent)
      removeLiveCommandsPersistedIn(threadId, nextMessages)
      removeLiveFileChangesPersistedIn(threadId, nextMessages)

      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [threadId]: true,
      }
      lastMessageLoadAtByThreadId.set(threadId, Date.now())
      lastMessageLoadFailureAtByThreadId.delete(threadId)
      if (error.value === connectionErrorMessage) error.value = ''
      if (!inProgress) reconnectingThreadHistory.delete(threadId)

      if (version) {
        loadedVersionByThreadId.value = {
          ...loadedVersionByThreadId.value,
          [threadId]: version,
        }
      }
      if (!hasNewerTurnState) {
        setThreadInProgress(threadId, inProgress)
        clearTransientTurnErrorForThread(threadId)
        if (activeTurnId) {
          activeTurnIdByThreadId.value = {
            ...activeTurnIdByThreadId.value,
            [threadId]: activeTurnId,
          }
        } else if (activeTurnIdByThreadId.value[threadId]) {
          activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
        }
        if (!inProgress) {
          clearCompletedTurnLiveState(threadId)
        }
      }
      if (observedReadRevision !== undefined) markThreadAsRead(threadId, observedReadRevision)
      } catch (unknownError) {
        if (!isCurrent()) throw unknownError
        const message = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        if (selectedThreadId.value === threadId) {
          setTurnErrorForThread(threadId, message, { transient: true })
        }
        lastMessageLoadFailureAtByThreadId.set(threadId, Date.now())
        throw unknownError
      }
    })().finally(() => {
      if (isCurrent() && loadMessagePromiseByThreadId.get(threadId) === loadPromise) {
        loadMessagePromiseByThreadId.delete(threadId)
        visibleMessageLoads.delete(threadId)
        syncMessageLoading()
      }
    })

    loadMessagePromiseByThreadId.set(threadId, loadPromise)
    await loadPromise
  }

  async function loadOlderMessages(threadId: string = selectedThreadId.value): Promise<void> {
    const generation = lifecycleGeneration
    if (!threadId) return
    const owner = historyReadOwner(threadId)
    const isCurrent = () => generation === lifecycleGeneration && historyReadOwnerByThreadId.get(threadId) === owner
    if (loadingOlderMessagesByThreadId.value[threadId] === true) return
    if (hasMoreOlderMessagesByThreadId.value[threadId] !== true) return

    const beforeTurnId = getFirstPersistedTurnId(threadId)
    if (!beforeTurnId) {
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: false,
      }
      return
    }

    loadingOlderMessagesByThreadId.value = {
      ...loadingOlderMessagesByThreadId.value,
      [threadId]: true,
    }

    try {
      const page = await getOlderThreadMessages(threadId, beforeTurnId)
      if (!isCurrent()) return
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      if (!previousPersisted.some(message => message.turnId === beforeTurnId)) return
      const mergedMessages = mergeMessages(page.messages, previousPersisted, { preserveMissing: true })
      setPersistedMessagesForThread(threadId, mergedMessages)
      owner.olderPageBoundary = getFirstPersistedTurnId(threadId) || beforeTurnId
      replaceTurnIndexLookupForThread(threadId, {
        ...(turnIndexByTurnIdByThreadId.value[threadId] ?? {}),
        ...page.turnIndexByTurnId,
      })
      rebindLiveFileChangeTurnIndices(threadId)
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: page.hasMoreOlder,
      }
    } catch (loadError) {
      if (!isCurrent()) throw loadError
      error.value = loadError instanceof Error ? loadError.message : 'Failed to load earlier messages'
      throw loadError
    } finally {
      if (isCurrent()) loadingOlderMessagesByThreadId.value = {
        ...loadingOlderMessagesByThreadId.value,
        [threadId]: false,
      }
    }
  }

  async function ensureThreadMessagesLoaded(threadId: string, options: { silent?: boolean } = {}): Promise<void> {
    if (!threadId) return
    if (loadedMessagesByThreadId.value[threadId] === true) return
    if (options.silent === true && turnErrorByThreadId.value[threadId]?.transient) return
    await loadMessages(threadId, options)
  }

  async function refreshSkills(options: { force?: boolean } = {}): Promise<void> {
    const generation = lifecycleGeneration
    const selectedCwd = selectedThread.value?.cwd?.trim() ?? ''
    const skillsLoadKey = selectedCwd || '__global__'
    const pending = refreshSkillsPromiseByDirectory.get(skillsLoadKey)
    if (pending) {
      await pending
      return
    }
    if (
      options.force !== true &&
      hasLoadedSkills &&
      lastSkillsLoadKey === skillsLoadKey &&
      Date.now() - lastSkillsLoadAt < RECENT_SKILLS_LOAD_REUSE_MS
    ) {
      return
    }

    const request = (async () => {
      try {
        const skills = await getSkillsList(selectedCwd ? [selectedCwd] : undefined)
        if (generation !== lifecycleGeneration ||
          (selectedThread.value?.cwd?.trim() || '__global__') !== skillsLoadKey) return
        installedSkills.value = skills
        hasLoadedSkills = true
        lastSkillsLoadAt = Date.now()
        lastSkillsLoadKey = skillsLoadKey
      } catch {
        // keep previous skills on failure
      }
    })()

    refreshSkillsPromiseByDirectory.set(skillsLoadKey, request)
    try {
      await request
    } finally {
      if (refreshSkillsPromiseByDirectory.get(skillsLoadKey) === request) {
        refreshSkillsPromiseByDirectory.delete(skillsLoadKey)
      }
    }
  }

  async function refreshAncillaryState(): Promise<void> {
    await Promise.allSettled([
      refreshModelPreferences(),
      refreshRateLimits(),
      refreshCollaborationModes(),
      refreshSkills(),
    ])
  }

  function scheduleAncillaryStateRefresh(): void {
    const generation = lifecycleGeneration
    const run = () => {
      if (generation === lifecycleGeneration) void refreshAncillaryState()
    }

    if (typeof window === 'undefined') {
      run()
      return
    }

    window.setTimeout(run, 0)
  }

  async function refreshAll(
    options: { includeSelectedThreadMessages?: boolean; awaitAncillaryRefreshes?: boolean; forceThreadRefresh?: boolean } = {},
  ) {
    const generation = lifecycleGeneration
    const readGeneration = eventSyncGeneration
    const isCurrent = () => generation === lifecycleGeneration && readGeneration === eventSyncGeneration
    error.value = ''
    codexCliMissingError.value = ''
    const includeSelectedThreadMessages = options.includeSelectedThreadMessages !== false
    const awaitAncillaryRefreshes = options.awaitAncillaryRefreshes === true

    try {
      await loadThreads({ force: options.forceThreadRefresh === true })
      if (!isCurrent()) return
      if (includeSelectedThreadMessages) {
        try {
          await loadMessages(selectedThreadId.value)
        } catch (unknownError) {
          if (!isCurrent()) return
          error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        }
      }
      if (!isCurrent()) return
      if (awaitAncillaryRefreshes) {
        await refreshAncillaryState()
      } else {
        scheduleAncillaryStateRefresh()
      }
    } catch (unknownError) {
      if (!isCurrent()) return
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (isCodexCliMissingError(unknownError)) {
        codexCliMissingError.value = CODEX_CLI_MISSING_MESSAGE
      } else {
        codexCliMissingError.value = ''
      }
    }
  }

  async function selectThread(threadId: string): Promise<SelectThreadResult> {
    const generation = lifecycleGeneration
    const readGeneration = eventSyncGeneration
    setSelectedThreadId(threadId)
    const selection = ++selectionGeneration

    try {
      await loadMessages(threadId)
      if (generation !== lifecycleGeneration || readGeneration !== eventSyncGeneration) return 'ok'
      await refreshModelPreferences()
      if (generation === lifecycleGeneration) void refreshSkills()
      return 'ok'
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (generation !== lifecycleGeneration || readGeneration !== eventSyncGeneration || selection !== selectionGeneration) {
        return isThreadNotFoundError(unknownError) ? 'not-found' : 'error'
      }
      error.value = message
      const result = isThreadNotFoundError(unknownError) ? 'not-found' : 'error'
      if (threadId.trim()) {
        setTurnErrorForThread(threadId, message, { transient: true })
      }
      return result
    }
  }

  async function archiveThreadById(threadId: string) {
    const wasSelectedThread = selectedThreadId.value === threadId
    const nextSelectedThreadId = wasSelectedThread
      ? findAdjacentThreadId(flattenThreads(projectGroups.value), threadId)
      : ''

    if (wasSelectedThread) {
      setSelectedThreadId(nextSelectedThreadId)
      if (nextSelectedThreadId) {
        void loadMessages(nextSelectedThreadId, { silent: true })
      }
    }

    try {
      await archiveThread(threadId)
      removeArchivedThreadFromLoadedLists(threadId)
      await loadThreads()

      if (wasSelectedThread && nextSelectedThreadId && selectedThreadId.value === nextSelectedThreadId) {
        await ensureThreadMessagesLoaded(nextSelectedThreadId, { silent: true })
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function renameThreadById(threadId: string, threadName: string) {
    const normalizedName = threadName.trim()
    if (!threadId || !normalizedName) return

    try {
      await renameThread(threadId, normalizedName)
      applyNativeThreadName(threadId, normalizedName)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function forkThreadById(threadId: string): Promise<string> {
    const sourceThreadId = threadId.trim()
    if (!sourceThreadId) return ''

    const sourceThread = flattenThreads(sourceGroups.value).find((row) => row.id === sourceThreadId)
    const sourceCwd = sourceThread?.cwd?.trim() ?? ''
    const sourceTitle = sourceThread?.title?.trim() ?? 'Forked chat'
    const selectedModel = readModelIdForThread(sourceThreadId)
    error.value = ''

    try {
      const forkedThread = await forkThread(sourceThreadId, sourceCwd || undefined, selectedModel || undefined)
      const nextThreadId = forkedThread.threadId.trim()
      if (!nextThreadId) return ''

      insertOptimisticThread(nextThreadId, sourceCwd, sourceTitle)
      setThreadModelId(nextThreadId, forkedThread.model || selectedModel, forkedThread.modelProvider)
      markFreshFork(nextThreadId, readModelIdForThread(nextThreadId))
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [nextThreadId]: true,
      }
      setSelectedThreadId(nextThreadId)
      await loadThreads()
      await loadMessages(nextThreadId)
      return nextThreadId
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      return ''
    }
  }

  async function forkThreadFromTurn(threadId: string, turnIndex: number): Promise<string> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || !Number.isInteger(turnIndex) || turnIndex < 0) return ''

    if (inProgressById.value[normalizedThreadId] === true) {
      error.value = 'Finish the current turn before forking from a response.'
      return ''
    }

    if (loadedMessagesByThreadId.value[normalizedThreadId] !== true) {
      try {
        await loadMessages(normalizedThreadId)
      } catch (unknownError) {
        error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        return ''
      }
    }

    const sourceThread = flattenThreads(sourceGroups.value).find((row) => row.id === normalizedThreadId) ?? null

    try {
      error.value = ''
      const forked = await forkThreadFromResponse(normalizedThreadId, turnIndex)
      const forkedThreadId = forked.threadId.trim()
      if (!forkedThreadId) return ''

      const forkedCwd = forked.cwd.trim() || sourceThread?.cwd?.trim() || ''
      const forkedThreadTitle = toForkedThreadTitle(sourceThread?.title || sourceThread?.preview || 'Untitled thread')
      insertOptimisticThread(forkedThreadId, forkedCwd, forkedThreadTitle)
      setThreadModelId(forkedThreadId, forked.model || readModelIdForThread(normalizedThreadId), forked.modelProvider)
      markFreshFork(forkedThreadId, readModelIdForThread(forkedThreadId))
      setPersistedMessagesForThread(forkedThreadId, forked.messages)
      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [forkedThreadId]: true,
      }
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [forkedThreadId]: true,
      }
      clearLivePlansForThread(forkedThreadId)
      setLiveAgentMessagesForThread(forkedThreadId, [])
      clearLiveReasoningForThread(forkedThreadId)
      if (liveCommandsByThreadId.value[forkedThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, forkedThreadId)
      }
      setTurnSummaryForThread(forkedThreadId, null)
      setTurnActivityForThread(forkedThreadId, null)
      setTurnErrorForThread(forkedThreadId, null)
      setThreadInProgress(forkedThreadId, false)

      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [forkedThreadId]: forked.hasMoreOlder,
      }
      replaceTurnIndexLookupForThread(forkedThreadId, forked.turnIndexByTurnId)

      await renameThreadById(forkedThreadId, forkedThreadTitle)
      setSelectedThreadId(forkedThreadId)
      void loadThreads().catch(() => {})
      return forkedThreadId
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      return ''
    }
  }

  async function maybeReplyToPendingUserInputRequest(
    threadId: string,
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<boolean> {
    if (!threadId || !text.trim()) return false
    if (imageUrls.length > 0 || skills.length > 0 || fileAttachments.length > 0) return false

    const requests = pendingServerRequestsByThreadId.value[threadId] ?? []
    const userInputRequests = requests.filter((request) => request.method === 'item/tool/requestUserInput')
    if (userInputRequests.length !== 1) return false

    const [request] = userInputRequests
    const questionIds = readToolRequestUserInputQuestionIds(request)
    if (questionIds.length !== 1) return false

    return respondToPendingServerRequest({
      id: request.id,
      result: {
        answers: {
          [questionIds[0]]: {
            answers: [text.trim()],
          },
        },
      },
    })
  }

  async function sendMessageToSelectedThread(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    collaborationModeOverride?: CollaborationModeKind,
  ): Promise<void> {
    const generation = lifecycleGeneration
    const submissionContext = { generation, modelId: readModelIdForThread(selectedThreadId.value), reasoningEffort: selectedReasoningEffort.value }
    if (isUpdatingSpeedMode.value) return

    let threadId = selectedThreadId.value
    const nextText = text.trim()
    if (!threadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)) return

    if (Object.prototype.hasOwnProperty.call(freshForks.value, threadId)
      && resolveSelectionProvider(freshForks.value[threadId]!) !== resolveSelectionProvider(submissionContext.modelId)) {
      const draftId = threadId
      if (configuringForks.has(draftId)) throw new Error('The fork is being configured. Wait before sending again.')
      configuringForks.add(draftId)
      try {
        const configured = await configureFreshFork(draftId, submissionContext.modelId)
        if (generation !== lifecycleGeneration) throw new Error('Conversation changed while configuring fork; send again.')
        const draft = flattenThreads(sourceGroups.value).find(row => row.id === draftId)
        threadId = configured.threadId
        replacementThreadIds.set(draftId, threadId)
        insertOptimisticThread(threadId, draft?.cwd || '', draft?.title || 'Forked chat')
        setPersistedMessagesForThread(threadId, persistedMessagesByThreadId.value[draftId] || [])
        setThreadModelId(threadId, configured.model, configured.modelProvider)
        explicitModelContexts.add(threadId)
        markFreshFork(threadId, submissionContext.modelId)
        resumedThreadById.value = { ...resumedThreadById.value, [threadId]: true }
        if (selectedThreadId.value === draftId) setSelectedThreadId(threadId)
        // Keep the draft recoverable until a new turn is actually accepted.
        supersededForkDrafts.set(threadId, draftId)
      } catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure)
        setTurnErrorForThread(draftId, error.value)
        throw failure
      } finally {
        configuringForks.delete(draftId)
      }
    }

    const submittedMode = collaborationModeOverride ?? selectedCollaborationMode.value
    if (await maybeReplyToPendingUserInputRequest(threadId, nextText, imageUrls, skills, fileAttachments)) {
      return
    }

    if (generation !== lifecycleGeneration) {
      await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, submittedMode, undefined, submissionContext)
      return
    }
    const isInProgress = inProgressById.value[threadId] === true

    const optimisticMessageId = appendOptimisticUserMessage(threadId, nextText, imageUrls, skills, fileAttachments)

    if (isInProgress) {
      void startTurnForThread(
        threadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        submittedMode,
        optimisticMessageId,
        submissionContext,
      ).catch((unknownError) => {
        if (generation !== lifecycleGeneration) return
        const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        setTurnErrorForThread(threadId, errorMessage)
        error.value = errorMessage
      })
      return
    }

    error.value = ''
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(
      threadId,
      {
        label: 'Thinking',
        details: buildPendingTurnDetails(
          readModelIdForThread(threadId),
          selectedReasoningEffort.value,
          collaborationModeOverride === 'plan'
            ? 'plan'
            : collaborationModeOverride === 'default'
              ? 'default'
              : selectedCollaborationMode.value,
        ),
      },
    )
    setTurnErrorForThread(threadId, null)
    setThreadInProgress(threadId, true)

    try {
      await startTurnForThread(
        threadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        submittedMode,
        optimisticMessageId,
        submissionContext,
      )
    } catch (unknownError) {
      if (generation !== lifecycleGeneration) throw unknownError
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      clearPendingTurnRequest(threadId)
      if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      throw unknownError
    }
  }

  async function sendMessageToNewThread(
    text: string,
    cwd: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<string> {
    const generation = lifecycleGeneration
    if (isUpdatingSpeedMode.value) return ''

    const nextText = text.trim()
    const targetCwd = cwd.trim()
    if (!targetCwd) {
      error.value = 'Select an existing workspace before starting a conversation.'
      return ''
    }
    const selectedModel = readModelIdForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT).trim()
    const reasoningEffort = readReasoningEffortForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT)
    const selectedMode = selectedCollaborationMode.value
    if (!nextText && imageUrls.length === 0 && fileAttachments.length === 0) return ''

    isSendingMessage.value = true
    error.value = ''
    let threadId = ''

    try {
      const selection = parseModelSelection(selectedModel)
      const startedThread = selection.provider
        ? await startThread(targetCwd, selection.model || undefined, selection.provider)
        : await startThread(targetCwd, selection.model || undefined)
      threadId = startedThread.threadId
      const submissionModel = modelSelectionKey(startedThread.modelProvider || parseModelSelection(selectedModel).provider, startedThread.model?.trim() || parseModelSelection(selectedModel).model)
      const submissionContext = { generation, modelId: submissionModel, reasoningEffort, resumed: true }
      if (generation !== lifecycleGeneration) {
        if (threadId) {
          void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, selectedMode, undefined, submissionContext).catch(() => {
            // The server submission continues, but this lifecycle no longer owns UI errors.
          })
        }
        return threadId
      }
      setThreadModelId(threadId, submissionModel)
      setSelectedCollaborationModeForThread(threadId, selectedMode)
      if (!threadId) return ''

      insertOptimisticThread(threadId, targetCwd, nextText || '[Image]')
      const optimisticMessageId = appendOptimisticUserMessage(threadId, nextText, imageUrls, skills, fileAttachments)
      blockInterruptUntilThreadIsPersisted(threadId)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      setSelectedThreadId(threadId)
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(
        threadId,
        {
          label: 'Thinking',
          details: buildPendingTurnDetails(
            readModelIdForThread(threadId),
            selectedReasoningEffort.value,
            selectedMode,
          ),
        },
      )
      setTurnErrorForThread(threadId, null)
      setThreadInProgress(threadId, true)
      void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, selectedMode, optimisticMessageId, submissionContext)
        .catch((unknownError) => {
          if (generation !== lifecycleGeneration) return
          setThreadInProgress(threadId, false)
          setTurnActivityForThread(threadId, null)
          clearPendingTurnRequest(threadId)
          if (activeTurnIdByThreadId.value[threadId]) {
            activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
          }
          const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
          setTurnErrorForThread(threadId, errorMessage)
          error.value = errorMessage
        })
        .finally(() => {
          if (generation === lifecycleGeneration) isSendingMessage.value = false
        })
      return threadId
    } catch (unknownError) {
      if (generation !== lifecycleGeneration) throw unknownError
      if (threadId) {
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (threadId) {
        setTurnErrorForThread(threadId, errorMessage)
      }
      error.value = errorMessage
      isSendingMessage.value = false
      throw unknownError
    }
  }

  async function startTurnForThread(
    threadId: string,
    nextText: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    collaborationModeOverride?: CollaborationModeKind,
    optimisticMessageId?: string,
    context: { generation: number; modelId: string; reasoningEffort: ReasoningEffort | ''; resumed?: boolean } = {
      generation: lifecycleGeneration,
      modelId: readModelIdForThread(threadId),
      reasoningEffort: selectedReasoningEffort.value,
    },
  ): Promise<void> {
    const generation = context.generation
    if (generation === lifecycleGeneration) realtimeRevisionByThreadId.set(threadId, (realtimeRevisionByThreadId.get(threadId) ?? 0) + 1)
    const collaborationMode = collaborationModeOverride === 'plan' ? 'plan' : collaborationModeOverride === 'default'
      ? 'default'
      : selectedCollaborationMode.value
    const normalizedText = nextText.trim()
    const normalizedImageUrls = [...imageUrls]
    if (
      normalizedImageUrls.length === 0
      && shouldReuseAttachedImageFromPrompt(normalizedText)
    ) {
      const latestAttachedImageUrl = findLatestUserLocalImageUrl(threadId)
      if (latestAttachedImageUrl) {
        normalizedImageUrls.push(latestAttachedImageUrl)
      }
    }
    const normalizedSkills = skills.map((skill) => ({ name: skill.name, path: skill.path }))
    const normalizedFileAttachments = fileAttachments.map((file) => ({ ...file }))

    if (generation === lifecycleGeneration) setPendingTurnRequest(threadId, {
      text: normalizedText,
      imageUrls: [...normalizedImageUrls],
      skills: normalizedSkills,
      fileAttachments: normalizedFileAttachments,
      effort: context.reasoningEffort,
      collaborationMode,
    })

    const freshForkDefault = freshForks.value[threadId]
    let submissionAttempted = false
    let submissionAccepted = false
    try {
      let modelId = context.modelId
      if (!context.resumed && resumedThreadById.value[threadId] !== true) {
        const resumedThread = await resumeThread(threadId)
        if (generation === lifecycleGeneration) {
          if (resumedThread.model || resumedThread.modelProvider) {
            setThreadModelId(threadId, resumedThread.model, resumedThread.modelProvider)
          }
          resumedThreadById.value = {
            ...resumedThreadById.value,
            [threadId]: true,
          }
        }
      }
      if (generation === lifecycleGeneration) modelId = readModelIdForThread(threadId)
      const reasoningEffort = modelId === context.modelId ? context.reasoningEffort : readReasoningEffortForThread(threadId)

      // Submit exactly once even if disposal occurred while resuming the server thread.
      if (generation === lifecycleGeneration) recordModelUsage(modelId)
      submissionAttempted = true
      markFreshFork(threadId, null)
      const startedTurnId = await startThreadTurn(
        threadId,
        nextText,
        normalizedImageUrls,
        modelId || undefined,
        reasoningEffort || undefined,
        skills.length > 0 ? skills : undefined,
        fileAttachments,
        collaborationMode,
        (turnId, metadata) => {
          if (generation !== lifecycleGeneration || !metadata) return
          retainGenerationMetadata(threadId, turnId, metadata)
        },
      )

      submissionAccepted = true
      const supersededDraft = supersededForkDrafts.get(threadId)
      if (supersededDraft) {
        supersededForkDrafts.delete(threadId)
        markFreshFork(supersededDraft, null)
        void archiveThread(supersededDraft).then(() => {
          if (generation === lifecycleGeneration) removeArchivedThreadFromLoadedLists(supersededDraft)
        }).catch(() => { /* Retain a recoverable draft if archive fails. */ })
      }
      if (generation !== lifecycleGeneration) return
      if (startedTurnId) {
        if (optimisticMessageId) {
          const messages = persistedMessagesByThreadId.value[threadId] ?? []
          setPersistedMessagesForThread(threadId, messages.map((message) => message.id === optimisticMessageId
            ? { ...message, turnId: startedTurnId }
            : message))
        }
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: startedTurnId,
        }
        maybeUnblockInterruptForActiveTurn(threadId, startedTurnId)
      }

      pendingThreadMessageRefresh.add(threadId)
      await syncFromNotifications()
      if (generation === lifecycleGeneration) scheduleDelayedTurnSync(threadId)
    } catch (unknownError) {
      const ambiguous = unknownError instanceof Error && /disconnected|outcome unknown/i.test(unknownError.message)
        || unknownError instanceof CodexApiError && (['network_error', 'invalid_response'].includes(unknownError.code) || (unknownError.status ?? 0) >= 500)
      if (!submissionAccepted && !ambiguous && freshForkDefault !== undefined) {
        markFreshFork(threadId, freshForkDefault)
      }
      if (submissionAttempted && !submissionAccepted && ambiguous) {
        unknownOutcomeByThreadId.value = { ...unknownOutcomeByThreadId.value, [threadId]: true }
      }
      throw unknownError
    }
  }

  async function interruptSelectedThreadTurn(): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (inProgressById.value[threadId] !== true) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] === true) return
    let turnId = activeTurnIdByThreadId.value[threadId]
    if (!turnId) {
      const { activeTurnId } = await getThreadDetail(threadId)
      turnId = activeTurnId
      if (turnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: turnId,
        }
      }
    }
    if (!turnId) {
      throw new Error('Could not determine active turn id for interrupt')
    }

    isInterruptingTurn.value = true
    error.value = ''
    try {
      await interruptThreadTurn(threadId, turnId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
    } finally {
      isInterruptingTurn.value = false
    }
  }

  async function rollbackSelectedThread(turnId: string): Promise<string> {
    return executeThreadRevert(selectedThreadId.value, turnId, 'revert')
  }

  async function executeThreadRevert(sourceThreadId: string, turnId: string, operation: 'revert' | 'fork-and-revert'): Promise<string> {
    let threadId = sourceThreadId
    if (!threadId) return ''
    if (isRollingBack.value) return ''
    if (!turnId.trim()) return ''

    if (inProgressById.value[threadId]) return ''

    isRollingBack.value = true
    error.value = ''
    const threadCwd = flattenThreads(sourceGroups.value).find(row => row.id === sourceThreadId)?.cwd?.trim() ?? ''
    const originalSelection = selectedThreadId.value
    const originalSelectionGeneration = selectionGeneration
    let stage = 'Validate original target'
    let historyReverted = false
    try {
      await validateThreadRevert(threadId, turnId)
      if (operation === 'fork-and-revert') {
        stage = 'Fork conversation'
        const forked = await forkThread(sourceThreadId, threadCwd || undefined, readModelIdForThread(sourceThreadId) || undefined)
        threadId = forked.threadId.trim()
        if (!threadId || threadId === sourceThreadId) throw new Error('Invalid fork destination')
        insertOptimisticThread(threadId, threadCwd, 'Forked chat')
        setThreadModelId(threadId, forked.model, forked.modelProvider)
        markFreshFork(threadId, readModelIdForThread(threadId))
        stage = 'Validate fork target'
        await validateThreadRevert(threadId, turnId)
      }
      invalidateThreadHistory(threadId)
      stage = 'Undo history'
      await revertThreadHistory(threadId, turnId)
      historyReverted = true
      invalidateThreadHistory(threadId)
      setLiveAgentMessagesForThread(threadId, [])
      clearLiveReasoningForThread(threadId)
      if (liveCommandsByThreadId.value[threadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
      }
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      stage = 'Refresh destination'
      const owner = historyReadOwner(threadId)
      const detail = await getThreadDetail(threadId)
      if (historyReadOwnerByThreadId.get(threadId) !== owner) return ''
      setPersistedMessagesForThread(threadId, detail.messages)
      turnIndexByTurnIdByThreadId.value = { ...turnIndexByTurnIdByThreadId.value, [threadId]: detail.turnIndexByTurnId }
      hasMoreOlderMessagesByThreadId.value = { ...hasMoreOlderMessagesByThreadId.value, [threadId]: detail.hasMoreOlder }
      loadedMessagesByThreadId.value = { ...loadedMessagesByThreadId.value, [threadId]: true }
      if (operation === 'fork-and-revert' && selectionGeneration === originalSelectionGeneration && selectedThreadId.value === originalSelection && originalSelection === sourceThreadId) {
        setSelectedThreadId(threadId)
      }
      if (operation === 'revert') {
        pendingThreadsRefresh = true
        await syncFromNotifications()
      }
      return threadId
    } catch (unknownError) {
      const reason = stage + ': ' + (unknownError instanceof Error ? unknownError.message : 'Failed to revert thread')
        + (threadId !== sourceThreadId ? ' Fork retained: ' + threadId + '.' : '')
      invalidateThreadHistory(threadId)
      error.value = historyReverted
        ? 'History reverted, but refresh failed. Reload the thread; do not repeat the edit. ' + reason
        : reason
      return ''
    } finally {
      isRollingBack.value = false
    }
  }

  async function removeProject(projectName: string): Promise<void> {
    if (!projectName) return
    const path = getWorkspaceProjectId(loadedThreadListRootsState, projectName, sourceGroups.value)
    const isRegisteredLocalRoot = Boolean(path && loadedThreadListRootsState?.order.includes(path))
    await queueProjectOperation(async () => {
      if (isRegisteredLocalRoot) {
        const state = await updateWorkspaceRootsState({ type: 'delete', path })
        applyWorkspaceRootsState(state)
      } else {
        sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)
        projectDisplayNameById.value = omitKey(projectDisplayNameById.value, projectName)
        applyThreadFlags()
      }
      const threads = flattenThreads(projectGroups.value)
      pruneThreadScopedState(threads)
      if (!threads.some((thread) => thread.id === selectedThreadId.value)) {
        setSelectedThreadId(threads[0]?.id ?? '')
      }
    })
  }

  async function syncFromNotifications(): Promise<void> {
    const generation = lifecycleGeneration
    const syncGeneration = eventSyncGeneration
    const isCurrent = () => generation === lifecycleGeneration && syncGeneration === eventSyncGeneration
    if (isPolling.value) {
      if (typeof window !== 'undefined' && eventSyncTimer === null) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
      return
    }

    isPolling.value = true

    const shouldRefreshThreads = pendingThreadsRefresh
    const shouldForceThreadRefresh = pendingThreadsRefreshForce
    const threadIdsToRefresh = new Set(pendingThreadMessageRefresh)
    pendingThreadsRefresh = false
    pendingThreadsRefreshForce = false
    pendingThreadMessageRefresh.clear()

    try {
      if (shouldRefreshThreads) {
        await loadThreads({ force: shouldForceThreadRefresh })
      }

      if (!isCurrent()) return
      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) return

      const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
      const isInProgress = inProgressById.value[activeThreadId] === true
      const currentVersion = currentThreadVersion(activeThreadId)
      const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

      const shouldRefreshActiveThread =
        hasVersionChange ||
        isActiveDirty ||
        (isInProgress && loadedMessagesByThreadId.value[activeThreadId] !== true) ||
        (shouldRefreshThreads && loadedMessagesByThreadId.value[activeThreadId] !== true)

      if (shouldRefreshActiveThread) {
        await loadMessages(activeThreadId, { silent: true, force: isActiveDirty })
      }
    } catch {
      // Keep UI stable on transient event sync failures.
    } finally {
      if (isCurrent()) {
        isPolling.value = false

        if (
          (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) &&
          typeof window !== 'undefined' &&
          eventSyncTimer === null
        ) {
          eventSyncTimer = window.setTimeout(() => {
            eventSyncTimer = null
            void syncFromNotifications()
          }, EVENT_SYNC_DEBOUNCE_MS)
        }
      }
    }
  }

  function invalidateDisconnectedReads(): void {
    // A fetch started before suspension may never settle. Detach read ownership
    // without clearing visible messages, pagination boundaries, or pending sends.
    ++eventSyncGeneration
    isPolling.value = false
    pendingThreadsRefresh = false
    pendingThreadsRefreshForce = false
    pendingThreadMessageRefresh.clear()
    if (eventSyncTimer !== null) {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
    ++threadListLoadGeneration
    invalidateThreadListGeneration()
    loadThreadsPromise = null
    pendingForcedThreadLoad = false
    for (const [threadId, owner] of historyReadOwnerByThreadId) {
      historyReadOwnerByThreadId.set(threadId, { ...owner })
      reconnectingThreadHistory.add(threadId)
    }
    loadMessagePromiseByThreadId.clear()
    visibleMessageLoads.clear()
    loadingOlderMessagesByThreadId.value = {}
    syncMessageLoading()
    // Other conversations refresh when opened; do not fetch all cached histories.
    loadedMessagesByThreadId.value = {}
    loadedVersionByThreadId.value = {}
    lastMessageLoadAtByThreadId.clear()
    lastMessageLoadFailureAtByThreadId.clear()
  }

  async function recoverBridgeState(reconnected: boolean, backendReplaced = false): Promise<void> {
    // Approval/sidebar requests must not hold the conversation recovery hostage.
    void loadPendingServerRequestsFromBridge()
    if (reconnected) {
      invalidateDisconnectedReads()
      const threadId = selectedThreadId.value
      // Backend owns retry timing and concurrency. A replacement backend needs
      // registration only; the same scheduler handles those manual requests.
      if (backendReplaced) {
        for (const id of Object.keys(inProgressById.value)) {
          if (id !== threadId && inProgressById.value[id]) void Promise.resolve(resumeThreadSubscription(id)).catch(() => {})
        }
      }
      await Promise.allSettled([
        loadThreads({ force: true }),
        ...(threadId ? [loadMessages(threadId, { silent: true, force: true })] : []),
      ])
      return
    }
    pendingThreadsRefresh ||= !hasLoadedThreads.value
    if (
      selectedThreadId.value &&
      (loadedMessagesByThreadId.value[selectedThreadId.value] !== true ||
        inProgressById.value[selectedThreadId.value] === true)
    ) {
      pendingThreadMessageRefresh.add(selectedThreadId.value)
    }
    await syncFromNotifications()
  }

  function startPolling(): void {
    ensureCatalogOwnership()
    const generation = lifecycleGeneration
    if (typeof window === 'undefined') return

    if (stopNotificationStream) return
    let receivedReady = false
    void loadPendingServerRequestsFromBridge()
    stopNotificationStream = subscribeCodexNotifications((notification) => {
      if (generation !== lifecycleGeneration) return
      if (notification.method === 'ready') {
        if (reloadForConnectionProfile(readString(asRecord(notification.params)?.connectionProfile))) return
        const instanceId = readString(asRecord(notification.params)?.backendInstanceId)
        // Hydration can precede the first ready. An unknown instance must also
        // establish subscriptions, rather than trusting browser-only resume flags.
        const backendReplaced = Boolean(instanceId && instanceId !== backendInstanceId)
        if (backendReplaced) {
          backendInstanceId = instanceId
          for (const id of new Set([
            ...Object.keys(resumedThreadById.value), ...loadMessagePromiseByThreadId.keys(), selectedThreadId.value,
          ])) if (id) invalidateResumeThread(id)
          resumedThreadById.value = {}
        }
        const reconnected = backendReplaced || receivedReady || asRecord(notification.params)?.reconnected === true
        receivedReady = true
        void recoverBridgeState(reconnected, backendReplaced)
        return
      }
      applyRealtimeUpdates(notification)
      queueEventDrivenSync(notification)
    })
  }

  async function loadPendingServerRequestsFromBridge(): Promise<void> {
    const generation = lifecycleGeneration
    const version = ++pendingServerRequestsVersion
    try {
      const rows = await getPendingServerRequests()
      if (generation !== lifecycleGeneration || version !== pendingServerRequestsVersion) return
      const normalizedRequests = rows
        .map((row) => normalizeServerRequest(row))
        .filter((request): request is UiServerRequest => request !== null)
      replacePendingServerRequests(normalizedRequests)
    } catch {
      // Keep UI usable when pending request endpoint is temporarily unavailable.
    }
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<boolean> {
    const generation = lifecycleGeneration
    try {
      await replyToServerRequest(reply.id, {
        result: reply.result,
        error: reply.error,
      })
      if (generation === lifecycleGeneration) removePendingServerRequestById(reply.id)
      return true
    } catch (unknownError) {
      if (generation !== lifecycleGeneration) return false
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request'
      return false
    }
  }

  function stopPolling(): void {
    for (const timer of recoveryDismissTimerByThreadId.values()) clearTimeout(timer)
    recoveryDismissTimerByThreadId.clear()
    ++lifecycleGeneration
    ++eventSyncGeneration
    ++threadListLoadGeneration
    loadThreadsPromise = null
    isLoadingThreads.value = false
    loadMessagePromiseByThreadId.clear()
    historyReadOwnerByThreadId.clear()
    visibleMessageLoads.clear()
    refreshSkillsPromiseByDirectory.clear()
    rateLimitRefreshPromise = null
    isLoadingMessages.value = false
    loadingOlderMessagesByThreadId.value = {}
    isSendingMessage.value = false
    isPolling.value = false
    localThreadConfirmationDeadlineById.clear()
    scheduleLocalThreadReconciliation()
    invalidateThreadListGeneration()
    pendingForcedThreadLoad = false
    ++modelRefreshVersion
    ensureCatalogOwnership().release()
    catalogOwnership = null
    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }

    pendingThreadsRefresh = false
    pendingThreadsRefreshForce = false
    pendingThreadMessageRefresh.clear()
    pendingTurnStartsById.clear()
    if (eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
    if (rateLimitRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(rateLimitRefreshTimer)
      rateLimitRefreshTimer = null
    }
    if (threadListBackgroundTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(threadListBackgroundTimer)
      threadListBackgroundTimer = null
    }
    if (typeof window !== 'undefined') {
      for (const timerId of delayedTurnSyncTimerByThreadId.values()) {
        window.clearTimeout(timerId)
      }
    }
    delayedTurnSyncTimerByThreadId.clear()
    activeReasoningItemId = ''
    // Invalidate history cache metadata together with the cleared message payload.
    // Keep resume state, which tracks server sessions rather than cached payloads.
    loadedMessagesByThreadId.value = {}
    reconnectingThreadHistory.clear()
    loadedVersionByThreadId.value = {}
    hasMoreOlderMessagesByThreadId.value = {}
    lastMessageLoadAtByThreadId.clear()
    lastMessageLoadFailureAtByThreadId.clear()
    persistedMessagesByThreadId.value = {}
    livePlanMessagesByThreadId.value = {}
    liveAgentMessagesByThreadId.value = {}
    liveReasoningTextByThreadId.value = {}
    liveCommandsByThreadId.value = {}
    liveFileChangeMessagesByThreadId.value = {}
    turnIndexByTurnIdByThreadId.value = {}
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    activeTurnIdByThreadId.value = {}
    generationMetadataByThreadId.value = {}
    interruptBlockedUntilPersistedByThreadId.value = {}
    threadListedByServerById.value = {}
    persistedUserMessageByThreadId.value = {}
    codexRateLimit.value = null
    threadTokenUsageByThreadId.value = {}
  }

  function primeSelectedThread(threadId: string, options: { persist?: boolean } = {}): void {
    setSelectedThreadId(threadId, options)
  }

  async function retrySelectedSubscription(): Promise<void> {
    const id = selectedThreadId.value
    if (!id) return
    invalidateResumeThread(id)
    try { await resumeThreadSubscription(id); await loadMessages(id, { force: true }) }
    catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure) }
  }
  async function reconcileSelectedHistory(): Promise<void> {
    const id = selectedThreadId.value
    if (!id) return
    // A snapshot alone cannot prove an ambiguously accepted submission failed.
    await loadMessages(id, { force: true })
  }

  return {
    modelSelectionNotice, resolveThreadReplacement,
    transportState, selectedRecoveryState, selectedUnknownOutcome, selectedLostApproval,
    retrySelectedSubscription, reconcileSelectedHistory,
    projectGroups,
    projectDisplayNameById,
    selectedThread,
    selectedThreadTokenUsage,
    isSelectedThreadInterruptPending,
    selectedThreadServerRequests,
    selectedLiveOverlay,
    codexQuota,
    selectedThreadId,
    availableCollaborationModes,
    availableModelIds: orderedModelIds,
    selectedCollaborationMode,
    selectedModelId,
    selectedReasoningEffort,
    availableReasoningEfforts,
    selectedSpeedMode,
    codexCliMissingError,
    installedSkills,
    accountRateLimitSnapshots,
    messages,
    hasMoreOlderMessages,
    isLoadingThreads,
    isThreadListFullyLoaded,
    isLoadingMessages,
    isLoadingOlderMessages,
    isSendingMessage,
    isInterruptingTurn,
    isUpdatingSpeedMode,
    isRollingBack,

    error,
    refreshAll,
    refreshWorkspaceRoots,
    refreshSkills,
    selectThread,
    loadMessages,
    loadOlderMessages,
    ensureThreadMessagesLoaded,
    archiveThreadById,
    renameThreadById,
    forkThreadById,
    forkThreadFromTurn,
    rollbackSelectedThread,
    executeThreadRevert,

    sendMessageToSelectedThread,
    sendMessageToNewThread,
    interruptSelectedThreadTurn,
    setSelectedCollaborationMode,
    readModelIdForThread,
    readReasoningEffortForThread,
    readReasoningOptionsForThread,
    setSelectedModelIdForThread,
    setSelectedModelId,

    setSelectedReasoningEffort,
    updateSelectedSpeedMode,
    respondToPendingServerRequest,
    removeProject,
    startPolling,
    stopPolling,
    primeSelectedThread,
  }
}
