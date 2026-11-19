import type { Ref } from 'vue';
import { ref } from 'vue';
import { getOlderThreadMessages, getThreadDetail, resumeThread } from '../api/codexGateway';
import type { CollaborationModeKind, ReasoningEffort, UiMessage, UiProjectGroup, UiThread } from '../types/codex';
import { hasOptimisticUserMessages, mergeMessages, removeRedundantLiveAgentMessages } from '../utils/desktopMessageReconciliation';
function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
    return groups.flatMap((group) => group.threads);
}
const RECENT_THREAD_MESSAGE_LOAD_REUSE_MS = 2000;
type TurnErrorState = {
    message: string;
    transient: boolean;
};
function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
    if (!(key in record))
        return record;
    const next = { ...record };
    delete next[key];
    return next;
}
type HistoryReadOwner = {
    olderCursor?: string | null;
};
type FileAttachment = {
    label: string;
    path: string;
    fsPath: string;
};
type PendingTurnRequest = {
    text: string;
    imageUrls: string[];
    skills: Array<{
        name: string;
        path: string;
    }>;
    fileAttachments: FileAttachment[];
    effort: ReasoningEffort | '';
    collaborationMode: CollaborationModeKind;
};
/** Owns persisted history, page/read ownership, pending read promises and loading indicators. stopPolling clears these resources; disconnect recovery detaches read ownership without replaying mutations. */
export function createDesktopHistory(deps: {
    securityObservation?: ReturnType<typeof import('./threadSecurityObservation').createThreadSecurityObservation>;
    selectedThreadId: Ref<string, string>;
    turnIndexByTurnIdByThreadId: Ref<Record<string, Record<string, number>>, Record<string, Record<string, number>>>;
    lifecycleGeneration: number;
    turnErrorByThreadId: Ref<Record<string, TurnErrorState>, Record<string, TurnErrorState>>;
    currentThreadVersion: (threadId: string) => string;
    sourceGroups: Ref<UiProjectGroup[]>;
    inProgressById: Ref<Record<string, boolean>, Record<string, boolean>>;
    resumedThreadById: Ref<Record<string, boolean>, Record<string, boolean>>;
    markThreadAsRead: (threadId: string, observedRevision?: string) => void;
    realtimeRevisionByThreadId: Map<string, number>;
    applyThreadFlags: () => void;
    activeTurnIdByThreadId: Ref<Record<string, string>, Record<string, string>>;
    pendingTurnRequestByThreadId: Ref<Record<string, PendingTurnRequest>, Record<string, PendingTurnRequest>>;
    setThreadModelId: (threadId: string, modelId: string, provider?: string) => void;
    markThreadMessagesPersisted: (threadId: string, messages: UiMessage[]) => void;
    replaceTurnIndexLookupForThread: (threadId: string, nextLookup: Record<string, number>) => void;
    rebindLiveFileChangeTurnIndices: (threadId: string) => void;
    setPersistedMessagesForThread: (threadId: string, nextMessages: UiMessage[]) => void;
    liveAgentMessagesByThreadId: Ref<Record<string, UiMessage[]>, Record<string, UiMessage[]>>;
    setLiveAgentMessagesForThread: (threadId: string, nextMessages: UiMessage[]) => void;
    removeLiveCommandsPersistedIn: (threadId: string, persistedMessages: UiMessage[]) => void;
    removeLiveFileChangesPersistedIn: (threadId: string, persistedMessages: UiMessage[]) => void;
    error: Ref<string, string>;
    connectionErrorMessage: string;
    setThreadInProgress: (threadId: string, nextInProgress: boolean) => void;
    clearTransientTurnErrorForThread: (threadId: string) => void;
    clearCompletedTurnLiveState: (threadId: string) => void;
    setTurnErrorForThread: (threadId: string, message: string | null, options?: {
        transient?: boolean;
    }) => void;
}) {
    const persistedMessagesByThreadId = ref<Record<string, UiMessage[]>>({});
    const loadedVersionByThreadId = ref<Record<string, string>>({});
    const loadedMessagesByThreadId = ref<Record<string, boolean>>({});
    const hasMoreOlderMessagesByThreadId = ref<Record<string, boolean>>({});
    const loadingOlderMessagesByThreadId = ref<Record<string, boolean>>({});
    const isLoadingMessages = ref(false);
    const visibleMessageLoads = new Set<string>();
    function syncMessageLoading(): void {
        isLoadingMessages.value = visibleMessageLoads.has(deps.selectedThreadId.value);
    }
    const loadMessagePromiseByThreadId = new Map<string, Promise<void>>();
    const reconnectingThreadHistory = new Set<string>();
    const historyReadOwnerByThreadId = new Map<string, HistoryReadOwner>();
    function historyReadOwner(threadId: string): HistoryReadOwner {
        let owner = historyReadOwnerByThreadId.get(threadId);
        if (!owner) {
            owner = {};
            historyReadOwnerByThreadId.set(threadId, owner);
        }
        return owner;
    }
    function invalidateThreadHistory(threadId: string, dropPayload = true): void {
        historyReadOwnerByThreadId.delete(threadId);
        loadMessagePromiseByThreadId.delete(threadId);
        reconnectingThreadHistory.delete(threadId);
        visibleMessageLoads.delete(threadId);
        lastMessageLoadAtByThreadId.delete(threadId);
        lastMessageLoadFailureAtByThreadId.delete(threadId);
        if (dropPayload) {
            loadedMessagesByThreadId.value = omitKey(loadedMessagesByThreadId.value, threadId);
            loadedVersionByThreadId.value = omitKey(loadedVersionByThreadId.value, threadId);
            persistedMessagesByThreadId.value = omitKey(persistedMessagesByThreadId.value, threadId);
            deps.turnIndexByTurnIdByThreadId.value = omitKey(deps.turnIndexByTurnIdByThreadId.value, threadId);
            hasMoreOlderMessagesByThreadId.value = omitKey(hasMoreOlderMessagesByThreadId.value, threadId);
            loadingOlderMessagesByThreadId.value = omitKey(loadingOlderMessagesByThreadId.value, threadId);
        }
        syncMessageLoading();
    }
    const lastMessageLoadAtByThreadId = new Map<string, number>();
    const lastMessageLoadFailureAtByThreadId = new Map<string, number>();
    async function loadMessages(threadId: string, options: {
        silent?: boolean;
        force?: boolean;
    } = {}) {
        const generation = deps.lifecycleGeneration;
        if (!threadId) {
            return;
        }
        const owner = historyReadOwner(threadId);
        const isCurrent = () => generation === deps.lifecycleGeneration && historyReadOwnerByThreadId.get(threadId) === owner;
        const recentLoadFailure = Date.now() - (lastMessageLoadFailureAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS;
        if (options.force !== true && deps.turnErrorByThreadId.value[threadId]?.transient && (options.silent === true || recentLoadFailure)) {
            return;
        }
        const existingLoad = loadMessagePromiseByThreadId.get(threadId);
        if (existingLoad) {
            await existingLoad;
            // A send/completion that arrived during this read still needs a fresh snapshot.
            if (isCurrent() && options.force === true)
                await loadMessages(threadId, options);
            return;
        }
        const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true;
        const shouldShowLoading = options.silent !== true && !alreadyLoaded;
        if (shouldShowLoading) {
            visibleMessageLoads.add(threadId);
            syncMessageLoading();
        }
        const loadPromise = (async () => {
            try {
                const version = deps.currentThreadVersion(threadId);
                const loadedVersion = loadedVersionByThreadId.value[threadId] ?? '';
                const loadedRecently = Date.now() - (lastMessageLoadAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS;
                const canReuseLoadedMessages = flattenThreads(deps.sourceGroups.value).find(row => row.id === threadId)?.nativeReadState?.firstUnread == null &&
                    options.force !== true &&
                    alreadyLoaded &&
                    (version.length === 0 || loadedVersion === version) &&
                    (loadedRecently ||
                        deps.inProgressById.value[threadId] !== true);
                if (canReuseLoadedMessages && deps.resumedThreadById.value[threadId] === true) {
                    deps.markThreadAsRead(threadId);
                    return;
                }
                const observedReadRevision = flattenThreads(deps.sourceGroups.value).find(row => row.id === threadId)?.nativeReadState?.revision;
                const needsResume = deps.resumedThreadById.value[threadId] !== true;
                const realtimeRevision = deps.realtimeRevisionByThreadId.get(threadId) ?? 0;
                const securityRevision = deps.securityObservation?.revision(threadId);
                const resumedThread = needsResume ? await resumeThread(threadId) : null;
                if (!isCurrent())
                    return;
                if (resumedThread && securityRevision !== undefined) deps.securityObservation?.accept(threadId,securityRevision,resumedThread.security ?? null);
                const detail = resumedThread ?? await getThreadDetail(threadId);
                if (!isCurrent())
                    return;
                const currentThread = flattenThreads(deps.sourceGroups.value).find(row => row.id === threadId);
                if ('nativeReadState' in detail && currentThread?.nativeReadState?.revision === observedReadRevision && currentThread) {
                    currentThread.nativeReadState = detail.nativeReadState;
                    deps.applyThreadFlags();
                }
                const currentActiveTurnId = deps.activeTurnIdByThreadId.value[threadId];
                let hasNewerTurnState = realtimeRevision !== (deps.realtimeRevisionByThreadId.get(threadId) ?? 0)
                    || (deps.inProgressById.value[threadId] === true && !detail.inProgress
                        && (currentActiveTurnId
                            ? !detail.messages.some((message) => message.turnId === currentActiveTurnId)
                            : Boolean(deps.pendingTurnRequestByThreadId.value[threadId])));
                if (detail.model || detail.modelProvider) {
                    deps.setThreadModelId(threadId, detail.model, detail.modelProvider);
                }
                if (resumedThread) {
                    deps.resumedThreadById.value = {
                        ...deps.resumedThreadById.value,
                        [threadId]: true,
                    };
                }
                const { inProgress, activeTurnId } = detail;
                const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? [];
                const previousIndices = deps.turnIndexByTurnIdByThreadId.value[threadId] ?? {};
                const freshEntries = Object.entries(detail.turnIndexByTurnId);
                const anchor = freshEntries.find(([id]) => Object.prototype.hasOwnProperty.call(previousIndices, id));
                const offset = anchor ? previousIndices[anchor[0]]! - anchor[1] : 0;
                const turnIndexByTurnId = Object.fromEntries(freshEntries.map(([id, index]) => [id, index + offset]));
                const nextMessages = offset ? detail.messages.map(message => message.turnId && typeof message.turnIndex === 'number'
                    ? { ...message, turnIndex: message.turnIndex + offset }
                    : message) : detail.messages;
                const firstFreshIndex = freshEntries.reduce((first, [, index]) => Math.min(first, index + offset), Infinity);
                // Relative positions are rebased on an overlapping native turn. A
                // disjoint or exhausted refresh starts a new pagination range.
                const earlierIndices = anchor && detail.olderCursor
                    ? Object.fromEntries(Object.entries(previousIndices).filter(([, index]) => index < firstFreshIndex))
                    : {};
                const retainsOlderPage = Object.keys(earlierIndices).length > 0;
                if (!retainsOlderPage && !(anchor && owner.olderCursor === null)) owner.olderCursor = detail.olderCursor;
                hasMoreOlderMessagesByThreadId.value = {
                    ...hasMoreOlderMessagesByThreadId.value,
                    [threadId]: Boolean(owner.olderCursor),
                };
                deps.markThreadMessagesPersisted(threadId, nextMessages);
                deps.replaceTurnIndexLookupForThread(threadId, { ...earlierIndices, ...turnIndexByTurnId });
                deps.rebindLiveFileChangeTurnIndices(threadId);
                const earlierMessages = previousPersisted.filter(message => message.turnId && Object.prototype.hasOwnProperty.call(earlierIndices, message.turnId));
                const isImported = (message: UiMessage) => message.importMetadata || message.id === `import-status-${threadId}`;
                const imported = nextMessages.filter(isImported);
                const latest = nextMessages.filter(message => !isImported(message));
                deps.setPersistedMessagesForThread(threadId, mergeMessages(previousPersisted, [...imported, ...earlierMessages, ...latest], {
                    preserveMissing: options.silent === true || hasOptimisticUserMessages(previousPersisted),
                }));
                const previousLiveAgent = deps.liveAgentMessagesByThreadId.value[threadId] ?? [];
                const nextLiveAgent = removeRedundantLiveAgentMessages(previousLiveAgent, nextMessages, {
                    preferSnapshotOnMismatch: reconnectingThreadHistory.has(threadId),
                });
                deps.setLiveAgentMessagesForThread(threadId, nextLiveAgent);
                deps.removeLiveCommandsPersistedIn(threadId, nextMessages);
                deps.removeLiveFileChangesPersistedIn(threadId, nextMessages);
                loadedMessagesByThreadId.value = {
                    ...loadedMessagesByThreadId.value,
                    [threadId]: true,
                };
                lastMessageLoadAtByThreadId.set(threadId, Date.now());
                lastMessageLoadFailureAtByThreadId.delete(threadId);
                if (deps.error.value === deps.connectionErrorMessage)
                    deps.error.value = '';
                if (!inProgress)
                    reconnectingThreadHistory.delete(threadId);
                if (version) {
                    loadedVersionByThreadId.value = {
                        ...loadedVersionByThreadId.value,
                        [threadId]: version,
                    };
                }
                if (!hasNewerTurnState) {
                    deps.setThreadInProgress(threadId, inProgress);
                    deps.clearTransientTurnErrorForThread(threadId);
                    if (activeTurnId) {
                        deps.activeTurnIdByThreadId.value = {
                            ...deps.activeTurnIdByThreadId.value,
                            [threadId]: activeTurnId,
                        };
                    }
                    else if (deps.activeTurnIdByThreadId.value[threadId]) {
                        deps.activeTurnIdByThreadId.value = omitKey(deps.activeTurnIdByThreadId.value, threadId);
                    }
                    if (!inProgress) {
                        deps.clearCompletedTurnLiveState(threadId);
                    }
                }
                if (observedReadRevision !== undefined)
                    deps.markThreadAsRead(threadId, observedReadRevision);
            }
            catch (unknownError) {
                if (!isCurrent())
                    throw unknownError;
                const message = unknownError instanceof Error ? unknownError.message : 'Unknown application error';
                if (deps.selectedThreadId.value === threadId) {
                    deps.setTurnErrorForThread(threadId, message, { transient: true });
                }
                lastMessageLoadFailureAtByThreadId.set(threadId, Date.now());
                throw unknownError;
            }
        })().finally(() => {
            if (isCurrent() && loadMessagePromiseByThreadId.get(threadId) === loadPromise) {
                loadMessagePromiseByThreadId.delete(threadId);
                visibleMessageLoads.delete(threadId);
                syncMessageLoading();
            }
        });
        loadMessagePromiseByThreadId.set(threadId, loadPromise);
        await loadPromise;
    }
    async function loadOlderMessages(threadId: string = deps.selectedThreadId.value): Promise<void> {
        const generation = deps.lifecycleGeneration;
        if (!threadId)
            return;
        const owner = historyReadOwner(threadId);
        const isCurrent = () => generation === deps.lifecycleGeneration && historyReadOwnerByThreadId.get(threadId) === owner;
        if (loadingOlderMessagesByThreadId.value[threadId] === true)
            return;
        const cursor = owner.olderCursor;
        if (!cursor) return;
        const previousIndices = deps.turnIndexByTurnIdByThreadId.value[threadId] ?? {};
        const firstIndex = Object.values(previousIndices).reduce((first, index) => Math.min(first, index), Infinity);
        loadingOlderMessagesByThreadId.value = {
            ...loadingOlderMessagesByThreadId.value,
            [threadId]: true,
        };
        try {
            const page = await getOlderThreadMessages(threadId, cursor, 10, Number.isFinite(firstIndex) ? firstIndex : 0);
            if (!isCurrent())
                return;
            const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? [];
            if (owner.olderCursor !== cursor) return;
            const isImported = (message: UiMessage) => message.importMetadata || message.id === `import-status-${threadId}`;
            const imported = previousPersisted.filter(isImported);
            const current = previousPersisted.filter(message => !isImported(message));
            const mergedMessages = mergeMessages(page.messages, current, { preserveMissing: true });
            deps.setPersistedMessagesForThread(threadId, [...imported, ...mergedMessages]);
            owner.olderCursor = page.olderCursor;
            deps.replaceTurnIndexLookupForThread(threadId, {
                ...(deps.turnIndexByTurnIdByThreadId.value[threadId] ?? {}),
                ...page.turnIndexByTurnId,
            });
            deps.rebindLiveFileChangeTurnIndices(threadId);
            hasMoreOlderMessagesByThreadId.value = {
                ...hasMoreOlderMessagesByThreadId.value,
                [threadId]: Boolean(owner.olderCursor),
            };
        }
        catch (loadError) {
            if (!isCurrent())
                throw loadError;
            deps.error.value = loadError instanceof Error ? loadError.message : 'Failed to load earlier messages';
            throw loadError;
        }
        finally {
            if (isCurrent())
                loadingOlderMessagesByThreadId.value = {
                    ...loadingOlderMessagesByThreadId.value,
                    [threadId]: false,
                };
        }
    }
    async function ensureThreadMessagesLoaded(threadId: string, options: {
        silent?: boolean;
    } = {}): Promise<void> {
        if (!threadId)
            return;
        if (loadedMessagesByThreadId.value[threadId] === true)
            return;
        if (options.silent === true && deps.turnErrorByThreadId.value[threadId]?.transient)
            return;
        await loadMessages(threadId, options);
    }
    return {
persistedMessagesByThreadId,
loadedVersionByThreadId,
loadedMessagesByThreadId,
hasMoreOlderMessagesByThreadId,
loadingOlderMessagesByThreadId,
isLoadingMessages,
visibleMessageLoads,
syncMessageLoading,
loadMessagePromiseByThreadId,
reconnectingThreadHistory,
historyReadOwnerByThreadId,
historyReadOwner,
invalidateThreadHistory,
lastMessageLoadAtByThreadId,
lastMessageLoadFailureAtByThreadId,
loadMessages,
loadOlderMessages,
ensureThreadMessagesLoaded
};
}
