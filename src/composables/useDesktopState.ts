import { persistDraftForThread } from '../utils/composerDraftStorage'
import { profileStorageKey } from '../utils/browserConnectionProfile'
import { readPreferenceRecord, readPreferenceRecords, savePreferenceRecords } from '../utils/browserPreferenceRecords'
import { createBackendModelPreferences } from './backendModelPreferences'
import { preferenceModelKey, type ModelPreferences, type ModelSettings } from '../modelPreferences'
import { createLiveItemOrder } from './liveItemOrder'
import { createThreadReview } from './threadReview'
import { createThreadCompaction } from './threadCompaction'
import {createThreadSecurityObservation} from './threadSecurityObservation'
import {createDeniedActionObservation} from './deniedActionObservation'
import {createNativeQueue} from './nativeQueue'
import {createThreadPermissions} from './threadPermissions'
import {createBackendAuthentication} from './backendAuthentication'
import {rpcCall} from '../api/codexRpcClient'
import { normalizeExecutionItem, executionText } from '../api/normalizers/executionDetails'
import { appendDiagnosticWarning, type DiagnosticWarning } from '../diagnostics'
import { createDesktopConnection } from './desktopConnection'
import { createConnectionNotice } from './connectionNotice'
import { createDesktopTurns } from './desktopTurns'
import { createDesktopHistory } from './desktopHistory'
import { createDesktopApprovals } from './desktopApprovals'
import { pruneThreadStateMap, removeThreadFromGroups, mergeThreadGroups, mergeIncomingWithLocalThreads } from './threadListReconciliation'
export { removeThreadFromGroups } from './threadListReconciliation'

