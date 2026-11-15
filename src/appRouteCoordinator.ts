import type { ComputedRef, Ref } from 'vue';
import { ref } from 'vue';
import type { RouteLocationNormalizedLoadedGeneric, Router } from 'vue-router';
import type { FileAttachment } from './utils/composerDraftStorage';
/** Owns serialized route-selection work and first-submission navigation. Route watchers and startup remain in App; pending selection coalesces through one per-instance gate. */
export function createAppRouteCoordinator(deps: {
    route: Pick<RouteLocationNormalizedLoadedGeneric, 'name'>;
    selectedThreadId: Ref<string, string>;
    selectThread: (threadId: string) => Promise<'ok' | 'not-found' | 'error'>;
    routeThreadId: ComputedRef<string>;
    ensureThreadMessagesLoaded: (threadId: string, options?: {
        silent?: boolean;
    }) => Promise<void>;
    newThreadCwd: Ref<string, string>;
    desktopError: Ref<string, string>;
    sendMessageToNewThread: (text: string, cwd: string, imageUrls?: string[], skills?: Array<{
        name: string;
        path: string;
    }>, fileAttachments?: FileAttachment[], projectId?: string) => Promise<string>;
    newThreadProjectId: ComputedRef<string>;
    router: Pick<Router, 'replace'>;
    scheduleMobileConversationJumpToLatest: () => void;
}) {
    const isRouteSyncInProgress = ref(false);
    let hasPendingRouteSync = false;
    async function syncThreadSelectionWithRoute(): Promise<void> {
        if (isRouteSyncInProgress.value) {
            hasPendingRouteSync = true;
            return;
        }
        isRouteSyncInProgress.value = true;
        try {
            do {
                hasPendingRouteSync = false;
                if (deps.route.name === 'home' || deps.route.name === 'skills') {
                    if (deps.selectedThreadId.value !== '') {
                        await deps.selectThread('');
                    }
                    continue;
                }
                if (deps.route.name === 'thread') {
                    const threadId = deps.routeThreadId.value;
                    if (!threadId)
                        continue;
                    if (deps.selectedThreadId.value !== threadId) {
                        const result = await deps.selectThread(threadId);
                        if (result === 'not-found') {
                            continue;
                        }
                    }
                    else {
                        void deps.ensureThreadMessagesLoaded(threadId, { silent: true }).catch(() => {
                            // The conversation overlay receives the error from useDesktopState.
                        });
                    }
                }
            } while (hasPendingRouteSync);
        }
        finally {
            isRouteSyncInProgress.value = false;
        }
    }
    async function submitFirstMessageForNewThread(text: string, imageUrls: string[] = [], skills: Array<{
        name: string;
        path: string;
    }> = [], fileAttachments: Array<{
        label: string;
        path: string;
        fsPath: string;
    }> = []): Promise<boolean> {
        try {
            let targetCwd = deps.newThreadCwd.value;
            if (!targetCwd.trim()) {
                deps.desktopError.value = 'Select an existing workspace before starting a conversation.';
                return false;
            }
            const threadId = await deps.sendMessageToNewThread(text, targetCwd, imageUrls, skills, fileAttachments, deps.newThreadProjectId.value || undefined);
            if (!threadId)
                return false;
            await deps.router.replace({ name: 'thread', params: { threadId } });
            deps.scheduleMobileConversationJumpToLatest();
            return true;
        }
        catch {
            // Error is already reflected in state.
            return false;
        }
    }
    return {
isRouteSyncInProgress,
syncThreadSelectionWithRoute,
submitFirstMessageForNewThread
};
}
