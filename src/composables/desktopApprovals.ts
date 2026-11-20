import type { QuestionResponse } from '../questionResponses';
import type { Ref } from 'vue';
import { ref } from 'vue';
import { getPendingServerRequests, replyToServerRequest, type RpcNotification } from '../api/codexGateway';
import type { UiPendingRequestState, UiServerRequest, UiServerRequestReply } from '../types/codex';
import { asRecord, normalizePendingServerRequestMethod, readString } from './desktopNotificationReaders';
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__';
/** Owns pending approvals and response correlation. No subscription or timer. The desktop lifecycle invalidates pending reads through lifecycleGeneration. */
export function createDesktopApprovals(deps: {
    applyThreadFlags: () => void;
    lifecycleGeneration: number;
    retainQuestionResponse: (response: QuestionResponse) => void;
    error: Ref<string, string>;
}) {
    const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({});
    let pendingServerRequestsVersion = 0;
    const questionAttempts = ref<Record<number, { error?: string }>>({});
    const questionSaveWarning = ref<{ threadId: string; message: string } | null>(null);
    const closedRequestIds = new Set<number>();
    function rememberClosed(id: number): void {
        closedRequestIds.add(id);
        if (closedRequestIds.size > 400) closedRequestIds.delete(closedRequestIds.values().next().value!);
        const next = { ...questionAttempts.value };
        delete next[id];
        questionAttempts.value = next;
        removePendingServerRequestById(id);
    }
    function confirmQuestionResponses(responses: QuestionResponse[]): void {
        const confirmed = new Set(responses.map(response => response.id));
        for (const requests of Object.values(pendingServerRequestsByThreadId.value)) {
            for (const request of requests) {
                if (request.responseId && confirmed.has(request.responseId)) rememberClosed(request.id);
            }
        }
    }
    function dismissQuestionDraft(id: number): void {
        if (questionAttempts.value[id]?.error) rememberClosed(id);
    }
    function getThreadPendingRequests(threadId: string): UiServerRequest[] {
        if (!threadId)
            return [];
        return Array.isArray(pendingServerRequestsByThreadId.value[threadId])
            ? pendingServerRequestsByThreadId.value[threadId]
            : [];
    }
    function isApprovalRequestMethod(method: string): boolean {
        return (method === 'item/commandExecution/requestApproval' ||
            method === 'item/fileChange/requestApproval' ||
            method === 'item/permissions/requestApproval' ||
            method === 'execCommandApproval' ||
            method === 'applyPatchApproval');
    }
    function readPendingRequestState(requests: UiServerRequest[]): UiPendingRequestState | null {
        if (requests.some((request) => isApprovalRequestMethod(request.method))) {
            return 'approval';
        }
        return requests.length > 0 ? 'response' : null;
    }
    function normalizeServerRequest(params: unknown): UiServerRequest | null {
        const row = asRecord(params);
        if (!row)
            return null;
        const id = row.id;
        const rawMethod = readString(row.method);
        const requestParams = row.params;
        if (typeof id !== 'number' || !Number.isInteger(id) || !rawMethod) {
            return null;
        }
        const requestParamRecord = asRecord(requestParams);
        const method = normalizePendingServerRequestMethod(rawMethod, requestParamRecord);
        const threadId = (readString(requestParamRecord?.threadId) ||
            readString(requestParamRecord?.thread_id) ||
            readString(requestParamRecord?.conversationId) ||
            readString(requestParamRecord?.conversation_id) ||
            GLOBAL_SERVER_REQUEST_SCOPE);
        const turnId = readString(requestParamRecord?.turnId) || readString(requestParamRecord?.turn_id);
        const itemId = (readString(requestParamRecord?.itemId) ||
            readString(requestParamRecord?.item_id) ||
            readString(requestParamRecord?.callId) ||
            readString(requestParamRecord?.call_id));
        const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString();
        return {
            id,
            method,
            threadId,
            turnId,
            itemId,
            receivedAtIso,
            ...(readString(row.responseId) ? { responseId: readString(row.responseId) } : {}),
            ...(row.answerAttempted === true ? { answerAttempted: true } : {}),
            params: requestParams ?? null,
        };
    }
    function readToolRequestUserInputQuestionIds(request: UiServerRequest): string[] {
        if (request.method !== 'item/tool/requestUserInput')
            return [];
        const params = asRecord(request.params);
        const questions = Array.isArray(params?.questions) ? params.questions : [];
        const questionIds: string[] = [];
        for (const row of questions) {
            const question = asRecord(row);
            const id = readString(question?.id).trim();
            if (id) {
                questionIds.push(id);
            }
        }
        return questionIds;
    }
    function upsertPendingServerRequest(request: UiServerRequest): void {
        const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE;
        const current = pendingServerRequestsByThreadId.value[threadId] ?? [];
        const index = current.findIndex((row) => row.id === request.id);
        const nextRows = [...current];
        if (index >= 0) {
            nextRows.splice(index, 1, request);
        }
        else {
            nextRows.push(request);
        }
        pendingServerRequestsByThreadId.value = {
            ...pendingServerRequestsByThreadId.value,
            [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
        };
        deps.applyThreadFlags();
    }
    function removePendingServerRequestById(requestId: number): void {
        const next: Record<string, UiServerRequest[]> = {};
        for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
            const filtered = requests.filter((request) => request.id !== requestId);
            if (filtered.length > 0) {
                next[threadId] = filtered;
            }
        }
        pendingServerRequestsByThreadId.value = next;
        deps.applyThreadFlags();
    }
    function replacePendingServerRequests(requests: UiServerRequest[]): void {
        const next: Record<string, UiServerRequest[]> = {};
        const incoming = new Set(requests.map(request => request.id));
        const drafts = Object.values(pendingServerRequestsByThreadId.value).flat().filter(request =>
            questionAttempts.value[request.id] && !incoming.has(request.id));
        for (const request of [...requests, ...drafts]) {
            const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE;
            const current = next[threadId] ?? [];
            current.push(request);
            next[threadId] = current;
        }
        for (const rows of Object.values(next)) {
            rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso));
        }
        pendingServerRequestsByThreadId.value = next;
    }
    function handleServerRequestNotification(notification: RpcNotification): boolean {
        if (notification.method === 'server/request') {
            const request = normalizeServerRequest(notification.params);
            if (!request || closedRequestIds.has(request.id))
                return true;
            upsertPendingServerRequest(request);
            return true;
        }
        if (notification.method === 'server/request/resolved') {
            const row = asRecord(notification.params);
            const id = row?.id;
            if (typeof id === 'number' && Number.isInteger(id)) {
                const response = row?.response as QuestionResponse | undefined;
                if (response) deps.retainQuestionResponse(response);
                if (response || !questionAttempts.value[id]) rememberClosed(id);
            }
            return true;
        }
        return false;
    }
    async function loadPendingServerRequestsFromBridge(): Promise<void> {
        const generation = deps.lifecycleGeneration;
        const version = ++pendingServerRequestsVersion;
        try {
            const rows = await getPendingServerRequests();
            if (generation !== deps.lifecycleGeneration || version !== pendingServerRequestsVersion)
                return;
            const normalizedRequests = rows
                .map((row) => normalizeServerRequest(row))
                .filter((request): request is UiServerRequest => request !== null && !closedRequestIds.has(request.id));
            replacePendingServerRequests(normalizedRequests);
        }
        catch {
            // Keep UI usable when pending request endpoint is temporarily unavailable.
        }
    }
    async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<boolean> {
        const generation = deps.lifecycleGeneration;
        const request = Object.values(pendingServerRequestsByThreadId.value).flat().find(row => row.id === reply.id);
        const isQuestion = request?.method === 'item/tool/requestUserInput';
        if (isQuestion && (request.answerAttempted || questionAttempts.value[reply.id])) return false;
        if (isQuestion) {
            questionSaveWarning.value = null;
            questionAttempts.value = { ...questionAttempts.value, [reply.id]: {} };
        }
        try {
            const submission = await replyToServerRequest(reply.id, {
                result: reply.result,
                error: reply.error,
            });
            if (isQuestion && !submission) throw new Error('Question reply could not be confirmed. Your draft is kept.');
            if (generation !== deps.lifecycleGeneration) return true;
            rememberClosed(reply.id);
            if (submission) {
                deps.retainQuestionResponse(submission.response);
                if (!submission.saved) {
                    const message = 'Answer submitted. WebUI could not save it to history.';
                    questionSaveWarning.value = { threadId: submission.response.threadId, message };
                }
            }
            return true;
        }
        catch (unknownError) {
            if (generation !== deps.lifecycleGeneration)
                return false;
            const message = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request';
            if (isQuestion && closedRequestIds.has(reply.id)) return true;
            if (isQuestion) questionAttempts.value = { ...questionAttempts.value, [reply.id]: { error: message } };
            deps.error.value = message;
            return false;
        }
    }
    return {
questionAttempts,
questionSaveWarning,
confirmQuestionResponses,
dismissQuestionDraft,
clearPendingAfterDisconnect: () => replacePendingServerRequests([]),
pendingServerRequestsByThreadId,
getThreadPendingRequests,
readPendingRequestState,
readToolRequestUserInputQuestionIds,
handleServerRequestNotification,
loadPendingServerRequestsFromBridge,
respondToPendingServerRequest
};
}
