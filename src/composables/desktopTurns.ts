import type { ComputedRef, Ref } from 'vue';
import { ref } from 'vue';
import { CodexApiError } from '../api/codexErrors';
import { getThreadDetail, interruptThreadTurn, resumeThread, startThread, startThreadTurn } from '../api/codexGateway';
import { modelSelectionKey, parseModelSelection } from '../api/modelCapabilities';
import type { CollaborationModeKind, ReasoningEffort, SpeedMode, UiMessage } from '../types/codex';
import { createDesktopApprovals } from './desktopApprovals';
import { createDesktopHistory } from './desktopHistory';
import { type TurnActivityState } from './desktopNotificationReaders';
import { NEW_THREAD_COLLABORATION_MODE_CONTEXT } from './desktopStatePersistence';
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
/** Owns submission indicators, pending turn requests and uncertain outcomes. The desktop lifecycle invalidates publication through lifecycleGeneration; accepted operations retain the existing no-replay behavior. */
export function createDesktopTurns(deps: {
    selectedCollaborationMode: Ref<CollaborationModeKind>;
    selectedSpeedMode: Ref<SpeedMode>;
    approvals: ReturnType<typeof createDesktopApprovals>;
    lifecycleGeneration: number;
    readModelIdForThread: (threadId: string) => string;
    selectedThreadId: Ref<string, string>;
    selectedReasoningEffort: ComputedRef<string>;
    isUpdatingSpeedMode: Ref<boolean, boolean>;
    history: ReturnType<typeof createDesktopHistory>;
    inProgressById: Ref<Record<string, boolean>>;
    appendOptimisticUserMessage: (threadId: string, text: string, imageUrls?: string[], skills?: Array<{
        name: string;
        path: string;
    }>, fileAttachments?: FileAttachment[]) => string;
    setTurnErrorForThread: (threadId: string, message: string | null, options?: {
        transient?: boolean;
    }) => void;
    error: Ref<string, string>;
    setTurnSummaryForThread: (threadId: string, summary: TurnSummaryState | null) => void;
    setTurnActivityForThread: (threadId: string, activity: TurnActivityState | null) => void;
    setThreadInProgress: (threadId: string, nextInProgress: boolean) => void;
    activeTurnIdByThreadId: Ref<Record<string, string>>;
    readReasoningEffortForThread: (threadId: string) => ReasoningEffort | "";
    setThreadModelId: (threadId: string, modelId: string, provider?: string) => void;
    setSelectedCollaborationModeForThread: (threadId: string, mode: CollaborationModeKind) => void;
    insertOptimisticThread: (threadId: string, cwd: string, firstMessageText: string, projectId?: string | null) => void;
    blockInterruptUntilThreadIsPersisted: (threadId: string) => void;
    resumedThreadById: Ref<Record<string, boolean>>;
    setSelectedThreadId: (nextThreadId: string, options?: {
        persist?: boolean;
    }) => void;
    realtimeRevisionByThreadId: Map<string, number>;
    recordModelUsage: (modelId: string) => void;
    setPersistedMessagesForThread: (threadId: string, nextMessages: UiMessage[]) => void;
    maybeUnblockInterruptForActiveTurn: (threadId: string, turnId: string) => void;
    pendingThreadMessageRefresh: Set<string>;
    syncFromNotifications: () => Promise<void>;
    scheduleDelayedTurnSync: (threadId: string) => void;
    interruptBlockedUntilPersistedByThreadId: Ref<Record<string, boolean>>;
    pendingThreadsRefresh: boolean;
}) {
    const unknownOutcomeByThreadId = ref<Record<string, boolean>>({});
    const pendingTurnRequestByThreadId = ref<Record<string, PendingTurnRequest>>({});
    const isSendingMessage = ref(false);
    const isInterruptingTurn = ref(false);
    function setPendingTurnRequest(threadId: string, request: PendingTurnRequest): void {
        pendingTurnRequestByThreadId.value = {
            ...pendingTurnRequestByThreadId.value,
            [threadId]: request,
        };
    }
    function clearPendingTurnRequest(threadId: string): void {
        if (!pendingTurnRequestByThreadId.value[threadId])
            return;
        pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId);
    }
    function buildPendingTurnDetails(modelId: string, effort: ReasoningEffort | '', collaborationMode: CollaborationModeKind = deps.selectedCollaborationMode.value): string[] {
        const selection = parseModelSelection(modelId);
        const modelLabel = selection.provider ? `${selection.provider} — ${selection.model}` : selection.model || 'default';
        const effortLabel = effort || 'default';
        const modeLabel = collaborationMode === 'plan' ? 'Plan' : 'Default';
        const speedLabel = deps.selectedSpeedMode.value === 'fast' ? 'Fast' : 'Standard';
        return [`Mode: ${modeLabel}`, `Model: ${modelLabel}`, `Thinking: ${effortLabel}`, `Speed: ${speedLabel}`];
    }
    async function maybeReplyToPendingUserInputRequest(threadId: string, text: string, imageUrls: string[] = [], skills: Array<{
        name: string;
        path: string;
    }> = [], fileAttachments: FileAttachment[] = []): Promise<boolean> {
        if (!threadId || !text.trim())
            return false;
        if (imageUrls.length > 0 || skills.length > 0 || fileAttachments.length > 0)
            return false;
        const requests = deps.approvals.pendingServerRequestsByThreadId.value[threadId] ?? [];
        const userInputRequests = requests.filter((request) => request.method === 'item/tool/requestUserInput');
        if (userInputRequests.length !== 1)
            return false;
        const [request] = userInputRequests;
        const questionIds = deps.approvals.readToolRequestUserInputQuestionIds(request);
        if (questionIds.length !== 1)
            return false;
        return deps.approvals.respondToPendingServerRequest({
            id: request.id,
            result: {
                answers: {
                    [questionIds[0]]: {
                        answers: [text.trim()],
                    },
                },
            },
        });
    }
    async function sendMessageToSelectedThread(text: string, imageUrls: string[] = [], skills: Array<{
        name: string;
        path: string;
    }> = [], fileAttachments: FileAttachment[] = [], collaborationModeOverride?: CollaborationModeKind): Promise<void> {
        const generation = deps.lifecycleGeneration;
        const submissionContext = { generation, speedMode: deps.selectedSpeedMode.value, modelId: deps.readModelIdForThread(deps.selectedThreadId.value), reasoningEffort: deps.selectedReasoningEffort.value };
        if (deps.isUpdatingSpeedMode.value)
            return;
        let threadId = deps.selectedThreadId.value;
        const nextText = text.trim();
        if (deps.history.persistedMessagesByThreadId.value[threadId]?.some(message => message.id === `import-status-${threadId}`)) {
            throw new Error('This conversation import is incomplete. Inspect the destination; do not replay injection.');
        }
        if (!threadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0))
            return;
        const submittedMode = collaborationModeOverride ?? deps.selectedCollaborationMode.value;
        if (await maybeReplyToPendingUserInputRequest(threadId, nextText, imageUrls, skills, fileAttachments)) {
            return;
        }
        if (generation !== deps.lifecycleGeneration) {
            await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, submittedMode, undefined, submissionContext);
            return;
        }
        const isInProgress = deps.inProgressById.value[threadId] === true;
        const optimisticMessageId = deps.appendOptimisticUserMessage(threadId, nextText, imageUrls, skills, fileAttachments);
        if (isInProgress) {
            void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, submittedMode, optimisticMessageId, submissionContext).catch((unknownError) => {
                if (generation !== deps.lifecycleGeneration)
                    return;
                const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error';
                deps.setTurnErrorForThread(threadId, errorMessage);
                deps.error.value = errorMessage;
            });
            return;
        }
        deps.error.value = '';
        deps.setTurnSummaryForThread(threadId, null);
        deps.setTurnActivityForThread(threadId, {
            label: 'Thinking',
            details: buildPendingTurnDetails(deps.readModelIdForThread(threadId), deps.selectedReasoningEffort.value, collaborationModeOverride === 'plan'
                ? 'plan'
                : collaborationModeOverride === 'default'
                    ? 'default'
                    : deps.selectedCollaborationMode.value),
        });
        deps.setTurnErrorForThread(threadId, null);
        deps.setThreadInProgress(threadId, true);
        try {
            await startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, submittedMode, optimisticMessageId, submissionContext);
        }
        catch (unknownError) {
            if (generation !== deps.lifecycleGeneration)
                throw unknownError;
            deps.setThreadInProgress(threadId, false);
            deps.setTurnActivityForThread(threadId, null);
            clearPendingTurnRequest(threadId);
            if (deps.activeTurnIdByThreadId.value[threadId]) {
                deps.activeTurnIdByThreadId.value = omitKey(deps.activeTurnIdByThreadId.value, threadId);
            }
            const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error';
            deps.setTurnErrorForThread(threadId, errorMessage);
            deps.error.value = errorMessage;
            throw unknownError;
        }
    }
    async function sendMessageToNewThread(text: string, cwd: string, imageUrls: string[] = [], skills: Array<{
        name: string;
        path: string;
    }> = [], fileAttachments: FileAttachment[] = [], projectId?: string): Promise<string> {
        const generation = deps.lifecycleGeneration;
        if (deps.isUpdatingSpeedMode.value)
            return '';
        const nextText = text.trim();
        const targetCwd = cwd.trim();
        if (!targetCwd) {
            deps.error.value = 'Select an existing workspace before starting a conversation.';
            return '';
        }
        const selectedModel = deps.readModelIdForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT).trim();
        const reasoningEffort = deps.readReasoningEffortForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT);
        const selectedMode = deps.selectedCollaborationMode.value;
        const speedMode = deps.selectedSpeedMode.value;
        if (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)
            return '';
        isSendingMessage.value = true;
        deps.error.value = '';
        let threadId = '';
        try {
            const selection = parseModelSelection(selectedModel);
            const startedThread = selection.provider
                ? await startThread(targetCwd, selection.model || undefined, selection.provider, ...(projectId ? [projectId] : []))
                : projectId ? await startThread(targetCwd, selection.model || undefined, undefined, projectId) : await startThread(targetCwd, selection.model || undefined);
            threadId = startedThread.threadId;
            const submissionModel = modelSelectionKey(startedThread.modelProvider || parseModelSelection(selectedModel).provider, startedThread.model?.trim() || parseModelSelection(selectedModel).model);
            const submissionContext = { generation, speedMode, modelId: submissionModel, reasoningEffort, resumed: true };
            if (generation !== deps.lifecycleGeneration) {
                if (threadId) {
                    void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, selectedMode, undefined, submissionContext).catch(() => {
                        // The server submission continues, but this lifecycle no longer owns UI errors.
                    });
                }
                return threadId;
            }
            deps.setThreadModelId(threadId, submissionModel);
            deps.setSelectedCollaborationModeForThread(threadId, selectedMode);
            if (!threadId)
                return '';
            deps.insertOptimisticThread(threadId, targetCwd, nextText || '[Image]', startedThread.projectId ?? projectId);
            const optimisticMessageId = deps.appendOptimisticUserMessage(threadId, nextText, imageUrls, skills, fileAttachments);
            deps.blockInterruptUntilThreadIsPersisted(threadId);
            deps.resumedThreadById.value = {
                ...deps.resumedThreadById.value,
                [threadId]: true,
            };
            deps.setSelectedThreadId(threadId);
            deps.setTurnSummaryForThread(threadId, null);
            deps.setTurnActivityForThread(threadId, {
                label: 'Thinking',
                details: buildPendingTurnDetails(deps.readModelIdForThread(threadId), deps.selectedReasoningEffort.value, selectedMode),
            });
            deps.setTurnErrorForThread(threadId, null);
            deps.setThreadInProgress(threadId, true);
            void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, selectedMode, optimisticMessageId, submissionContext)
                .catch((unknownError) => {
                if (generation !== deps.lifecycleGeneration)
                    return;
                deps.setThreadInProgress(threadId, false);
                deps.setTurnActivityForThread(threadId, null);
                clearPendingTurnRequest(threadId);
                if (deps.activeTurnIdByThreadId.value[threadId]) {
                    deps.activeTurnIdByThreadId.value = omitKey(deps.activeTurnIdByThreadId.value, threadId);
                }
                const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error';
                deps.setTurnErrorForThread(threadId, errorMessage);
                deps.error.value = errorMessage;
            })
                .finally(() => {
                if (generation === deps.lifecycleGeneration)
                    isSendingMessage.value = false;
            });
            return threadId;
        }
        catch (unknownError) {
            if (generation !== deps.lifecycleGeneration)
                throw unknownError;
            if (threadId) {
                deps.setThreadInProgress(threadId, false);
                deps.setTurnActivityForThread(threadId, null);
            }
            const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error';
            if (threadId) {
                deps.setTurnErrorForThread(threadId, errorMessage);
            }
            deps.error.value = errorMessage;
            isSendingMessage.value = false;
            throw unknownError;
        }
    }
    async function startTurnForThread(threadId: string, nextText: string, imageUrls: string[] = [], skills: Array<{
        name: string;
        path: string;
    }> = [], fileAttachments: FileAttachment[] = [], collaborationModeOverride?: CollaborationModeKind, optimisticMessageId?: string, context: {
        generation: number;
        modelId: string;
        reasoningEffort: ReasoningEffort | '';
        speedMode?: SpeedMode;
        resumed?: boolean;
    } = {
        generation: deps.lifecycleGeneration,
        modelId: deps.readModelIdForThread(threadId),
        reasoningEffort: deps.selectedReasoningEffort.value,
        speedMode: deps.selectedSpeedMode.value,
    }): Promise<void> {
        const generation = context.generation;
        if (generation === deps.lifecycleGeneration)
            deps.realtimeRevisionByThreadId.set(threadId, (deps.realtimeRevisionByThreadId.get(threadId) ?? 0) + 1);
        const collaborationMode = collaborationModeOverride === 'plan' ? 'plan' : collaborationModeOverride === 'default'
            ? 'default'
            : deps.selectedCollaborationMode.value;
        const normalizedText = nextText.trim();
        const normalizedImageUrls = [...imageUrls];
        const normalizedSkills = skills.map((skill) => ({ name: skill.name, path: skill.path }));
        const normalizedFileAttachments = fileAttachments.map((file) => ({ ...file }));
        if (generation === deps.lifecycleGeneration)
            setPendingTurnRequest(threadId, {
                text: normalizedText,
                imageUrls: [...normalizedImageUrls],
                skills: normalizedSkills,
                fileAttachments: normalizedFileAttachments,
                effort: context.reasoningEffort,
                collaborationMode,
            });
        const ownsAttempt = () => generation === deps.lifecycleGeneration;
        let submissionAttempted = false;
        let submissionAccepted = false;
        try {
            let modelId = context.modelId;
            if (!context.resumed && deps.resumedThreadById.value[threadId] !== true) {
                const resumedThread = await resumeThread(threadId);
                if (generation === deps.lifecycleGeneration) {
                    if (resumedThread.model || resumedThread.modelProvider) {
                        deps.setThreadModelId(threadId, resumedThread.model, resumedThread.modelProvider);
                    }
                    deps.resumedThreadById.value = {
                        ...deps.resumedThreadById.value,
                        [threadId]: true,
                    };
                }
            }
            if (generation === deps.lifecycleGeneration)
                modelId = deps.readModelIdForThread(threadId);
            const reasoningEffort = modelId === context.modelId ? context.reasoningEffort : deps.readReasoningEffortForThread(threadId);
            // Submit exactly once even if disposal occurred while resuming the server thread.
            if (generation === deps.lifecycleGeneration)
                deps.recordModelUsage(modelId);
            submissionAttempted = true;
            const startedTurnId = await startThreadTurn(threadId, nextText, normalizedImageUrls, modelId || undefined, reasoningEffort || undefined, skills.length > 0 ? skills : undefined, fileAttachments, collaborationMode, context.speedMode ?? deps.selectedSpeedMode.value);
            submissionAccepted = true;
            if (!ownsAttempt())
                return;
            if (startedTurnId) {
                if (optimisticMessageId) {
                    const messages = deps.history.persistedMessagesByThreadId.value[threadId] ?? [];
                    deps.setPersistedMessagesForThread(threadId, messages.map((message) => message.id === optimisticMessageId
                        ? { ...message, turnId: startedTurnId }
                        : message));
                }
                deps.activeTurnIdByThreadId.value = {
                    ...deps.activeTurnIdByThreadId.value,
                    [threadId]: startedTurnId,
                };
                deps.maybeUnblockInterruptForActiveTurn(threadId, startedTurnId);
            }
            deps.pendingThreadMessageRefresh.add(threadId);
            await deps.syncFromNotifications();
            if (generation === deps.lifecycleGeneration)
                deps.scheduleDelayedTurnSync(threadId);
        }
        catch (unknownError) {
            if (!ownsAttempt())
                throw unknownError;
            const ambiguous = unknownError instanceof Error && /disconnected|outcome unknown/i.test(unknownError.message)
                || unknownError instanceof CodexApiError && (['network_error', 'invalid_response'].includes(unknownError.code) || (unknownError.status ?? 0) >= 500);
            if (generation === deps.lifecycleGeneration && submissionAttempted && !submissionAccepted && ambiguous) {
                unknownOutcomeByThreadId.value = { ...unknownOutcomeByThreadId.value, [threadId]: true };
            }
            throw unknownError;
        }
    }
    async function interruptSelectedThreadTurn(): Promise<void> {
        const threadId = deps.selectedThreadId.value;
        if (!threadId)
            return;
        if (deps.inProgressById.value[threadId] !== true)
            return;
        if (deps.interruptBlockedUntilPersistedByThreadId.value[threadId] === true)
            return;
        let turnId = deps.activeTurnIdByThreadId.value[threadId];
        if (!turnId) {
            const { activeTurnId } = await getThreadDetail(threadId);
            turnId = activeTurnId;
            if (turnId) {
                deps.activeTurnIdByThreadId.value = {
                    ...deps.activeTurnIdByThreadId.value,
                    [threadId]: turnId,
                };
            }
        }
        if (!turnId) {
            throw new Error('Could not determine active turn id for interrupt');
        }
        isInterruptingTurn.value = true;
        deps.error.value = '';
        try {
            await interruptThreadTurn(threadId, turnId);
            deps.setThreadInProgress(threadId, false);
            deps.setTurnActivityForThread(threadId, null);
            deps.setTurnErrorForThread(threadId, null);
            if (deps.activeTurnIdByThreadId.value[threadId]) {
                deps.activeTurnIdByThreadId.value = omitKey(deps.activeTurnIdByThreadId.value, threadId);
            }
            deps.pendingThreadMessageRefresh.add(threadId);
            deps.pendingThreadsRefresh = true;
            await deps.syncFromNotifications();
        }
        catch (unknownError) {
            const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn';
            deps.setTurnErrorForThread(threadId, errorMessage);
            deps.error.value = errorMessage;
        }
        finally {
            isInterruptingTurn.value = false;
        }
    }
    return {
        unknownOutcomeByThreadId,
        pendingTurnRequestByThreadId,
        isSendingMessage,
        isInterruptingTurn,
        setPendingTurnRequest,
        clearPendingTurnRequest,
        buildPendingTurnDetails,
        maybeReplyToPendingUserInputRequest,
        sendMessageToSelectedThread,
        sendMessageToNewThread,
        startTurnForThread,
        interruptSelectedThreadTurn
    };
}
