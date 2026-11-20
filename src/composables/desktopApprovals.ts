import {
    QUESTION_REPLY_NOT_SENT, QUESTION_REPLY_UNCONFIRMED, type QuestionDraft, type QuestionResponse, type QuestionSubmission,
} from '../questionResponses';
import { normalizePendingServerRequestMethod, QUESTION_REQUEST } from '../serverRequestMethod';
import { CodexApiError } from '../api/codexErrors';
import type { Ref } from 'vue';
import { reactive, ref } from 'vue';
import { getPendingServerRequests, replyToServerRequest, type RpcNotification } from '../api/codexGateway';
import type { UiPendingRequestState, UiServerRequest, UiServerRequestReply } from '../types/codex';
import { asRecord, readString } from './desktopNotificationReaders';
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__';
/** Owns pending approvals and response correlation. No subscription or timer. The desktop lifecycle invalidates pending reads through lifecycleGeneration. */
export function createDesktopApprovals(deps: {
    applyThreadFlags: () => void;
    lifecycleGeneration: number;
    retainQuestionResponse: (response: QuestionResponse) => void;
    onNewPendingRequest?: (threadId: string) => void;
    error: Ref<string, string>;
}) {
    const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({});
    let pendingServerRequestsVersion = 0;
    const questionDrafts = reactive(new Map<string, Map<string | number, QuestionDraft>>());
    const questionSaveWarnings = reactive(new Map<string, string>());
    const closedRequestIds = new Set<number>();
    const nativeClosedQuestionIds = new Set<number>();
    const seenRequestIds = new Set<number>();
    let requestsDuringLoad: Map<number, UiServerRequest> | undefined;

    function rememberId(ids: Set<number>, id: number): void {
        ids.add(id);
        if (ids.size > 400) ids.delete(ids.values().next().value!);
    }
    function questionDraftKey(request: UiServerRequest): string | number {
        return request.responseId ?? request.id;
    }
    function readQuestionDraft(request: UiServerRequest): QuestionDraft | undefined {
        return questionDrafts.get(request.threadId)?.get(questionDraftKey(request));
    }
    function shouldKeepClosedQuestionDraft(request: UiServerRequest): boolean {
        const draft = readQuestionDraft(request);
        if (!draft) return false;
        if (draft.attempt && !draft.attempt.retryable) return true;
        for (const { choice, text } of draft.fields.values()) {
            if (choice || text?.trim()) return true;
        }
        return false;
    }
    function ensureQuestionDraft(request: UiServerRequest): QuestionDraft {
        if (!questionDrafts.has(request.threadId)) questionDrafts.set(request.threadId, new Map());
        const drafts = questionDrafts.get(request.threadId)!;
        const key = questionDraftKey(request);
        if (!drafts.has(key)) drafts.set(key, { fields: new Map() });
        return drafts.get(key)!;
    }
    function updateQuestionDraft(request: UiServerRequest, questionId: string, field: 'choice' | 'text', value: string): void {
        if (request.questionClosed) return;
        const draft = ensureQuestionDraft(request);
        draft.fields.set(questionId, { ...draft.fields.get(questionId), [field]: value });
    }
    function clearQuestionDraft(threadId: string, key: string | number): void {
        const drafts = questionDrafts.get(threadId);
        drafts?.delete(key);
        if (drafts?.size === 0) questionDrafts.delete(threadId);
    }
    function removeRequestAndDraft(id: number, request: UiServerRequest | undefined): void {
        if (request) clearQuestionDraft(request.threadId, questionDraftKey(request));
        removePendingServerRequestById(id);
    }
    function rememberClosed(id: number, request = findPendingRequest(id)): void {
        rememberId(closedRequestIds, id);
        removeRequestAndDraft(id, request);
    }
    function confirmQuestionResponses(responses: QuestionResponse[]): void {
        for (const response of responses) {
            clearQuestionDraft(response.threadId, response.id);
            for (const request of getThreadRequests(response.threadId)) {
                if (request.responseId === response.id) rememberClosed(request.id, request);
            }
        }
    }
    function findPendingRequest(id: number): UiServerRequest | undefined {
        for (const rows of Object.values(pendingServerRequestsByThreadId.value)) {
            const request = rows.find(row => row.id === id);
            if (request) return request;
        }
    }
    function dismissQuestionDraft(id: number): void {
        const request = findPendingRequest(id);
        if (!request || request.method !== QUESTION_REQUEST) return;
        const attempt = readQuestionDraft(request)?.attempt;
        if (!request.questionClosed && (!attempt?.retryable || request.answerAttempted)) return;
        clearQuestionDraft(request.threadId, questionDraftKey(request));
        if (request.questionClosed) {
            // Keep accepting a confirmation from the original HTTP reply after dismissal.
            rememberId(nativeClosedQuestionIds, id);
            removePendingServerRequestById(id);
        }
        if (attempt?.error && deps.error.value === attempt.error) deps.error.value = '';
    }
    function clearThreadQuestions(threadId: string): void {
        questionDrafts.delete(threadId);
        for (const request of getThreadRequests(threadId)) {
            if (request.method === QUESTION_REQUEST) rememberClosed(request.id, request);
        }
        questionSaveWarnings.delete(threadId);
    }
    function clearQuestionState(): void {
        requestsDuringLoad = undefined;
        for (const threadId of Object.keys(pendingServerRequestsByThreadId.value)) clearThreadQuestions(threadId);
        questionDrafts.clear();
        nativeClosedQuestionIds.clear();
        closedRequestIds.clear();
        seenRequestIds.clear();
        questionSaveWarnings.clear();
    }
    function getThreadRequests(threadId: string): UiServerRequest[] {
        if (!threadId)
            return [];
        return Array.isArray(pendingServerRequestsByThreadId.value[threadId])
            ? pendingServerRequestsByThreadId.value[threadId]
            : [];
    }
    function getThreadPendingRequests(threadId: string): UiServerRequest[] {
        return getThreadRequests(threadId).filter(request => !request.questionClosed);
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
        return requests.some(request => !request.questionClosed) ? 'response' : null;
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
        if (request.method !== QUESTION_REQUEST)
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
        const index = current.findIndex(row => row.id === request.id ||
            (row.questionClosed && request.responseId && row.responseId === request.responseId));
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
        requestsDuringLoad?.delete(requestId);
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
        const incoming = new Set(requests.map(request => JSON.stringify([request.threadId, questionDraftKey(request)])));
        const drafts: UiServerRequest[] = [];
        for (const rows of Object.values(pendingServerRequestsByThreadId.value)) {
            for (const request of rows) {
                const key = questionDraftKey(request);
                if (request.method !== QUESTION_REQUEST || incoming.has(JSON.stringify([request.threadId, key]))) continue;
                if (shouldKeepClosedQuestionDraft(request)) drafts.push({ ...request, questionClosed: true });
                else clearQuestionDraft(request.threadId, key);
            }
        }
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
            if (!request || closedRequestIds.has(request.id) || nativeClosedQuestionIds.has(request.id))
                return true;
            const existing = getThreadRequests(request.threadId).find(row => row.id === request.id);
            const duplicate = seenRequestIds.has(request.id) || Boolean(existing);
            const attempt = request.method === QUESTION_REQUEST ? readQuestionDraft(request)?.attempt : undefined;
            rememberId(seenRequestIds, request.id);
            if (existing?.answerAttempted) request.answerAttempted = true;
            requestsDuringLoad?.set(request.id, request);
            upsertPendingServerRequest(request);
            if (!duplicate && !request.answerAttempted && (!attempt || attempt.retryable) && request.threadId !== GLOBAL_SERVER_REQUEST_SCOPE) {
                deps.onNewPendingRequest?.(request.threadId);
            }
            return true;
        }
        if (notification.method === 'server/request/resolved') {
            const row = asRecord(notification.params);
            const id = row?.id;
            if (typeof id === 'number' && Number.isInteger(id)) {
                const response = row?.response as QuestionResponse | undefined;
                const request = findPendingRequest(id);
                if (response) {
                    rememberClosed(id, request);
                    retainSubmission({ response, saved: row?.saved !== false });
                } else {
                    rememberId(nativeClosedQuestionIds, id);
                    if (request?.method === QUESTION_REQUEST && shouldKeepClosedQuestionDraft(request)) {
                        upsertPendingServerRequest({ ...request, questionClosed: true });
                    } else if (request) {
                        removeRequestAndDraft(id, request);
                    }
                }
            }
            return true;
        }
        return false;
    }
    async function loadPendingServerRequestsFromBridge(): Promise<void> {
        const generation = deps.lifecycleGeneration;
        const version = ++pendingServerRequestsVersion;
        const live = new Map<number, UiServerRequest>();
        requestsDuringLoad = live;
        try {
            const rows = await getPendingServerRequests();
            if (generation !== deps.lifecycleGeneration || version !== pendingServerRequestsVersion)
                return;
            const restored = rows
                .map((row) => normalizeServerRequest(row))
                .filter((request): request is UiServerRequest => request !== null && !closedRequestIds.has(request.id) && !nativeClosedQuestionIds.has(request.id));
            for (const request of restored) rememberId(seenRequestIds, request.id);
            const merged = new Map(restored.map(request => [request.id, request]));
            for (const { id, threadId } of live.values()) {
                const request = getThreadRequests(threadId).find(row => row.id === id);
                if (request && !request.questionClosed && !merged.has(id)) merged.set(id, request);
            }
            replacePendingServerRequests([...merged.values()]);
        }
        catch {
            // Keep UI usable when pending request endpoint is temporarily unavailable.
        }
        finally {
            if (requestsDuringLoad === live) requestsDuringLoad = undefined;
        }
    }
    function retainSubmission(submission: QuestionSubmission): void {
        deps.retainQuestionResponse(submission.response);
        if (!submission.saved) {
            questionSaveWarnings.set(submission.response.threadId, 'Answer submitted. WebUI could not save it to history.');
        }
    }
    async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<boolean> {
        const generation = deps.lifecycleGeneration;
        const request = findPendingRequest(reply.id);
        const isQuestion = request?.method === QUESTION_REQUEST;
        let draft: QuestionDraft | undefined;
        if (isQuestion) {
            const previous = readQuestionDraft(request)?.attempt;
            if (request.answerAttempted || request.questionClosed || (previous && !previous.retryable)) return false;
            draft = ensureQuestionDraft(request);
            draft.attempt = {};
        }
        try {
            const submission = await replyToServerRequest(reply.id, {
                result: reply.result,
                error: reply.error,
            });
            if (isQuestion && !submission) throw new Error(QUESTION_REPLY_UNCONFIRMED);
            if (generation !== deps.lifecycleGeneration) return true;
            if (submission && (findPendingRequest(reply.id) || !closedRequestIds.has(reply.id))) retainSubmission(submission);
            rememberClosed(reply.id, request);
            return true;
        }
        catch (unknownError) {
            if (generation !== deps.lifecycleGeneration) return false;
            if (isQuestion && closedRequestIds.has(reply.id)) return true;
            if (draft && request) {
                if (readQuestionDraft(request) !== draft) return false;
                const pending = findPendingRequest(reply.id);
                const notSent = unknownError instanceof CodexApiError && unknownError.code === QUESTION_REPLY_NOT_SENT;
                if (notSent && pending?.questionClosed) {
                    draft.attempt = undefined;
                    if (!shouldKeepClosedQuestionDraft(pending)) removeRequestAndDraft(reply.id, pending);
                    return false;
                }
                const retryable = Boolean(pending && notSent);
                if (retryable && pending?.answerAttempted) upsertPendingServerRequest({ ...pending, answerAttempted: false });
                const message = retryable && unknownError instanceof Error ? unknownError.message : QUESTION_REPLY_UNCONFIRMED;
                draft.attempt = { error: message, retryable };
                deps.error.value = message;
                return false;
            }
            deps.error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request';
            return false;
        }
    }
    return {
        readQuestionDraft,
        updateQuestionDraft,
        readQuestionSaveWarning: (threadId: string) => questionSaveWarnings.get(threadId),
        confirmQuestionResponses,
        dismissQuestionDraft,
        clearThreadQuestions,
        clearQuestionState,
        clearPendingAfterDisconnect: () => {
            ++pendingServerRequestsVersion;
            requestsDuringLoad = undefined;
            for (const requests of Object.values(pendingServerRequestsByThreadId.value)) {
                for (const request of requests) {
                    const draft = readQuestionDraft(request);
                    if (draft?.attempt && !draft.attempt.error) draft.attempt = { error: QUESTION_REPLY_UNCONFIRMED };
                }
            }
            replacePendingServerRequests([]);
        },
        pendingServerRequestsByThreadId,
        getThreadPendingRequests,
        readPendingRequestState,
        readToolRequestUserInputQuestionIds,
        handleServerRequestNotification,
        loadPendingServerRequestsFromBridge,
        respondToPendingServerRequest,
    };
}
