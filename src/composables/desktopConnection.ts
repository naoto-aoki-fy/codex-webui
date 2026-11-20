import type { Ref } from 'vue';
import type { BrowserConnectionState } from '../api/codexRpcClient';
import { ref } from 'vue';
import { invalidateResumeThread, resumeThreadSubscription, subscribeCodexNotifications, type RpcNotification } from '../api/codexGateway';
import type { UiMessage } from '../types/codex';
import { reloadForConnectionProfile } from '../utils/browserConnectionProfile';
import { createDesktopApprovals } from './desktopApprovals';
import { createDesktopHistory } from './desktopHistory';
import { asRecord, extractThreadIdFromNotification, readString, type TurnActivityState } from './desktopNotificationReaders';
const EVENT_SYNC_DEBOUNCE_MS = 220;
type TurnSummaryState = {
    turnId: string;
    durationMs: number;
};
function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
    if (!(key in record))
        return record;
    const next = { ...record };
    delete next[key];
    return next;
}
/** Owns the single notification subscription, readiness identity, coalescing timer and refresh queues. startPolling is idempotent; the desktop stopPolling teardown closes the subscription and timer before dropping shared state. */
export function createDesktopConnection(deps: {
    onBrowserConnectionState: (state: BrowserConnectionState) => void;
    invalidateReadJobs: () => void;
    history: ReturnType<typeof createDesktopHistory>;
    setLiveAgentMessagesForThread: (threadId: string, nextMessages: UiMessage[]) => void;
    clearLiveReasoningForThread: (threadId: string) => void;
    liveCommandsByThreadId: Ref<Record<string, UiMessage[]>>;
    setTurnSummaryForThread: (threadId: string, summary: TurnSummaryState | null) => void;
    setTurnActivityForThread: (threadId: string, activity: TurnActivityState | null) => void;
    setTurnErrorForThread: (threadId: string, message: string | null, options?: {
        transient?: boolean;
    }) => void;
    loadThreads: (options?: {
        force?: boolean;
        refreshProjects?: boolean;
    }) => Promise<void>;
    selectedThreadId: Ref<string, string>;
    inProgressById: Ref<Record<string, boolean>>;
    currentThreadVersion: (threadId: string) => string;
    threadListLoadGeneration: number;
    invalidateThreadListGeneration: () => number;
    loadThreadsPromise: Promise<void> | null;
    pendingForcedThreadLoad: boolean;
    approvals: ReturnType<typeof createDesktopApprovals>;
    hasLoadedThreads: Ref<boolean, boolean>;
    ensureCatalogOwnership: () => unknown;
    resumedThreadById: Ref<Record<string, boolean>>;
    applyRealtimeUpdates: (notification: RpcNotification) => void;
}) {
    let backendInstanceId = '';
    const isPolling = ref(false);
    let lifecycleGeneration = 0;
    let stopNotificationStream: (() => void) | null = null;
    let eventSyncTimer: number | null = null;
    let eventSyncGeneration = 0;
    let pendingThreadsRefresh = false;
    let pendingThreadsRefreshForce = false;
    const pendingThreadMessageRefresh = new Set<string>();
    function queueEventDrivenSync(notification: RpcNotification): void {
        const generation = lifecycleGeneration;
        if (notification.method === 'thread/tokenUsage/updated' || notification.method === 'thread/readState/changed' || notification.method === 'thread/queue/changed' ||
            notification.method === 'thread/goal/updated' || notification.method === 'thread/goal/cleared')
            return;
        const method = notification.method;
        const shouldRefreshMessages = method === 'turn/started' ||
            method === 'turn/completed' ||
            method === 'thread/reverted' ||
            method === 'error';
        const shouldRefreshThreads = method.startsWith('thread/') ||
            method === 'turn/completed' || method === 'project/changed';
        if (!shouldRefreshMessages && !shouldRefreshThreads)
            return;
        const threadId = extractThreadIdFromNotification(notification);
        if (threadId && method === 'thread/reverted') {
            invalidateResumeThread(threadId);
            deps.history.invalidateThreadHistory(threadId);
            deps.setLiveAgentMessagesForThread(threadId, []);
            deps.clearLiveReasoningForThread(threadId);
            deps.liveCommandsByThreadId.value = omitKey(deps.liveCommandsByThreadId.value, threadId);
            deps.setTurnSummaryForThread(threadId, null);
            deps.setTurnActivityForThread(threadId, null);
            deps.setTurnErrorForThread(threadId, null);
        }
        if (threadId && shouldRefreshMessages) {
            pendingThreadMessageRefresh.add(threadId);
        }
        if (shouldRefreshThreads) {
            pendingThreadsRefresh = true;
            pendingThreadsRefreshForce = true;
        }
        if (eventSyncTimer !== null || typeof window === 'undefined')
            return;
        eventSyncTimer = window.setTimeout(() => {
            if (generation !== lifecycleGeneration)
                return;
            eventSyncTimer = null;
            void syncFromNotifications();
        }, EVENT_SYNC_DEBOUNCE_MS);
    }
    async function syncFromNotifications(): Promise<void> {
        const generation = lifecycleGeneration;
        const syncGeneration = eventSyncGeneration;
        const isCurrent = () => generation === lifecycleGeneration && syncGeneration === eventSyncGeneration;
        if (isPolling.value) {
            if (typeof window !== 'undefined' && eventSyncTimer === null) {
                eventSyncTimer = window.setTimeout(() => {
                    eventSyncTimer = null;
                    void syncFromNotifications();
                }, EVENT_SYNC_DEBOUNCE_MS);
            }
            return;
        }
        isPolling.value = true;
        const shouldRefreshThreads = pendingThreadsRefresh;
        const shouldForceThreadRefresh = pendingThreadsRefreshForce;
        const threadIdsToRefresh = new Set(pendingThreadMessageRefresh);
        pendingThreadsRefresh = false;
        pendingThreadsRefreshForce = false;
        pendingThreadMessageRefresh.clear();
        try {
            if (shouldRefreshThreads) {
                await deps.loadThreads({ force: shouldForceThreadRefresh });
            }
            if (!isCurrent())
                return;
            const activeThreadId = deps.selectedThreadId.value;
            if (!activeThreadId)
                return;
            const isActiveDirty = threadIdsToRefresh.has(activeThreadId);
            const isInProgress = deps.inProgressById.value[activeThreadId] === true;
            const currentVersion = deps.currentThreadVersion(activeThreadId);
            const loadedVersion = deps.history.loadedVersionByThreadId.value[activeThreadId] ?? '';
            const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion;
            const shouldRefreshActiveThread = hasVersionChange ||
                isActiveDirty ||
                (isInProgress && deps.history.loadedMessagesByThreadId.value[activeThreadId] !== true) ||
                (shouldRefreshThreads && deps.history.loadedMessagesByThreadId.value[activeThreadId] !== true);
            if (shouldRefreshActiveThread) {
                await deps.history.loadMessages(activeThreadId, { silent: true, force: isActiveDirty });
            }
        }
        catch {
            // Keep UI stable on transient event sync failures.
        }
        finally {
            if (isCurrent()) {
                isPolling.value = false;
                if ((pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) &&
                    typeof window !== 'undefined' &&
                    eventSyncTimer === null) {
                    eventSyncTimer = window.setTimeout(() => {
                        eventSyncTimer = null;
                        void syncFromNotifications();
                    }, EVENT_SYNC_DEBOUNCE_MS);
                }
            }
        }
    }
    function invalidateDisconnectedReads(): void {
        // A fetch started before suspension may never settle. Detach read ownership
        // without clearing visible messages, pagination boundaries, or pending sends.
        ++eventSyncGeneration;
        isPolling.value = false;
        pendingThreadsRefresh = false;
        pendingThreadsRefreshForce = false;
        pendingThreadMessageRefresh.clear();
        if (eventSyncTimer !== null) {
            window.clearTimeout(eventSyncTimer);
            eventSyncTimer = null;
        }
        ++deps.threadListLoadGeneration;
        deps.invalidateThreadListGeneration();
        deps.loadThreadsPromise = null;
        deps.pendingForcedThreadLoad = false;
        for (const [threadId, owner] of deps.history.historyReadOwnerByThreadId) {
            deps.history.historyReadOwnerByThreadId.set(threadId, { ...owner });
            deps.history.reconnectingThreadHistory.add(threadId);
        }
        deps.history.loadMessagePromiseByThreadId.clear();
        deps.history.visibleMessageLoads.clear();
        deps.history.loadingOlderMessagesByThreadId.value = {};
        deps.history.syncMessageLoading();
        // Other conversations refresh when opened; do not fetch all cached histories.
        deps.history.loadedMessagesByThreadId.value = {};
        deps.history.loadedVersionByThreadId.value = {};
        deps.history.lastMessageLoadAtByThreadId.clear();
        deps.history.lastMessageLoadFailureAtByThreadId.clear();
    }
    async function recoverBridgeState(reconnected: boolean, backendReplaced = false): Promise<void> {
        // Approval/sidebar requests must not hold the conversation recovery hostage.
        void deps.approvals.loadPendingServerRequestsFromBridge();
        if (reconnected) {
            invalidateDisconnectedReads();
            const threadId = deps.selectedThreadId.value;
            // Backend owns retry timing and concurrency. A replacement backend needs
            // registration only; the same scheduler handles those manual requests.
            if (backendReplaced) {
                for (const id of Object.keys(deps.inProgressById.value)) {
                    if (id !== threadId && deps.inProgressById.value[id])
                        void Promise.resolve(resumeThreadSubscription(id)).catch(() => { });
                }
            }
            const recoveryIds = threadId ? [threadId] : [];
            await Promise.allSettled([
                deps.loadThreads({ force: true, refreshProjects: true }),
                (async () => {
                    // Recover only the selected conversation.
                    for (const id of recoveryIds) {
                        try {
                            await deps.history.loadMessages(id, { silent: true, force: true, recoverRetained: true });
                        }
                        catch { /* Retry through ordinary history loading. */ }
                    }
                })(),
            ]);
            return;
        }
        pendingThreadsRefresh ||= !deps.hasLoadedThreads.value;
        if (deps.selectedThreadId.value &&
            (deps.history.loadedMessagesByThreadId.value[deps.selectedThreadId.value] !== true ||
                deps.inProgressById.value[deps.selectedThreadId.value] === true)) {
            pendingThreadMessageRefresh.add(deps.selectedThreadId.value);
        }
        await syncFromNotifications();
    }
    function startPolling(): void {
        deps.ensureCatalogOwnership();
        const generation = lifecycleGeneration;
        if (typeof window === 'undefined')
            return;
        if (stopNotificationStream)
            return;
        let receivedReady = false;
        void deps.approvals.loadPendingServerRequestsFromBridge();
        stopNotificationStream = subscribeCodexNotifications((notification) => {
            if (generation !== lifecycleGeneration)
                return;
            if (notification.method === 'ready') {
                deps.invalidateReadJobs();
                if (reloadForConnectionProfile(readString(asRecord(notification.params)?.connectionProfile)))
                    return;
                deps.applyRealtimeUpdates(notification);
                const instanceId = readString(asRecord(notification.params)?.backendInstanceId);
                // Hydration can precede the first ready. An unknown instance must also
                // establish subscriptions, rather than trusting browser-only resume flags.
                const backendReplaced = Boolean(instanceId && instanceId !== backendInstanceId);
                if (backendReplaced) {
                    backendInstanceId = instanceId;
                    for (const id of new Set([
                        ...Object.keys(deps.resumedThreadById.value), ...deps.history.loadMessagePromiseByThreadId.keys(), deps.selectedThreadId.value,
                    ]))
                        if (id)
                            invalidateResumeThread(id);
                    deps.resumedThreadById.value = {};
                }
                const reconnected = backendReplaced || receivedReady || asRecord(notification.params)?.reconnected === true;
                receivedReady = true;
                void recoverBridgeState(reconnected, backendReplaced);
                return;
            }
            deps.applyRealtimeUpdates(notification);
            queueEventDrivenSync(notification);
        }, state => {
            if (generation === lifecycleGeneration) deps.onBrowserConnectionState(state);
        });
    }
    return {
get backendInstanceId() { return backendInstanceId; },
set backendInstanceId(value) { backendInstanceId = value; },
isPolling,
get lifecycleGeneration() { return lifecycleGeneration; },
set lifecycleGeneration(value) { lifecycleGeneration = value; },
get stopNotificationStream() { return stopNotificationStream; },
set stopNotificationStream(value) { stopNotificationStream = value; },
get eventSyncTimer() { return eventSyncTimer; },
set eventSyncTimer(value) { eventSyncTimer = value; },
get eventSyncGeneration() { return eventSyncGeneration; },
set eventSyncGeneration(value) { eventSyncGeneration = value; },
get pendingThreadsRefresh() { return pendingThreadsRefresh; },
set pendingThreadsRefresh(value) { pendingThreadsRefresh = value; },
get pendingThreadsRefreshForce() { return pendingThreadsRefreshForce; },
set pendingThreadsRefreshForce(value) { pendingThreadsRefreshForce = value; },
pendingThreadMessageRefresh,
syncFromNotifications,
recoverBridgeState,
startPolling
};
}
