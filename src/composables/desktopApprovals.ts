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
    error: Ref<string, string>;
}) {
    const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({});
    let pendingServerRequestsVersion = 0;
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
        for (const request of requests) {
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
            if (!request)
                return true;
            upsertPendingServerRequest(request);
            return true;
        }
        if (notification.method === 'server/request/resolved') {
            const row = asRecord(notification.params);
            const id = row?.id;
            if (typeof id === 'number' && Number.isInteger(id)) {
                removePendingServerRequestById(id);
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
                .filter((request): request is UiServerRequest => request !== null);
            replacePendingServerRequests(normalizedRequests);
        }
        catch {
            // Keep UI usable when pending request endpoint is temporarily unavailable.
        }
    }
    async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<boolean> {
        const generation = deps.lifecycleGeneration;
        try {
            await replyToServerRequest(reply.id, {
                result: reply.result,
                error: reply.error,
            });
            if (generation === deps.lifecycleGeneration)
                removePendingServerRequestById(reply.id);
            return true;
        }
        catch (unknownError) {
            if (generation !== deps.lifecycleGeneration)
                return false;
            deps.error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request';
            return false;
        }
    }
    return {
        pendingServerRequestsByThreadId,
        get pendingServerRequestsVersion() { return pendingServerRequestsVersion; }, set pendingServerRequestsVersion(value) { pendingServerRequestsVersion = value; },
        getThreadPendingRequests,
        isApprovalRequestMethod,
        readPendingRequestState,
        normalizeServerRequest,
        readToolRequestUserInputQuestionIds,
        upsertPendingServerRequest,
        removePendingServerRequestById,
        replacePendingServerRequests,
        handleServerRequestNotification,
        loadPendingServerRequestsFromBridge,
        respondToPendingServerRequest
    };
}