import { fastModeAvailability, modelSelectionKey, parseModelSelection, defaultModelForProvider } from '../api/modelCapabilities'
import { interruptThreadTurn, markNativeThreadRead, refreshThreadGenerationMetadata } from '../api/codexGateway'
import { orderModelIdsByUsage, buildModelCatalogIds, resolveModelPreference } from '../utils/desktopModelPreferences'
import { groupThreadsByProject, UNASSIGNED_PROJECT } from '../utils/desktopProjectGroups'
import type { Project } from '../server/protocol/0.167.2/v2/Project'
import { clientMessageId } from '../utils/clientMessageId'
import { readPlanUpdate, asRecord, readString, readNumber, readThreadTokenUsageUpdate, extractThreadIdFromNotification, readTurnErrorMessage, readNotificationErrorState, readTurnActivity, liveReasoningMessageId, readReasoningStartedItemId, readReasoningDelta, readReasoningSectionBreakMessageId, readReasoningCompletedId, readAgentMessageStartedId, readAgentMessageDelta, readAgentMessageCompleted, readCompletedImageView, readCommandOutputDelta, isAgentContentEvent, type TurnActivityState } from './desktopNotificationReaders'
import { NEW_THREAD_MODEL_CONTEXT, normalizeStoredModelId, createStringKeyedRecord, cloneStringKeyedRecord, omitStringKeyedRecordKey, pruneThreadContextStateMap, isNewThreadContextId, toThreadContextId, loadSelectedModelMap, readSelectedModel, saveSelectedModelMap, loadSelectedCollaborationModeMap, readSelectedCollaborationMode, writeSelectedCollaborationModeForContext, saveSelectedCollaborationModeMap } from './desktopStatePersistence'
import { areStringArraysEqual, areMessageArraysEqual, normalizeMessageText, isOptimisticUserMessage, upsertMessage } from '../utils/desktopMessageReconciliation'
import { computed, ref, shallowRef, watch } from 'vue'
import { formatTurnDuration, parseIsoTimestamp } from '../utils/turnTiming'
import { createConversationTransfer, unarchiveThread, archiveThread, forkThread, forkThreadFromResponse, getAvailableCollaborationModes, getAccountRateLimits, renameThread, getAvailableModelIds, acquireReasoningCatalog, reasoningCatalog, reasoningOptions, resolveReasoningEffort, findReasoningModel, getCurrentModelConfig, getSkillsList, getBackgroundThreadListLimit, pickCodexRateLimitSnapshot, revertThreadHistory, validateThreadRevert, getThreadDetailForRevert, invalidateResumeThread, resumeThreadSubscription, getThreadGroupsPage, getProjects, setCodexSpeedMode, type RpcNotification, type SkillInfo } from '../api/codexGateway'
import { CodexApiError } from '../api/codexErrors'
import { normalizeFileChangeStatus, toUiFileChanges } from '../api/normalizers/v2'
import { readGenerationMetadata, mergeGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata'
import type { CollaborationModeKind, CollaborationModeOption, CommandExecutionData, ReasoningEffort, SpeedMode, UiLiveOverlay, UiMessage, UiPlanData, UiProjectGroup, UiRateLimitSnapshot, UiServerRequest, UiThreadTokenUsage, UiThread } from '../types/codex'
import { isAbsoluteLikePath, normalizePathForUi, toProjectName } from '../pathUtils.js'

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

export function findAdjacentThreadId(threads: UiThread[], threadId: string): string {
  const targetIndex = threads.findIndex((thread) => thread.id === threadId)
  if (targetIndex < 0) return ''
  return threads[targetIndex + 1]?.id ?? threads[targetIndex - 1]?.id ?? ''
}

const BACKGROUND_THREAD_PAGINATION_DELAY_MS = 10_000
const RATE_LIMIT_REFRESH_DEBOUNCE_MS = 500
const TURN_START_FOLLOW_UP_SYNC_DELAY_MS = 3000
const RECENT_THREAD_LIST_LOAD_REUSE_MS = 2000
const LOCAL_THREAD_CONFIRMATION_GRACE_MS = 120_000
const LOCAL_THREAD_RECONCILIATION_INTERVAL_MS = 5000
const RECENT_SKILLS_LOAD_REUSE_MS = 2000
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
type SelectThreadResult = 'ok' | 'not-found' | 'error'

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
  const selectedThreadId = ref('')
  const securityObservation = createThreadSecurityObservation()
  const deniedActions = createDeniedActionObservation()
  const history = createDesktopHistory({
    securityObservation,
    get selectedThreadId() { return selectedThreadId; },
    get turnIndexByTurnIdByThreadId() { return turnIndexByTurnIdByThreadId; },
    get lifecycleGeneration() { return connection.lifecycleGeneration; }, set lifecycleGeneration(value) { connection.lifecycleGeneration = value; },
    get turnErrorByThreadId() { return turnErrorByThreadId; },
    get currentThreadVersion() { return currentThreadVersion; },
    get sourceGroups() { return sourceGroups; },
    get inProgressById() { return inProgressById; },
    get resumedThreadById() { return resumedThreadById; },
    get markThreadAsRead() { return markThreadAsRead; },
    get realtimeRevisionByThreadId() { return realtimeRevisionByThreadId; },
    get applyThreadFlags() { return applyThreadFlags; },
    get activeTurnIdByThreadId() { return activeTurnIdByThreadId; },
    get pendingTurnRequestByThreadId() { return turns.pendingTurnRequestByThreadId; },
    get setThreadModelId() { return setThreadModelId; },
    get markThreadMessagesPersisted() { return markThreadMessagesPersisted; },
    get replaceTurnIndexLookupForThread() { return replaceTurnIndexLookupForThread; },
    get rebindLiveFileChangeTurnIndices() { return rebindLiveFileChangeTurnIndices; },
    get setPersistedMessagesForThread() { return setPersistedMessagesForThread; },
    get liveAgentMessagesByThreadId() { return liveAgentMessagesByThreadId; },
    get setLiveAgentMessagesForThread() { return setLiveAgentMessagesForThread; },
    get removeLiveCommandsPersistedIn() { return removeLiveCommandsPersistedIn; },
    get removeLiveFileChangesPersistedIn() { return removeLiveFileChangesPersistedIn; },
    get error() { return error; },
    get connectionErrorMessage() { return connectionErrorMessage; },
    get setThreadInProgress() { return setThreadInProgress; },
    get clearTransientTurnErrorForThread() { return clearTransientTurnErrorForThread; },
    get clearCompletedTurnLiveState() { return clearCompletedTurnLiveState; },
    get setTurnErrorForThread() { return setTurnErrorForThread; }
  })
  const liveItemOrder = createLiveItemOrder()
  const livePlanMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveAgentMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveReasoningTextByThreadId = ref<Record<string, string>>({})
  const liveCommandsByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveFileChangeMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const inProgressById = ref<Record<string, boolean>>({})
  type FileAttachment = { label: string; path: string; fsPath: string }
  const availableModelIds = ref<string[]>([])
  const catalogModelIds = ref<string[] | null>(null)
  const modelUsageOrder = ref<string[]>([])
  const orderedModelIds = computed(() => orderModelIdsByUsage(availableModelIds.value, modelUsageOrder.value))
  const availableCollaborationModes = ref<CollaborationModeOption[]>([
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan' },
  ])
  const storedModelMap = loadSelectedModelMap()
  const storedCollaborationMap = loadSelectedCollaborationModeMap()
  const selectedCollaborationModeByContext = ref<Record<string, CollaborationModeKind>>(
    Object.fromEntries(Object.entries(storedCollaborationMap).filter(([key]) => key !== '__new-thread__')),
  )
  const selectedModelIdByContext = ref<Record<string, string>>(Object.fromEntries(
    Object.entries(storedModelMap).filter(([key]) => !key.startsWith('__new-thread')),
  ))
  const selectedCollaborationMode = ref<CollaborationModeKind>(
    readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value),
  )
  const reasoningByModel = ref(createStringKeyedRecord<string>())
  // Automatic catalog fallbacks affect the display, never the saved user choice.
  const automaticModelByContext = ref(createStringKeyedRecord<string>())
  let newThreadEffortEdited = false
  let newThreadModelEdited = false
  let newThreadModeEdited = false
  const backendPreferences = createBackendModelPreferences(applyBackendPreferences)

  function applyBackendPreferences(state: ModelPreferences): void {
    reasoningByModel.value = { ...state.reasoningByModel }
    modelUsageOrder.value = Object.values(state.modelUsage)
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .map(entry => modelSelectionKey(entry.providerId, entry.modelId))
    const defaults = state.lastUsed || state.preferred
    if (defaults && !newThreadModelEdited) {
      const saved = modelSelectionKey(defaults.providerId, defaults.modelId)
      selectedModelIdByContext.value[NEW_THREAD_MODEL_CONTEXT] = saved
      automaticModelByContext.value = omitStringKeyedRecordKey(automaticModelByContext.value, NEW_THREAD_MODEL_CONTEXT)
      if (catalogModelIds.value?.length) automaticModelByContext.value[NEW_THREAD_MODEL_CONTEXT] = resolveModelPreference(catalogModelIds.value, saved, '')
    }
    if (defaults && !newThreadModeEdited) {
      // Last-used mode describes the accepted turn, not the next composer.
      const mode = state.preferred?.collaborationMode ?? 'default'
      selectedCollaborationModeByContext.value['__new-thread__'] = mode
      if (!selectedThreadId.value) selectedCollaborationMode.value = mode
    }
  }

  function restoreNewConversationPreferences(): void {
    newThreadModelEdited = false
    newThreadModeEdited = false
    newThreadEffortEdited = false
    applyBackendPreferences(backendPreferences.state.value)
  }

  let savedThreadModelMap = storedModelMap
  let savedCollaborationMap = storedCollaborationMap
  function saveCollaborationMap(map: Record<string, CollaborationModeKind>): void {
    saveSelectedCollaborationModeMap(map, savedCollaborationMap)
    savedCollaborationMap = { ...map }
  }

  function saveThreadModelChoice(context: string, model: string): void {
    if (context.startsWith('__new-thread')) return // Backend owns global choices.
    const next = { ...savedThreadModelMap }
    if (model) next[context] = model
    else delete next[context]
    saveSelectedModelMap(next, savedThreadModelMap)
    savedThreadModelMap = next
  }

  function currentPreferenceSettings(threadId: string): ModelSettings | null {
    const model = readModelIdForThread(threadId)
    const selection = parseModelSelection(model)
    const provider = resolveSelectionProvider(model, effectiveThreadProviders.get(threadId))
    if (!provider || !selection.model) return null
    return { providerId: provider, modelId: selection.model, reasoningEffort: readReasoningEffortForThread(threadId),
      collaborationMode: readSelectedCollaborationMode(selectedCollaborationModeByContext.value, threadId) }
  }
  function saveGlobalChoice(threadId: string): void {
    const preferred = currentPreferenceSettings(threadId)
    if (preferred) void backendPreferences.update({ preferred })
  }
  const selectedReasoningEffort = computed(() => readReasoningEffortForThread(selectedThreadId.value))
  const selectedSpeedMode = ref<SpeedMode>('standard')
  const projects = shallowRef<Project[]>([])
  const projectDisplayNameById = computed(() => Object.fromEntries([
    [UNASSIGNED_PROJECT, 'Unassigned'],
    ...projects.value.map(project => [project.id, project.name]),
  ]))

  const diagnosticWarnings = ref<DiagnosticWarning[]>([])
  const operationEpoch = ref(0)
  const nativeShell=shallowRef<import('./nativeShell').NativeShell|null>(null)
  async function ensureNativeShell(){const epoch=operationEpoch.value,owner=connection.lifecycleGeneration,module=await import('./nativeShell');if(epoch!==operationEpoch.value||owner!==connection.lifecycleGeneration)return null
    if(!nativeShell.value)nativeShell.value=module.createNativeShell({epoch:operationEpoch,selected:selectedThreadId,ready:()=>transportState.value!=='disconnected',blocked:()=>nativeDeletion.value?.selectedBlocking.value||nativeAuthenticationBlocked.value||isRollingBack.value||inProgressById.value[selectedThreadId.value]===true||turns.isSendingMessage.value||compaction.busy.value||review.busy.value||nativeQueue.writing.value||permissionChanges.blocking.value||(approvals.pendingServerRequestsByThreadId.value[selectedThreadId.value]?.length??0)>0})
    return nativeShell.value
  }
  const nativeDeletion=shallowRef<import('./threadDeletion').ThreadDeletion|null>(null)
  async function ensureNativeDeletion(){const epoch=operationEpoch.value,owner=connection.lifecycleGeneration,module=await import('./threadDeletion');if(epoch!==operationEpoch.value||owner!==connection.lifecycleGeneration)return null
    if(!nativeDeletion.value)nativeDeletion.value=module.createThreadDeletion({epoch:operationEpoch,selected:selectedThreadId,ready:()=>transportState.value!=='disconnected',blocked:()=>nativeShell.value?.blocking.value||nativeAuthenticationBlocked.value||isRollingBack.value||inProgressById.value[selectedThreadId.value]===true||turns.isSendingMessage.value||compaction.busy.value||review.busy.value||nativeQueue.writing.value||permissionChanges.blocking.value||(approvals.pendingServerRequestsByThreadId.value[selectedThreadId.value]?.length??0)>0})
    return nativeDeletion.value
  }
  const backendAuthentication=createBackendAuthentication(()=>{
    operationEpoch.value++;modelRefreshVersion++;rateLimitRefreshPromise=null
    accountRateLimitSnapshots.value=[];setCodexRateLimit(null);availableModelIds.value=[]
    catalogOwnership?.release();catalogOwnership=null
  })
  const nativeAuthenticationBlocked=backendAuthentication.blocking
  const nativeAuthenticationStatus=computed(()=>backendAuthentication.state.value.reason==='account-context-changed'?'The native account or workspace changed. Inspect and acknowledge the new account before sending.':backendAuthentication.state.value.reason==='account-identity-unavailable'?'Native account continuity could not be established. Inspect and acknowledge the account before sending.':({
    checking:'Verifying native account state automatically. Sending will resume when verification succeeds.',
    ready:'',
    signedOut:'Native sign-in is required before sending.',
    pending:'Native authentication is pending. Sending is paused.',
    reconciliation:'Native account reconciliation is required. Sending is paused.',
    unknown:'Native authentication could not be verified. Inspect the account before sending.',
    disconnected:'Native authentication is unavailable while the connection is interrupted. Sending is paused.',
  })[backendAuthentication.state.value.phase])
  watch(backendAuthentication.state,(state,previous)=>{
    if(state.phase==='ready'&&previous.phase!=='ready'&&(state.contextRevision??0)>0){
      void refreshModelPreferences();void refreshRateLimits()
    }
  },{flush:'sync'})
  const nativeAccountChangeBlocked=computed(()=>nativeShell.value?.blocking.value||nativeDeletion.value?.blocking.value||hasActiveInProgressThreads()||turns.isSendingMessage.value||turns.isInterruptingTurn.value||isRollingBack.value||compaction.busy.value||review.busy.value||nativeQueue.writing.value||permissionChanges.busy.value||permissionChanges.state.value==='unknown'||Object.values(approvals.pendingServerRequestsByThreadId.value).some(rows=>rows.length>0))
  watch(operationEpoch,()=>{securityObservation.clear();deniedActions.clear()},{flush:'sync'})
  const review = createThreadReview({ epoch: operationEpoch, selected: selectedThreadId,
    blocked: () => nativeShell.value?.selectedBlocking.value || nativeDeletion.value?.selectedBlocking.value || nativeAuthenticationBlocked.value || isRollingBack.value || inProgressById.value[selectedThreadId.value] === true || turns.isSendingMessage.value || compaction.busy.value || permissionChanges.blocking.value ||
      history.persistedMessagesByThreadId.value[selectedThreadId.value]?.some(message => message.id === `import-status-${selectedThreadId.value}`) === true,
    ready: () => transportState.value !== 'disconnected',
    interrupt: (threadId, turnId) => interruptThreadTurn(threadId, turnId),
  })
  const compaction = createThreadCompaction({ epoch: operationEpoch, selected: selectedThreadId,
    blocked: () => nativeShell.value?.selectedBlocking.value || nativeDeletion.value?.selectedBlocking.value || nativeAuthenticationBlocked.value || isRollingBack.value || inProgressById.value[selectedThreadId.value] === true || turns.isSendingMessage.value || review.busy.value || permissionChanges.blocking.value ||
      history.persistedMessagesByThreadId.value[selectedThreadId.value]?.some(message => message.id === `import-status-${selectedThreadId.value}`) === true,
    ready: () => transportState.value !== 'disconnected',
    refresh: id => history.loadMessages(id, { force: true }),
  })
  const nativeQueue = createNativeQueue({epoch:operationEpoch,selected:selectedThreadId,
    active:()=>inProgressById.value[selectedThreadId.value]===true,
    refreshHistory:id=>history.loadMessages(id,{force:true}),
    ready:()=>transportState.value!=='disconnected',
    blocked:()=>nativeShell.value?.selectedBlocking.value||nativeDeletion.value?.selectedBlocking.value||nativeAuthenticationBlocked.value||isRollingBack.value||compaction.busy.value||review.busy.value||permissionChanges.blocking.value||turns.isSendingMessage.value||
      history.persistedMessagesByThreadId.value[selectedThreadId.value]?.some(message=>message.id===`import-status-${selectedThreadId.value}`)===true,
  })
  const permissionChanges=createThreadPermissions({epoch:operationEpoch,selected:selectedThreadId,
    ready:()=>transportState.value!=='disconnected',snapshot:id=>securityObservation.snapshots.value[id]??null,
    blocked:()=>nativeShell.value?.selectedBlocking.value||nativeDeletion.value?.selectedBlocking.value||nativeAuthenticationBlocked.value||isRollingBack.value||inProgressById.value[selectedThreadId.value]===true||compaction.busy.value||review.busy.value||nativeQueue.writing.value||turns.isSendingMessage.value||
      history.persistedMessagesByThreadId.value[selectedThreadId.value]?.some(message=>message.id===`import-status-${selectedThreadId.value}`)===true,
  })

  const browserConnection = createConnectionNotice()
  const appServerConnection = createConnectionNotice()
  const connection = createDesktopConnection({
    onBrowserConnectionState: state=>{browserConnection.update(state);if(state!=='connected'){threadTokenUsageByThreadId.value={};backendAuthentication.disconnect()}},
    invalidateReadJobs() { operationEpoch.value++;  diagnosticWarnings.value = [] },
    get history() { return history; },
    get setLiveAgentMessagesForThread() { return setLiveAgentMessagesForThread; },
    get clearLiveReasoningForThread() { return clearLiveReasoningForThread; },
    get liveCommandsByThreadId() { return liveCommandsByThreadId; },
    get setTurnSummaryForThread() { return setTurnSummaryForThread; },
    get setTurnActivityForThread() { return setTurnActivityForThread; },
    get setTurnErrorForThread() { return setTurnErrorForThread; },
    get loadThreads() { return loadThreads; },
    get selectedThreadId() { return selectedThreadId; },
    get inProgressById() { return inProgressById; },
    get currentThreadVersion() { return currentThreadVersion; },
    get threadListLoadGeneration() { return threadListLoadGeneration; }, set threadListLoadGeneration(value) { threadListLoadGeneration = value; },
    get invalidateThreadListGeneration() { return invalidateThreadListGeneration; },
    get loadThreadsPromise() { return loadThreadsPromise; }, set loadThreadsPromise(value) { loadThreadsPromise = value; },
    get pendingForcedThreadLoad() { return pendingForcedThreadLoad; }, set pendingForcedThreadLoad(value) { pendingForcedThreadLoad = value; },
    get approvals() { return approvals; },
    get hasLoadedThreads() { return hasLoadedThreads; },
    get ensureCatalogOwnership() { return ensureCatalogOwnership; },
    get resumedThreadById() { return resumedThreadById; },
    get applyRealtimeUpdates() { return applyRealtimeUpdates; }
  })
  const connectionErrorMessage = 'App-server disconnected. Reconnect and inspect the thread before resending a turn.'
  const transportState = ref('connected')
  const recoveryByThreadId = ref<Record<string, string>>({})
  const recoveryDismissTimerByThreadId = new Map<string, ReturnType<typeof setTimeout>>()
  const turns = createDesktopTurns({
    resetSubmittedPlanMode,
    get selectedCollaborationMode() { return selectedCollaborationMode; },
    get selectedSpeedMode() { return selectedSpeedMode; },
    get approvals() { return approvals; },
    get lifecycleGeneration() { return connection.lifecycleGeneration; }, set lifecycleGeneration(value) { connection.lifecycleGeneration = value; },
    get readModelIdForThread() { return readModelIdForThread; },
    get readCollaborationModeForThread() { return readCollaborationModeForThread; },
    get selectedThreadId() { return selectedThreadId; },
    get selectedReasoningEffort() { return selectedReasoningEffort; },
    get isUpdatingSpeedMode() { return isUpdatingSpeedMode; },
    get history() { return history; },
    get inProgressById() { return inProgressById; },
    get appendOptimisticUserMessage() { return appendOptimisticUserMessage; },
    get setTurnErrorForThread() { return setTurnErrorForThread; },
    get error() { return error; },
    get setTurnSummaryForThread() { return setTurnSummaryForThread; },
    get setTurnActivityForThread() { return setTurnActivityForThread; },
    get setThreadInProgress() { return setThreadInProgress; },
    get activeTurnIdByThreadId() { return activeTurnIdByThreadId; },
    get readReasoningEffortForThread() { return readReasoningEffortForThread; },
    get setThreadModelId() { return setThreadModelId; },
    get setSelectedCollaborationModeForThread() { return setSelectedCollaborationModeForThread; },
    get insertOptimisticThread() { return insertOptimisticThread; },
    get blockInterruptUntilThreadIsPersisted() { return blockInterruptUntilThreadIsPersisted; },
    get resumedThreadById() { return resumedThreadById; },
    get setSelectedThreadId() { return setSelectedThreadId; },
    get realtimeRevisionByThreadId() { return realtimeRevisionByThreadId; },
    get setPersistedMessagesForThread() { return setPersistedMessagesForThread; },
    get maybeUnblockInterruptForActiveTurn() { return maybeUnblockInterruptForActiveTurn; },
    get pendingThreadMessageRefresh() { return connection.pendingThreadMessageRefresh; },
    get syncFromNotifications() { return connection.syncFromNotifications; },
    get scheduleDelayedTurnSync() { return scheduleDelayedTurnSync; },
    get interruptBlockedUntilPersistedByThreadId() { return interruptBlockedUntilPersistedByThreadId; },
    get pendingThreadsRefresh() { return connection.pendingThreadsRefresh; }, set pendingThreadsRefresh(value) { connection.pendingThreadsRefresh = value; }
  })
  const lostApprovalByThreadId = ref<Record<string, boolean>>({})
  const selectedRecoveryState = computed(() => recoveryByThreadId.value[selectedThreadId.value] ?? '')
  const selectedUnknownOutcome = computed(() => turns.unknownOutcomeByThreadId.value[selectedThreadId.value] === true)
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
  const approvals = createDesktopApprovals({
    get applyThreadFlags() { return applyThreadFlags; },
    get lifecycleGeneration() { return connection.lifecycleGeneration; }, set lifecycleGeneration(value) { connection.lifecycleGeneration = value; },
    get error() { return error; }
  })

  const codexRateLimit = ref<UiRateLimitSnapshot | null>(null)
  const threadTokenUsageByThreadId = ref<Record<string, UiThreadTokenUsage>>({})

  const installedSkills = ref<SkillInfo[]>([])
  const accountRateLimitSnapshots = ref<UiRateLimitSnapshot[]>([])

  const isLoadingThreads = ref(false)

  // Only non-silent initial reads own the selected conversation's indicator.

  watch(selectedThreadId, history.syncMessageLoading, { flush: 'sync' })
  const isThreadListFullyLoaded = ref(false)

  const isUpdatingSpeedMode = ref(false)
  const isRollingBack = ref(false)

  const error = ref('')

  const hasLoadedThreads = ref(false)

  // Work may begin before polling starts; only stop invalidates its ownership.

  let catalogOwnership: ReturnType<typeof acquireReasoningCatalog> | null = null
  function ensureCatalogOwnership() {
    return catalogOwnership ??= acquireReasoningCatalog()
  }
  // Error ownership is per selection, independent of coalesced per-thread history reads.
  let selectionGeneration = 0

  let rateLimitRefreshTimer: number | null = null
  const delayedTurnSyncTimerByThreadId = new Map<string, number>()
  let loadThreadsPromise: Promise<void> | null = null
  let threadListLoadGeneration = 0

  const realtimeRevisionByThreadId = new Map<string, number>()
  let optimisticMessageSequence = 0
  const refreshSkillsPromiseByDirectory = new Map<string, Promise<void>>()
  let lastThreadListLoadAt = 0
  let hasLoadedSkills = false
  let lastSkillsLoadAt = 0
  let lastSkillsLoadKey = ''
  let rateLimitRefreshPromise: Promise<void> | null = null

  let threadListNextCursor: string | null = null
  let threadListBackgroundTimer: number | null = null
  let threadListGeneration = 0
  let pendingForcedThreadLoad = false
  let remainingThreadPageRequest: { generation: number; cursor: string } | null = null
  let hasLoadedAllThreadPages = false
  let loadedThreadListGroups: UiProjectGroup[] = []
  let projectOperationPromise: Promise<void> = Promise.resolve()
  let projectListRequest: Promise<void> | null = null
  let projectsNeedRefresh = true
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
    if (selected && Array.isArray(approvals.pendingServerRequestsByThreadId.value[selected])) {
      rows.push(...approvals.pendingServerRequestsByThreadId.value[selected])
    }
    if (Array.isArray(approvals.pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...approvals.pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
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
      const persistedMessages = history.persistedMessagesByThreadId.value[threadId] ?? []
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
        ?? history.persistedMessagesByThreadId.value[threadId]?.find((message) =>
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

    const persisted = history.persistedMessagesByThreadId.value[threadId] ?? []
    const livePlan = livePlanMessagesByThreadId.value[threadId] ?? []
    const liveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
    const liveAgentById = new Map(liveAgent.map((message) => [message.id, message]))
    const persistedIds = new Set(persisted.map((message) => message.id))
    const liveCommands = liveCommandsByThreadId.value[threadId] ?? []
    const liveFileChanges = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    const combined = [
      ...persisted.map((message) => liveAgentById.get(message.id) ?? message),
      ...liveItemOrder.merge([livePlan, liveCommands, liveFileChanges, liveAgent].map(group => group.filter(message => !persistedIds.has(message.id)))),
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
    return threadId ? history.hasMoreOlderMessagesByThreadId.value[threadId] === true : false
  })
  const isLoadingOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? history.loadingOlderMessagesByThreadId.value[threadId] === true : false
  })

  // Explicit composer choices survive backend defaults, including after reload.
  const explicitModelStorageKey = profileStorageKey('codex-web-local.explicit-model-contexts.v2')
  let savedExplicitContexts = readPreferenceRecords(explicitModelStorageKey)
  const explicitModelContexts = new Set(Object.keys(savedExplicitContexts))
  function persistExplicitModelContexts(): void {
    const next = Object.fromEntries([...explicitModelContexts].map(id => [id, '1']))
    savePreferenceRecords(explicitModelStorageKey, next, savedExplicitContexts)
    savedExplicitContexts = next
  }
  function onPreferenceStorage(event: StorageEvent): void {
    const bases = ['selected-model-by-context.v2', 'collaboration-mode-by-context.v2', 'explicit-model-contexts.v2']
      .map(key => profileStorageKey(`codex-web-local.${key}.`))
    if (!event.key || !bases.some(base => event.key!.startsWith(base))) return
    const models = loadSelectedModelMap()
    const modes = loadSelectedCollaborationModeMap()
    // Shared preferences may update; navigation and draft payloads never do.
    selectedModelIdByContext.value = { ...Object.fromEntries(Object.entries(selectedModelIdByContext.value).filter(([key]) => key.startsWith('__new-thread'))),
      ...Object.fromEntries(Object.entries(models).filter(([key]) => !key.startsWith('__new-thread'))) }
    selectedCollaborationModeByContext.value = { ...Object.fromEntries(Object.entries(modes).filter(([key]) => key !== '__new-thread__')),
      ...(selectedCollaborationModeByContext.value['__new-thread__'] ? { '__new-thread__': selectedCollaborationModeByContext.value['__new-thread__'] } : {}) }
    savedThreadModelMap = models
    savedCollaborationMap = modes
    savedExplicitContexts = readPreferenceRecords(explicitModelStorageKey)
    explicitModelContexts.clear()
    for (const id of Object.keys(savedExplicitContexts)) explicitModelContexts.add(id)
    selectedCollaborationMode.value = readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value)
  }
  // A legacy catalog belongs to the server's configured provider. When older
  // config/read omits that identity, effective thread metadata is the evidence.
  let legacyCatalogIds = new Set<string>()
  let legacyCatalogProvider = ''
  const effectiveThreadProviders = new Map<string, string>()
  const blockedProviderContext = ref('')
  const blockedProviderNotice = ref('')
  const modelSelectionNotice = computed(() => blockedProviderContext.value === selectedThreadId.value
    ? blockedProviderNotice.value : '')
  const modelPreferenceNotice = computed(() => {
    const defaults = backendPreferences.state.value.lastUsed || backendPreferences.state.value.preferred
    if (!defaults || !catalogModelIds.value?.length) return ''
    const saved = modelSelectionKey(defaults.providerId, defaults.modelId)
    return catalogModelIds.value.includes(saved) ? '' : `Saved model ${defaults.providerId}/${defaults.modelId} is unavailable. New conversations use an available fallback; your saved preference is preserved.`
  })

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

  function setSelectedThreadId(nextThreadId: string): void {
    if (selectedThreadId.value === nextThreadId) return
    selectionGeneration += 1
    selectedThreadId.value = nextThreadId
    if (!nextThreadId) {
      restoreNewConversationPreferences()
    }
    ensureAvailableModelIds(readModelIdForThread(nextThreadId))
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
    if (!isNewThreadContextId(toThreadContextId(threadId)) && (!currentProvider || !requestedProvider || currentProvider !== requestedProvider)) {
      blockedProviderContext.value = threadId
      error.value = currentProvider && requestedProvider
        ? 'Fork this conversation with Portable Transfer to use a different model provider.'
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
    ensureAvailableModelIds(model)
    saveThreadModelChoice(context, model)
    persistExplicitModelContexts()
    if (isNewThreadContextId(toThreadContextId(threadId))) { newThreadModelEdited = true; saveGlobalChoice(threadId) }
  }

  function setSelectedModelId(modelId: string): void {
    setSelectedModelIdForThread(selectedThreadId.value, modelId)
  }

  function setThreadModelId(threadId: string, modelId: string, provider?: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    if (!explicitModelContexts.has(normalizedThreadId) && readPreferenceRecord(explicitModelStorageKey, normalizedThreadId) === '1') {
      const saved = readPreferenceRecord(profileStorageKey('codex-web-local.selected-model-by-context.v2'), normalizedThreadId)
      if (saved) { selectedModelIdByContext.value = { ...selectedModelIdByContext.value, [normalizedThreadId]: saved }; explicitModelContexts.add(normalizedThreadId) }
    }
    const confirmedProvider = provider?.trim() || parseModelSelection(modelId).provider
    if (confirmedProvider) effectiveThreadProviders.set(normalizedThreadId, confirmedProvider)
    const previousProvider = parseModelSelection(readModelIdForThread(normalizedThreadId)).provider
    const providerChanged = !!confirmedProvider && !!previousProvider && confirmedProvider !== previousProvider
    if (explicitModelContexts.has(normalizedThreadId) && !providerChanged) return
    if (providerChanged) { explicitModelContexts.delete(normalizedThreadId); persistExplicitModelContexts(); saveThreadModelChoice(normalizedThreadId, '') }
    const incoming = parseModelSelection(modelId.trim())
    const effectiveProvider = confirmedProvider || resolveSelectionProvider(modelId) || resolveSelectionProvider(readModelIdForThread(threadId))
    const fallbackModel = providerChanged ? defaultModelForProvider(reasoningCatalog.value, effectiveProvider) : parseModelSelection(readModelIdForThread(threadId)).model
    const normalizedModelId = modelSelectionKey(effectiveProvider, incoming.model || fallbackModel)
    automaticModelByContext.value = omitStringKeyedRecordKey(automaticModelByContext.value, normalizedThreadId)
    if (normalizedModelId) {
      const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
      nextModelMap[normalizedThreadId] = normalizedModelId
      selectedModelIdByContext.value = nextModelMap
    } else {
      selectedModelIdByContext.value = omitStringKeyedRecordKey(selectedModelIdByContext.value, normalizedThreadId)
    }
    ensureAvailableModelIds(normalizedModelId)
    saveThreadModelChoice(normalizedThreadId, normalizedModelId)
  }

  function setThreadTokenUsage(threadId: string, usage: UiThreadTokenUsage | null): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    if (!usage) {
      if (!(normalizedThreadId in threadTokenUsageByThreadId.value)) return
      threadTokenUsageByThreadId.value = omitKey(threadTokenUsageByThreadId.value, normalizedThreadId)
      return
    }

    const current = threadTokenUsageByThreadId.value[normalizedThreadId]
    if (current && JSON.stringify(current) === JSON.stringify(usage)) return

    threadTokenUsageByThreadId.value = {
      ...threadTokenUsageByThreadId.value,
      [normalizedThreadId]: usage,
    }
  }

  function readCollaborationModeForThread(threadId: string): CollaborationModeKind {
    const saved = readSelectedCollaborationMode(selectedCollaborationModeByContext.value, threadId)
    return availableCollaborationModes.value.some(mode => mode.value === saved) ? saved : 'default'
  }

  function resetSubmittedPlanMode(threadId: string): void {
    setSelectedCollaborationModeForThread(threadId, 'default')
    // Clear the saved composer choice too; accepted usage remains Plan.
    selectedCollaborationModeByContext.value['__new-thread__'] = 'default'
    newThreadModeEdited = true
    if (!selectedThreadId.value) selectedCollaborationMode.value = 'default'
    const preferred = backendPreferences.state.value.preferred || backendPreferences.state.value.lastUsed
    if (preferred) void backendPreferences.update({ preferred: { ...preferred, collaborationMode: 'default' } })
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
    if (isNewThreadContextId(contextId)) { newThreadModeEdited = true; saveGlobalChoice('') }
    saveCollaborationMap(Object.fromEntries(Object.entries(selectedCollaborationModeByContext.value).filter(([key]) => key !== '__new-thread__')))
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
    if (isNewThreadContextId(toThreadContextId(threadId))) { newThreadModeEdited = true; saveGlobalChoice(threadId) }
    saveCollaborationMap(Object.fromEntries(Object.entries(selectedCollaborationModeByContext.value).filter(([key]) => key !== '__new-thread__')))
  }

  function setCodexRateLimit(nextSnapshot: UiRateLimitSnapshot | null): void {
    codexRateLimit.value = nextSnapshot
  }

  function reasoningModelForThread(threadId: string) {
    return findReasoningModel(readModelIdForThread(threadId))
  }

  function reasoningPreferenceKey(threadId: string): string {
    const selection = parseModelSelection(readModelIdForThread(threadId))
    return JSON.stringify([selection.provider || 'codex', selection.model])
  }

  function readReasoningEffortForThread(threadId: string): ReasoningEffort | '' {
    const last = backendPreferences.state.value.lastUsed
    const selection = parseModelSelection(readModelIdForThread(threadId))
    const saved = isNewThreadContextId(toThreadContextId(threadId)) && !newThreadModelEdited && !newThreadEffortEdited
      && last?.providerId === selection.provider && last?.modelId === selection.model
      ? last.reasoningEffort : reasoningByModel.value[reasoningPreferenceKey(threadId)]
    return resolveReasoningEffort(reasoningModelForThread(threadId), saved)
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
    if (reasoningByModel.value[reasoningPreferenceKey(threadId)] === resolved) return
    if (isNewThreadContextId(toThreadContextId(threadId))) newThreadEffortEdited = true
    reasoningByModel.value[reasoningPreferenceKey(threadId)] = resolved
    const selection = parseModelSelection(modelId)
    const provider = resolveSelectionProvider(modelId)
    if (provider) void backendPreferences.update({ reasoning: { providerId: provider, modelId: selection.model, effort: resolved } })

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
      if (nextMode === 'fast' && fastModeAvailability(reasoningModelForThread(selectedThreadId.value)) !== 'supported') throw new Error('Fast mode support is unavailable or unknown for this provider/model')
      await setCodexSpeedMode(nextMode)
    } catch (unknownError) {
      selectedSpeedMode.value = previousMode
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to update Fast mode'
    } finally {
      isUpdatingSpeedMode.value = false
    }
  }

  async function refreshCollaborationModes(): Promise<void> {
    const generation = connection.lifecycleGeneration
    try {
      const modes = await getAvailableCollaborationModes()
      if (generation !== connection.lifecycleGeneration) return
      availableCollaborationModes.value = modes
      if (!modes.some((mode) => mode.value === selectedCollaborationMode.value)) {
        selectedCollaborationMode.value = 'default'
      }
    } catch {
      // Keep the last known collaboration mode choices on transient failures.
    }
  }

  let modelRefreshVersion = 0
  async function refreshModelPreferences(): Promise<void> {
    const publication = ensureCatalogOwnership().beginRefresh()
    const generation = connection.lifecycleGeneration
    const version = ++modelRefreshVersion
    const threadId = selectedThreadId.value
    try {
      const config = await getCurrentModelConfig()
      if (generation !== connection.lifecycleGeneration) return
      const fetchedCatalog = await getAvailableModelIds()
      const catalog = { ...fetchedCatalog }
      if (generation !== connection.lifecycleGeneration) return
      if (version !== modelRefreshVersion || threadId !== selectedThreadId.value) return
      const context = isNewThreadContextId(toThreadContextId(threadId)) ? NEW_THREAD_MODEL_CONTEXT : toThreadContextId(threadId)
      automaticModelByContext.value = omitStringKeyedRecordKey(automaticModelByContext.value, context)
      legacyCatalogIds = new Set(catalog.models.every(entry => !entry.modelProvider?.trim())
        ? catalog.ids.filter(id => !parseModelSelection(id).provider) : [])
      legacyCatalogProvider = config.modelProvider?.trim() || catalog.defaultProvider?.trim() || ''

      if (generation !== connection.lifecycleGeneration || version !== modelRefreshVersion || threadId !== selectedThreadId.value) return
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
      const defaultIds = buildModelCatalogIds(catalog.ids, '', configured)
      catalogModelIds.value = defaultIds
      const ids = buildModelCatalogIds(catalog.ids, context === NEW_THREAD_MODEL_CONTEXT ? '' : saved, configured)
      const model = context !== NEW_THREAD_MODEL_CONTEXT && parseModelSelection(saved).provider ? saved : resolveModelPreference(ids, saved, configured)
      if (model && !ids.includes(model)) ids.push(model)
      availableModelIds.value = ids
      automaticModelByContext.value[context] = model
      if (context !== NEW_THREAD_MODEL_CONTEXT) {
        const savedDefault = normalizeStoredModelId(selectedModelIdByContext.value[NEW_THREAD_MODEL_CONTEXT])
        automaticModelByContext.value[NEW_THREAD_MODEL_CONTEXT] = resolveModelPreference(defaultIds, qualify(savedDefault), configured)
      }
      publication.publish(catalog.models.map(entry => entry.modelProvider === defaultProvider && config.model
        ? { ...entry, providerDefaultModel: config.model } : entry))
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
      if (generation !== connection.lifecycleGeneration) return
      if (version !== modelRefreshVersion || threadId !== selectedThreadId.value) return
      publication.fail()
    }
  }

  async function refreshRateLimits(): Promise<void> {
    const generation = connection.lifecycleGeneration
    const epoch = operationEpoch.value
    if (rateLimitRefreshPromise) {
      await rateLimitRefreshPromise
      return
    }

    rateLimitRefreshPromise = (async () => {
      try {
        const snapshot = await getAccountRateLimits()
        if (generation !== connection.lifecycleGeneration || epoch !== operationEpoch.value) return
        setCodexRateLimit(snapshot)
        accountRateLimitSnapshots.value = snapshot ? [snapshot] : []
      } catch {
        // Keep the last known rate-limit state if the endpoint is temporarily unavailable.
      } finally {
        if (generation === connection.lifecycleGeneration && epoch === operationEpoch.value) rateLimitRefreshPromise = null
      }
    })()

    await rateLimitRefreshPromise
  }

  function scheduleRateLimitRefresh(): void {
    const generation = connection.lifecycleGeneration
    if (typeof window === 'undefined') {
      void refreshRateLimits()
      return
    }

    if (rateLimitRefreshTimer !== null) {
      window.clearTimeout(rateLimitRefreshTimer)
    }

    rateLimitRefreshTimer = window.setTimeout(() => {
      if (generation !== connection.lifecycleGeneration) return
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
    const generation = connection.lifecycleGeneration
    if (!threadId || typeof window === 'undefined') return
    clearDelayedTurnSync(threadId)
    const timerId = window.setTimeout(() => {
      if (generation !== connection.lifecycleGeneration) return
      delayedTurnSyncTimerByThreadId.delete(threadId)
      connection.pendingThreadMessageRefresh.add(threadId)
      void connection.syncFromNotifications()
    }, TURN_START_FOLLOW_UP_SYNC_DELAY_MS)
    delayedTurnSyncTimerByThreadId.set(threadId, timerId)
  }

  function applyNativeThreadName(threadId: string, title: string): void {
    sourceGroups.value = sourceGroups.value.map(group => ({
      ...group, threads: group.threads.map(thread => thread.id === threadId ? { ...thread, title } : thread),
    }))
    applyThreadFlags()
  }

  function applyThreadFlags(): void {
    const withTitles = sourceGroups.value
    const flaggedGroups: UiProjectGroup[] = withTitles.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const inProgress = inProgressById.value[thread.id] === true
        const pendingRequestState = approvals.readPendingRequestState(approvals.getThreadPendingRequests(thread.id))
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

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string, projectId?: string | null): void {
    localThreadConfirmationDeadlineById.set(threadId, Date.now() + LOCAL_THREAD_CONFIRMATION_GRACE_MS)
    scheduleLocalThreadReconciliation()
    const nowIso = new Date().toISOString()
    const normalizedCwd = normalizePathForUi(cwd)
    const projectName = projectId || '__codexapp_unassigned__'
    const nextThread: UiThread = {
      id: threadId,
      title: toOptimisticThreadTitle(firstMessageText),
      ...(projectId !== undefined ? { projectId } : {}),
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
    for (const threadId of history.historyReadOwnerByThreadId.keys()) {
      if (!activeThreadIds.has(threadId)) history.invalidateThreadHistory(threadId, false)
    }
    automaticModelByContext.value = pruneThreadContextStateMap(automaticModelByContext.value, activeThreadIds)
    // A sidebar page is not an authoritative deletion list for saved choices.
    history.hasMoreOlderMessagesByThreadId.value = pruneThreadStateMap(history.hasMoreOlderMessagesByThreadId.value, activeThreadIds)
    history.loadingOlderMessagesByThreadId.value = pruneThreadStateMap(history.loadingOlderMessagesByThreadId.value, activeThreadIds)
    history.loadedMessagesByThreadId.value = pruneThreadStateMap(history.loadedMessagesByThreadId.value, activeThreadIds)
    history.loadedVersionByThreadId.value = pruneThreadStateMap(history.loadedVersionByThreadId.value, activeThreadIds)
    for (const threadId of realtimeRevisionByThreadId.keys()) {
      if (!activeThreadIds.has(threadId)) realtimeRevisionByThreadId.delete(threadId)
    }
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    turnIndexByTurnIdByThreadId.value = pruneThreadStateMap(turnIndexByTurnIdByThreadId.value, activeThreadIds)
    history.persistedMessagesByThreadId.value = pruneThreadStateMap(history.persistedMessagesByThreadId.value, activeThreadIds)
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
    for (const [threadId, requests] of Object.entries(approvals.pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    approvals.pendingServerRequestsByThreadId.value = nextPending
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
    const previous = history.persistedMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    history.persistedMessagesByThreadId.value = {
      ...history.persistedMessagesByThreadId.value,
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
    const existing = history.persistedMessagesByThreadId.value[threadId] ?? []
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
    liveItemOrder.remember(previous, nextMessage)
    const next = upsertMessage(previous, nextMessage)
    setLivePlanMessagesForThread(threadId, next)
  }

  function upsertLiveAgentMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    nextMessage = { ...nextMessage, turnId: nextMessage.turnId
      || previous.find((message) => message.id === nextMessage.id)?.turnId || activeTurnIdByThreadId.value[threadId] }
    liveItemOrder.remember(previous, nextMessage)
    const next = upsertMessage(previous, nextMessage)
    setLiveAgentMessagesForThread(threadId, next)
  }

  function upsertLiveFileChangeMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    liveItemOrder.remember(previous, nextMessage)
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
    turns.clearPendingTurnRequest(threadId)
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
    const persisted = history.persistedMessagesByThreadId.value[threadId] ?? []
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
    if (!threadId || !turnId || !Number.isInteger(turnIndex)) return
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
      const rebound = { ...message, turnIndex }
      liveItemOrder.remember(current, rebound)
      return rebound
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
    liveItemOrder.remember(previous, msg)
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
    if (notification.method === 'model-preferences/changed') { backendPreferences.observe(notification.params as ModelPreferences); return }
    if (notification.method === 'model-preferences/error') { backendPreferences.error.value = readString(asRecord(notification.params)?.message) || 'Model preferences could not be saved'; return }
    if (notification.method === 'ready' && asRecord(notification.params)?.reconnected === true) void backendPreferences.refresh()
    if(notification.method==='app-server/reconnected')void backendPreferences.refresh()
    if(notification.method==='ready'||notification.method==='app-server/reconnected')void backendAuthentication.refresh()
    if(notification.method==='native-authentication/state'){backendAuthentication.observe(notification.params);return}
    if(notification.method==='app-server/disconnected'){threadTokenUsageByThreadId.value={};backendAuthentication.disconnect()}
    if(notification.method==='turn/started'||notification.method==='thread/reverted'){
      const id=extractThreadIdFromNotification(notification)
      if(id)setThreadTokenUsage(id,null)
    }
    securityObservation.observe(notification)
    permissionChanges.observe(notification)
    nativeDeletion.value?.observe(notification)
    if(notification.method==='thread/deleted'){
      const id=readString(asRecord(notification.params)?.threadId)
      if(id){
        invalidateThreadListGeneration();removeArchivedThreadFromLoadedLists(id);invalidateResumeThread(id)
        setLiveAgentMessagesForThread(id,[]);clearLiveReasoningForThread(id)
        liveCommandsByThreadId.value=omitKey(liveCommandsByThreadId.value,id)
        liveFileChangeMessagesByThreadId.value=omitKey(liveFileChangeMessagesByThreadId.value,id)
        activeTurnIdByThreadId.value=omitKey(activeTurnIdByThreadId.value,id)
        setTurnSummaryForThread(id,null);setTurnActivityForThread(id,null);setTurnErrorForThread(id,null)
      }
      return
    }
    deniedActions.observe(notification)
    nativeQueue.observe(notification)
    review.observe(notification)
    compaction.observe(notification)
    if (notification.method === 'warning') diagnosticWarnings.value = appendDiagnosticWarning(diagnosticWarnings.value, notification.params, notification.atIso)
    if (notification.method === 'turn/completed' || notification.method === 'error') {
      const params = asRecord(notification.params)
      const threadId = extractThreadIdFromNotification(notification)
      const turnId = readString(asRecord(params?.turn)?.id) || readString(params?.turnId)
      const active = activeTurnIdByThreadId.value[threadId]
      if (active && turnId && active !== turnId) return
    }
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
      history.loadedMessagesByThreadId.value = omitKey(history.loadedMessagesByThreadId.value, threadId)
      history.loadedVersionByThreadId.value = omitKey(history.loadedVersionByThreadId.value, threadId)
      if (state === 'recovered' && selectedThreadId.value === threadId) {
        void history.loadMessages(threadId, { silent: true, force: true }).catch(() => {})
      }
      return
    }
    if (notification.method === 'app-server/transportState') {
      const state = asRecord(notification.params)?.state
      if (state === 'disconnected' && transportState.value !== 'disconnected') {
        // A browser outage may hide the original disconnect event.
        applyRealtimeUpdates({ ...notification, method: 'app-server/disconnected' })
      } else if (state === 'connected') {
        transportState.value = 'connected'
        appServerConnection.update('connected')
        if (error.value === connectionErrorMessage) error.value = ''
      }
      return
    }
    if (notification.method === 'app-server/reconnected' || notification.method === 'app-server/disconnected') { operationEpoch.value++;  diagnosticWarnings.value = [] }
    if (notification.method === 'app-server/reconnected') {
      transportState.value = 'connected'
      appServerConnection.update('connected')
      if (error.value === connectionErrorMessage) error.value = ''
      void connection.recoverBridgeState(true)
      return
    }
    if (notification.method === 'app-server/disconnected') {
      const message = connectionErrorMessage
      transportState.value = 'disconnected'
      appServerConnection.update('disconnected')
      for (const threadId of Object.keys(approvals.pendingServerRequestsByThreadId.value)) {
        lostApprovalByThreadId.value = { ...lostApprovalByThreadId.value, [threadId]: true }
      }
      for (const threadId of Object.keys(resumedThreadById.value)) invalidateResumeThread(threadId)
      resumedThreadById.value = {}
      approvals.pendingServerRequestsByThreadId.value = {}
      for (const threadId of Object.keys(inProgressById.value)) {
        if (inProgressById.value[threadId] !== true) continue
        turns.unknownOutcomeByThreadId.value = { ...turns.unknownOutcomeByThreadId.value, [threadId]: true }
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
        setTurnErrorForThread(threadId, message, { transient: true })
        turns.clearPendingTurnRequest(threadId)
      }
      activeTurnIdByThreadId.value = {}
      error.value = message
      return
    }
    if (approvals.handleServerRequestNotification(notification)) {
      return
    }

    if (notification.method === 'account/rateLimits/updated') {
      if(nativeAuthenticationBlocked.value)return
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

    if (notification.method === 'project/changed') projectsNeedRefresh = true
    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (notificationThreadId && notification.method !== 'turn/generationMetadata' && (
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
      turns.clearPendingTurnRequest(completedTurn.threadId)
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
          turns.clearPendingTurnRequest(errorThreadId)
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
        ?? (history.persistedMessagesByThreadId.value[notificationThreadId] ?? [])
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

    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      const params = asRecord(notification.params)
      const item = normalizeExecutionItem(params?.item, notification.method === 'item/started' ? 'started' : 'completed')
      if (item) upsertLiveAgentMessage(notificationThreadId, { ...item, turnId: readString(params?.turnId) || undefined })
    }
    if (notification.method === 'item/mcpToolCall/progress') {
      const params = asRecord(notification.params)
      const id = readString(params?.itemId)
      const current = (liveAgentMessagesByThreadId.value[notificationThreadId] ?? []).find(message => message.id === id)
      if (current?.executionLabel) upsertLiveAgentMessage(notificationThreadId, {
        ...current, text: `${current.text.split('\nProgress:')[0]}\nProgress: ${executionText(params?.message)}`.slice(0, 12_000),
      })
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
        turns.clearPendingTurnRequest(completedThreadId)
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

  function refreshProjects(): Promise<void> {
    if (projectListRequest) return projectListRequest
    const lifecycle = connection.lifecycleGeneration
    projectsNeedRefresh = false
    projectListRequest = getProjects().then(rows => {
      if (lifecycle !== connection.lifecycleGeneration) return
      projects.value = rows
    }).catch((cause: unknown) => {
      if (lifecycle === connection.lifecycleGeneration) {
        error.value = cause instanceof Error ? cause.message : 'Failed to load projects'
      }
    }).finally(() => { projectListRequest = null })
    return projectListRequest
  }

  async function changeProject<T>(operation: () => Promise<T>): Promise<T> {
    const lifecycle = connection.lifecycleGeneration
    const run = projectOperationPromise.then(async () => {
      if (lifecycle !== connection.lifecycleGeneration) throw new Error('The connection changed. Select the project again.')
      const result = await operation()
      if (lifecycle === connection.lifecycleGeneration) {
        // An earlier listing may have started before the mutation was accepted.
        await projectListRequest
        await refreshProjects()
        applyThreadGroups(loadedThreadListGroups)
      }
      return result
    })
    projectOperationPromise = run.then(() => undefined, () => undefined)
    return run
  }

  async function selectProjectFolder(path: string): Promise<Project> {
    if (!isAbsoluteLikePath(path)) throw new Error('Enter an absolute workspace path on the App Server host.')
    return changeProject(async () => {
      const info = await rpcCall<{ isDirectory: boolean }>('fs/getMetadata', { path })
      if (!info?.isDirectory) throw new Error('The selected path is not a directory.')
      const rows = await getProjects()
      const existing = rows.find(project => project.roots.some(root => root.path === path))
      const project = existing ?? (await rpcCall<{ project: Project }>('project/create', {
        name: toProjectName(path), roots: [{ path }], idempotencyKey: clientMessageId(),
      })).project
      if (!project?.id || !project.roots?.some(root => root.path === path)) {
        throw new Error('The App Server did not confirm the selected project root. Check the project list before retrying.')
      }
      return project
    })
  }

  function applyThreadGroups(groups: UiProjectGroup[]): void {
    const visibleGroups = groupThreadsByProject(groups, projects.value)
    const serverThreadIds = new Set(flattenThreads(visibleGroups).map((thread) => thread.id))
    markServerListedThreads(serverThreadIds)
    // Use the same project identities for incoming history and retained local threads.
    const visibleLocalGroups = groupThreadsByProject(sourceGroups.value, projects.value)
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
    history.invalidateThreadHistory(threadId)
    localThreadConfirmationDeadlineById.delete(threadId)
    scheduleLocalThreadReconciliation()
    loadedThreadListGroups = removeThreadFromGroups(loadedThreadListGroups, threadId)
    sourceGroups.value = removeThreadFromGroups(sourceGroups.value, threadId)
    inProgressById.value = omitKey(inProgressById.value, threadId)
    applyThreadFlags()
  }

  function scheduleLocalThreadReconciliation(): void {
    const generation = connection.lifecycleGeneration
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
      if (generation !== connection.lifecycleGeneration) return
      localThreadReconciliationTimer = null
      void loadThreads().catch(() => {
        // Even if the bridge stays unavailable, the local retention lease is bounded.
      }).finally(() => {
        if (generation === connection.lifecycleGeneration) applyThreadGroups(loadedThreadListGroups)
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
      applyThreadGroups(loadedThreadListGroups)
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

  async function loadThreads(options: { force?: boolean; refreshProjects?: boolean } = {}): Promise<void> {
    const lifecycle = connection.lifecycleGeneration
    if (options.refreshProjects) projectsNeedRefresh = true
    if (loadThreadsPromise) {
      if (options.force === true && !pendingForcedThreadLoad) {
        pendingForcedThreadLoad = true
        invalidateThreadListGeneration()
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
        if (!hasLoadedThreads.value) isLoadingThreads.value = true
        try {
          const [page] = await Promise.all([
            getThreadGroupsPage(),
            projectsNeedRefresh ? refreshProjects() : projectListRequest,
          ])
          if (generation === threadListGeneration) {
            loadedThreadListGroups = hasLoadedThreads.value
              ? mergeThreadGroupPages(loadedThreadListGroups, page.groups)
              : page.groups
            threadListNextCursor = hasLoadedThreads.value && !force && !hasLoadedAllThreadPages
              ? threadListNextCursor
              : page.nextCursor
            hasLoadedAllThreadPages = threadListNextCursor === null
            isThreadListFullyLoaded.value = hasLoadedAllThreadPages
            applyThreadGroups(loadedThreadListGroups)
            completedGeneration = generation
            hasLoadedThreads.value = true
            lastThreadListLoadAt = Date.now()
            pruneThreadScopedState(flattenThreads(projectGroups.value))
          }
        } catch (cause) {
          if (generation === threadListGeneration) failure = cause
        }
        if (lifecycle !== connection.lifecycleGeneration || requestGeneration !== threadListLoadGeneration) return
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

  async function refreshSkills(options: { force?: boolean } = {}): Promise<void> {
    const generation = connection.lifecycleGeneration
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
        if (generation !== connection.lifecycleGeneration ||
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
    const generation = connection.lifecycleGeneration
    const run = () => {
      if (generation === connection.lifecycleGeneration) void refreshAncillaryState()
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
    const generation = connection.lifecycleGeneration
    const readGeneration = connection.eventSyncGeneration
    const isCurrent = () => generation === connection.lifecycleGeneration && readGeneration === connection.eventSyncGeneration
    error.value = ''
    const includeSelectedThreadMessages = options.includeSelectedThreadMessages !== false
    const awaitAncillaryRefreshes = options.awaitAncillaryRefreshes === true

    try {
      await Promise.all([
        loadThreads({ force: options.forceThreadRefresh === true }),
        backendPreferences.ensureHydrated(),
      ])
      if (!isCurrent()) return
      if (includeSelectedThreadMessages) {
        try {
          await history.loadMessages(selectedThreadId.value)
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
    }
  }

  async function selectThread(threadId: string): Promise<SelectThreadResult> {
    const generation = connection.lifecycleGeneration
    const readGeneration = connection.eventSyncGeneration
    setSelectedThreadId(threadId)
    const selection = ++selectionGeneration

    try {
      await history.loadMessages(threadId)
      if (generation !== connection.lifecycleGeneration || readGeneration !== connection.eventSyncGeneration) return 'ok'
      await refreshModelPreferences()
      if (generation === connection.lifecycleGeneration) void refreshSkills()
      return 'ok'
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (generation !== connection.lifecycleGeneration || readGeneration !== connection.eventSyncGeneration || selection !== selectionGeneration) {
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
        void history.loadMessages(nextSelectedThreadId, { silent: true })
      }
    }

    try {
      await archiveThread(threadId)
      removeArchivedThreadFromLoadedLists(threadId)
      await loadThreads()

      if (wasSelectedThread && nextSelectedThreadId && selectedThreadId.value === nextSelectedThreadId) {
        await history.ensureThreadMessagesLoaded(nextSelectedThreadId, { silent: true })
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function restoreThreadById(threadId: string): Promise<void> {
    const epoch = operationEpoch.value
    const restored = await unarchiveThread(threadId)
    if (epoch !== operationEpoch.value) throw new Error('Connection changed. Refresh the archive before retrying.')
    history.invalidateThreadHistory(threadId)
    invalidateResumeThread(threadId)
    loadedThreadListGroups = mergeThreadGroupPages(loadedThreadListGroups, [{ projectName: restored.projectName, threads: [restored] }])
    applyThreadGroups(loadedThreadListGroups)
    try { await loadThreads({ force: true }) }
    catch { error.value = 'Conversation restored, but refreshing active conversations failed. Reload to reconcile.' }
    if (epoch !== operationEpoch.value) throw new Error('Connection changed. Refresh archived conversations.')
    // Keep fresher list metadata/read receipts; only reinsert an older restored row
    // when the first active page did not include it.
    if (!flattenThreads(loadedThreadListGroups).some(thread => thread.id === threadId)) {
      loadedThreadListGroups = mergeThreadGroupPages(loadedThreadListGroups, [{ projectName: restored.projectName, threads: [restored] }])
      applyThreadGroups(loadedThreadListGroups)
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

  function hasPendingNativeAction(threadId: string): boolean {
    return (nativeShell.value?.blocking.value&&nativeShell.value.thread.value===threadId) || (nativeDeletion.value?.blocking.value&&nativeDeletion.value.thread.value===threadId) || nativeAuthenticationBlocked.value || ((permissionChanges.busy.value || permissionChanges.state.value==='unknown') && permissionChanges.thread.value === threadId) || (compaction.busy.value && compaction.thread.value === threadId)
      || (review.busy.value && review.thread.value === threadId)
  }

  const pendingNativeForks = new Set<string>()
  async function forkNativeThreadById(threadId: string, turnId?: string): Promise<string> {
    const sourceId = threadId.trim()
    if (!sourceId) return ''
    if (hasPendingNativeAction(sourceId)) { error.value = 'Wait for the native conversation action to finish before forking.'; return '' }
    if (turnId !== undefined && !turnId.trim()) {
      error.value = 'This imported response has no native turn boundary. Use Portable Transfer for this response.'
      return ''
    }
    const key = JSON.stringify([sourceId, turnId])
    if (pendingNativeForks.has(key)) return ''
    if (turnId !== undefined && inProgressById.value[sourceId] === true) {
      error.value = 'Finish the current turn before forking from a response.'
      return ''
    }
    pendingNativeForks.add(key)
    try {
      error.value = ''
      // No model/provider overrides: preserve the server-managed source state.
      const result = turnId === undefined
        ? await forkThread(sourceId)
        : await forkThreadFromResponse(sourceId, turnId)
      const source = flattenThreads(sourceGroups.value).find(row => row.id === sourceId)
      insertOptimisticThread(result.threadId, result.cwd || source?.cwd || '', toForkedThreadTitle(source?.title || 'Forked conversation'), result.projectId)
      setThreadModelId(result.threadId, result.model || readModelIdForThread(sourceId), result.modelProvider)
      // Native forks are ordinary existing threads; the
      // legacy send-time provider-switch workaround must not run for these IDs.
      setSelectedThreadId(result.threadId)
      await loadThreads()
      await history.loadMessages(result.threadId)
      return result.threadId
    } catch (cause) {
      error.value = `Native Fork failed: ${cause instanceof Error ? cause.message : String(cause)}. The connected app-server must support thread/fork${turnId === undefined ? '' : ' with lastTurnId'}. No Portable Transfer was attempted. If the outcome is uncertain, inspect the thread list before starting another fork.`
      return ''
    } finally { pendingNativeForks.delete(key) }
  }

  const pendingConversationTransfers = new Set<string>()
  async function completeConversationTransfer(threadId: string, transferId: string, modelId: string): Promise<string> {
    if (!transferId || !modelId || pendingConversationTransfers.has(transferId)) return ''
    pendingConversationTransfers.add(transferId)
    try {
      error.value = ''
      const result = await createConversationTransfer(transferId, modelId)
      const source = flattenThreads(sourceGroups.value).find(row => row.id === threadId)
      insertOptimisticThread(result.threadId, source?.cwd || '', toForkedThreadTitle(source?.title || 'Imported conversation'), result.projectId)
      setThreadModelId(result.threadId, result.model, result.modelProvider)
      // Save before publishing the destination so composer hydration sees an ordinary draft.
      if (result.draftText !== undefined) persistDraftForThread(result.threadId, {
        text: result.draftText, imageUrls: [], fileAttachments: [], skills: [],
      })
      // This is a new, configured thread, never a native fresh fork.
      setSelectedThreadId(result.threadId)
      await loadThreads()
      await history.loadMessages(result.threadId)
      return result.threadId
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return ''
    } finally { pendingConversationTransfers.delete(transferId) }
  }
  async function forkThreadById(threadId: string, transferId = '', modelId = ''): Promise<string> {
    return completeConversationTransfer(threadId, transferId, modelId)
  }
  async function executeThreadRevert(sourceThreadId: string, turnId: string, operation: 'revert' | 'fork-and-revert'): Promise<string> {
    let threadId = sourceThreadId
    if (!threadId) return ''
    if (isRollingBack.value) return ''
    if (!turnId.trim()) return ''

    if (inProgressById.value[threadId]) return ''
    if (hasPendingNativeAction(threadId)) { error.value = 'Wait for the native conversation action to finish before reverting.'; return '' }

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
        insertOptimisticThread(threadId, threadCwd, 'Forked chat', forked.projectId)
        setThreadModelId(threadId, forked.model, forked.modelProvider)
        stage = 'Validate fork target'
        await validateThreadRevert(threadId, turnId)
      }
      history.invalidateThreadHistory(threadId)
      stage = 'Undo history'
      await revertThreadHistory(threadId, turnId)
      historyReverted = true
      history.invalidateThreadHistory(threadId)
      setLiveAgentMessagesForThread(threadId, [])
      clearLiveReasoningForThread(threadId)
      if (liveCommandsByThreadId.value[threadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
      }
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      stage = 'Refresh destination'
      const owner = history.historyReadOwner(threadId)
      const detail = await getThreadDetailForRevert(threadId)
      if (history.historyReadOwnerByThreadId.get(threadId) !== owner) return ''
      setPersistedMessagesForThread(threadId, detail.messages)
      turnIndexByTurnIdByThreadId.value = { ...turnIndexByTurnIdByThreadId.value, [threadId]: detail.turnIndexByTurnId }
      owner.olderCursor = detail.olderCursor
      history.hasMoreOlderMessagesByThreadId.value = { ...history.hasMoreOlderMessagesByThreadId.value, [threadId]: Boolean(owner.olderCursor) }
      history.loadedMessagesByThreadId.value = { ...history.loadedMessagesByThreadId.value, [threadId]: true }
      if (operation === 'fork-and-revert' && selectionGeneration === originalSelectionGeneration && selectedThreadId.value === originalSelection && originalSelection === sourceThreadId) {
        setSelectedThreadId(threadId)
      }
      if (operation === 'revert') {
        connection.pendingThreadsRefresh = true
        await connection.syncFromNotifications()
      }
      return threadId
    } catch (unknownError) {
      const reason = stage + ': ' + (unknownError instanceof Error ? unknownError.message : 'Failed to revert thread')
        + (threadId !== sourceThreadId ? ' Fork retained: ' + threadId + '.' : '')
      history.invalidateThreadHistory(threadId)
      error.value = historyReverted
        ? 'History reverted, but refresh failed. Reload the thread; do not repeat the edit. ' + reason
        : reason
      return ''
    } finally {
      isRollingBack.value = false
    }
  }

  async function removeProject(projectId: string): Promise<void> {
    if (!projects.value.some(project => project.id === projectId)) return
    await changeProject(async () => {
      await rpcCall('project/delete', { projectId })
      const unassign = (groups: UiProjectGroup[]) => groups.map(group => group.projectName === projectId
        ? { ...group, threads: group.threads.map(thread => ({ ...thread, projectId: null })) }
        : group)
      loadedThreadListGroups = unassign(loadedThreadListGroups)
      sourceGroups.value = unassign(sourceGroups.value)
    })
  }

  function renameProject(projectId: string, name: string): Promise<unknown> {
    return changeProject(() => rpcCall('project/update', { projectId, name }))
  }

  function moveProject(projectId: string, direction: -1 | 1): Promise<unknown> {
    return changeProject(async () => {
      const index = projects.value.findIndex(project => project.id === projectId)
      if (index < 0 || !projects.value[index + direction]) return
      const beforeProjectId = projects.value[index + (direction === -1 ? -1 : 2)]?.id ?? null
      await rpcCall('project/move', { projectId, beforeProjectId })
    })
  }

  function stopPolling(): void {
    if (typeof window !== 'undefined') window.removeEventListener?.('storage', onPreferenceStorage)
    operationEpoch.value++
    backendAuthentication.dispose()
    nativeDeletion.value?.dispose();nativeDeletion.value=null
    nativeShell.value?.dispose();nativeShell.value=null
    diagnosticWarnings.value = []
    for (const timer of recoveryDismissTimerByThreadId.values()) clearTimeout(timer)
    recoveryDismissTimerByThreadId.clear()
    browserConnection.dispose()
    appServerConnection.dispose()
    backendPreferences.dispose()
    ++connection.lifecycleGeneration
    ++connection.eventSyncGeneration
    ++threadListLoadGeneration
    loadThreadsPromise = null
    isLoadingThreads.value = false
    history.loadMessagePromiseByThreadId.clear()
    history.historyReadOwnerByThreadId.clear()
    history.visibleMessageLoads.clear()
    refreshSkillsPromiseByDirectory.clear()
    rateLimitRefreshPromise = null
    history.isLoadingMessages.value = false
    history.loadingOlderMessagesByThreadId.value = {}
    turns.isSendingMessage.value = false
    connection.isPolling.value = false
    localThreadConfirmationDeadlineById.clear()
    scheduleLocalThreadReconciliation()
    invalidateThreadListGeneration()
    pendingForcedThreadLoad = false
    ++modelRefreshVersion
    ensureCatalogOwnership().release()
    catalogOwnership = null
    if (connection.stopNotificationStream) {
      connection.stopNotificationStream()
      connection.stopNotificationStream = null
    }

    connection.pendingThreadsRefresh = false
    connection.pendingThreadsRefreshForce = false
    connection.pendingThreadMessageRefresh.clear()
    pendingTurnStartsById.clear()
    if (connection.eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(connection.eventSyncTimer)
      connection.eventSyncTimer = null
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
    history.loadedMessagesByThreadId.value = {}
    history.reconnectingThreadHistory.clear()
    history.loadedVersionByThreadId.value = {}
    history.hasMoreOlderMessagesByThreadId.value = {}
    history.lastMessageLoadAtByThreadId.clear()
    history.lastMessageLoadFailureAtByThreadId.clear()
    history.persistedMessagesByThreadId.value = {}
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

  function primeSelectedThread(threadId: string): void {
    setSelectedThreadId(threadId)
  }

  async function retrySelectedSubscription(): Promise<void> {
    const id = selectedThreadId.value
    if (!id) return
    invalidateResumeThread(id)
    try { await resumeThreadSubscription(id); await history.loadMessages(id, { force: true }) }
    catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure) }
  }
  async function reconcileSelectedHistory(): Promise<void> {
    const id = selectedThreadId.value
    if (!id) return
    void refreshThreadGenerationMetadata(id).catch(() => {})
    // A snapshot alone cannot prove an ambiguously accepted submission failed.
    await history.loadMessages(id, { force: true })
  }

  return {
    modelSelectionNotice,
    browserConnectionState: browserConnection.state, browserConnectionNotice: browserConnection.notice,
    appServerConnectionNotice: appServerConnection.notice,
    transportState, selectedRecoveryState, selectedUnknownOutcome, selectedLostApproval,
    retrySelectedSubscription, reconcileSelectedHistory,
    projectGroups,
    projectDisplayNameById, projects,
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
    restoreNewConversationPreferences,
    modelPreferenceNotice,
    modelPreferencesLoading: backendPreferences.loading,
    modelPreferencesError: backendPreferences.error,
    refreshBackendModelPreferences: backendPreferences.refresh,
    settleModelPreferenceWrites: backendPreferences.settled,
    selectedReasoningEffort,
    availableReasoningEfforts,
    selectedSpeedMode,
    installedSkills,
    accountRateLimitSnapshots,
    messages,
    hasMoreOlderMessages,
    isLoadingThreads,
    isThreadListFullyLoaded,
    isLoadingMessages: history.isLoadingMessages,
    isLoadingOlderMessages,
    isSendingMessage: turns.isSendingMessage,
    isInterruptingTurn: turns.isInterruptingTurn,
    isUpdatingSpeedMode,
    isRollingBack,

    error,
    refreshAll,
    selectProjectFolder,
    renameProject,
    moveProject,
    refreshSkills,
    selectThread,
    loadMessages: history.loadMessages,
    loadOlderMessages: history.loadOlderMessages,
    ensureThreadMessagesLoaded: history.ensureThreadMessagesLoaded,
    archiveThreadById,
    restoreThreadById,
    operationEpoch,
    securityObservation,
    deniedActions,
    compaction, review,
    nativeQueue,
    permissionChanges,
    backendAuthentication, nativeAuthenticationBlocked, nativeAuthenticationStatus, nativeAccountChangeBlocked,
    nativeDeletion,ensureNativeDeletion,
    nativeShell,ensureNativeShell,
    diagnosticWarnings,
    renameThreadById,
    forkThreadById,
    forkNativeThreadById,
    executeThreadRevert,

    sendMessageToSelectedThread: (...args: Parameters<typeof turns.sendMessageToSelectedThread>) => {
      if (nativeShell.value?.selectedBlocking.value || nativeDeletion.value?.selectedBlocking.value || nativeAuthenticationBlocked.value || compaction.selectedBusy.value || review.selectedBusy.value || permissionChanges.blocking.value&&permissionChanges.thread.value===selectedThreadId.value) return Promise.reject(new Error('Wait for the native conversation action to finish.'))
      return turns.sendMessageToSelectedThread(...args)
    },
    sendMessageToNewThread: (...args:Parameters<typeof turns.sendMessageToNewThread>)=>nativeAuthenticationBlocked.value?Promise.reject(new Error('Finish native authentication before sending')):turns.sendMessageToNewThread(...args),
    interruptSelectedThreadTurn: turns.interruptSelectedThreadTurn,
    setSelectedCollaborationMode,
    readModelIdForThread,
    readCollaborationModeForThread,
    setSelectedCollaborationModeForThread,
    resetSubmittedPlanMode,
    readReasoningEffortForThread,
    readReasoningOptionsForThread,
    setSelectedModelIdForThread,
    setSelectedModelId,

    setSelectedReasoningEffort,
    updateSelectedSpeedMode,
    respondToPendingServerRequest: approvals.respondToPendingServerRequest,
    removeProject,
    startPolling: () => { if (typeof window !== 'undefined') window.addEventListener?.('storage', onPreferenceStorage); backendPreferences.resume(); connection.startPolling() },
    stopPolling,
    primeSelectedThread,
  }
}
