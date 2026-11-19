import { readUiPreference } from '../../utils/browserUiStorage'
import { computed, ref } from 'vue';
import { getPinnedThreadState, getThreadSummary, setThreadPinned, subscribeCodexNotifications, } from '../../api/codexGateway';
import type { UiThread } from '../../types/codex';
import type { SidebarProps } from "./sidebarContracts";
import { folderGroupKey, groupThreadsByFolder, parseThreadViewMode, projectGroupKey, toSidebarProjectGroups, type SidebarGroup, type ThreadViewMode } from './sidebarGroups';
import { compareThreads, sortThreadGroups, type ThreadSortMode } from './threadSorting';
import { collectChronologicalThreads, filterSidebarGroups } from './threadVisibility';
/** Owns native pin hydration, search/sort projections and expanded-page state. Creates the existing single section notification subscription; the component registers its disposer and scoped watchers, preserving setup order. */
export function createSidebarThreads(deps: {
    CHAT_SORT_MODE_STORAGE_KEY: string;
    props: Readonly<SidebarProps>;
    THREAD_VIEW_MODE_STORAGE_KEY: string;
    isPinned: (threadId: string) => boolean;
    isCollapsed: (groupKey: string) => boolean;
}) {
    const expandedGroups = ref<Record<string, boolean>>({});
    let hasLoadedPinnedThreadState = false;
    const pinnedThreadIds = ref<string[]>([]);
    const hydratedPinnedThreadById = ref<Record<string, UiThread>>({});
    const optimisticallyArchivedThreadIds = ref<string[]>([]);
    const chatSortMode = ref<ThreadSortMode>(typeof window !== 'undefined' && readUiPreference(deps.CHAT_SORT_MODE_STORAGE_KEY) === 'created' ? 'created' : 'updated');
    const threadViewMode = ref<ThreadViewMode>(loadThreadViewMode());
    function loadThreadViewMode(): ThreadViewMode {
        return parseThreadViewMode(readUiPreference(deps.THREAD_VIEW_MODE_STORAGE_KEY));
    }
    const isFolderView = computed(() => threadViewMode.value === 'folder');
    const sidebarGroups = computed(() => isFolderView.value ? groupThreadsByFolder(deps.props.groups) : toSidebarProjectGroups(deps.props.groups));
    const sortedGroups = computed(() => sortThreadGroups(sidebarGroups.value, chatSortMode.value, isFolderView.value ? undefined : deps.props.removableProjectIds));
    const normalizedSearchQuery = computed(() => deps.props.searchQuery.trim().toLowerCase());
    const isSearchActive = computed(() => normalizedSearchQuery.value.length > 0);
    const matchedThreadIdSet = computed(() => {
        if (!deps.props.searchMatchedThreadIds)
            return null;
        return new Set(deps.props.searchMatchedThreadIds);
    });
    const pinnedThreadIdSet = computed(() => new Set(pinnedThreadIds.value));
    const optimisticallyArchivedThreadIdSet = computed(() => new Set(optimisticallyArchivedThreadIds.value));
    function threadMatchesSearch(thread: UiThread): boolean {
        if (optimisticallyArchivedThreadIdSet.value.has(thread.id))
            return false;
        if (!isSearchActive.value)
            return true;
        if (matchedThreadIdSet.value?.has(thread.id)) {
            return true;
        }
        const q = normalizedSearchQuery.value;
        return thread.title.toLowerCase().includes(q) || thread.preview.toLowerCase().includes(q);
    }
    const activeGroupKey = computed(() => {
        if (!isFolderView.value) {
            return deps.props.activeProjectName === null ? null : projectGroupKey(deps.props.activeProjectName);
        }
        if (deps.props.newThreadCwd !== undefined) {
            return deps.props.newThreadCwd.trim() ? folderGroupKey(deps.props.newThreadCwd) : null;
        }
        const id = deps.props.selectedThreadId;
        const thread = threadById.value.get(id) ?? hydratedPinnedThreadById.value[id];
        return thread ? folderGroupKey(thread.cwd) : null;
    });
    const filteredGroups = computed(() => filterSidebarGroups(sortedGroups.value, threadMatchesSearch, isSearchActive.value, activeGroupKey.value));
    const isChronologicalView = computed(() => threadViewMode.value === 'chronological');
    const globalThreads = computed(() => collectChronologicalThreads(deps.props.groups, threadMatchesSearch, pinnedThreadIdSet.value).sort(compareThreads(chatSortMode.value)));
    const threadById = computed(() => {
        const map = new Map<string, UiThread>();
        for (const group of deps.props.groups) {
            for (const thread of group.threads) {
                if (optimisticallyArchivedThreadIdSet.value.has(thread.id))
                    continue;
                map.set(thread.id, thread);
            }
        }
        return map;
    });
    let pinnedThreadHydrationVersion = 0;
    async function hydrateMissingPinnedThreads(): Promise<void> {
        if (deps.props.isLoading)
            return;
        const missingThreadIds = pinnedThreadIds.value.filter((threadId) => !threadById.value.has(threadId) && !hydratedPinnedThreadById.value[threadId]);
        if (missingThreadIds.length === 0)
            return;
        const version = (pinnedThreadHydrationVersion += 1);
        const loadedThreads = await Promise.all(missingThreadIds.map(async (threadId) => {
            try {
                return await getThreadSummary(threadId);
            }
            catch {
                return null;
            }
        }));
        if (version !== pinnedThreadHydrationVersion)
            return;
        const next = { ...hydratedPinnedThreadById.value };
        for (const thread of loadedThreads) {
            if (thread)
                next[thread.id] = thread;
        }
        hydratedPinnedThreadById.value = next;
    }
    const pinStateError = ref('');
    async function refreshPinnedThreadState(): Promise<void> {
        try {
            const { threadIds } = await getPinnedThreadState();
            pinnedThreadIds.value = [...new Set(threadIds.map(id => id.trim()).filter(Boolean))];
            pinStateError.value = '';
            hasLoadedPinnedThreadState = true;
            void hydrateMissingPinnedThreads();
        }
        catch (error) {
            pinStateError.value = error instanceof Error ? error.message : 'Failed to load native pins';
        }
    }
    const unsubscribeSections = subscribeCodexNotifications(notification => {
        if (notification.method === 'thread/section/changed' || notification.method === 'app-server/reconnected') {
            void refreshPinnedThreadState();
        }
    });
    const threadGroupKeyById = computed(() => {
        const map = new Map<string, string>();
        for (const group of sidebarGroups.value) {
            for (const thread of group.threads) {
                map.set(thread.id, group.key);
            }
        }
        return map;
    });
    const unpinnedThreadsByGroupKey = computed(() => {
        const map = new Map<string, UiThread[]>();
        for (const group of filteredGroups.value) {
            const rows = group.threads.filter((thread) => !pinnedThreadIdSet.value.has(thread.id) && !optimisticallyArchivedThreadIdSet.value.has(thread.id));
            map.set(group.key, rows);
        }
        return map;
    });
    const threadTimestampById = computed(() => {
        const map = new Map<string, number>();
        for (const group of deps.props.groups) {
            for (const thread of group.threads) {
                const timestamp = new Date(thread.updatedAtIso || thread.createdAtIso).getTime();
                map.set(thread.id, timestamp);
            }
        }
        return map;
    });
    const pinnedThreads = computed(() => pinnedThreadIds.value
        .map((threadId) => threadById.value.get(threadId) ?? hydratedPinnedThreadById.value[threadId] ?? null)
        .filter((thread): thread is UiThread => thread !== null)
        .filter(threadMatchesSearch));
    async function togglePin(threadId: string): Promise<void> {
        if (pinStateError.value)
            return;
        try {
            const pinned = !deps.isPinned(threadId);
            await setThreadPinned(threadId, pinned, pinnedThreadIds.value[0]);
            // Apply the acknowledged move; the native notification refreshes other-client
            // changes. Avoid issuing a second list request for our own notification.
            const remaining = pinnedThreadIds.value.filter(id => id !== threadId);
            pinnedThreadIds.value = pinned ? [threadId, ...remaining] : remaining;
        }
        catch (error) {
            console.error('Unable to change native thread section', error);
        }
    }
    function isExpanded(groupKey: string): boolean {
        return expandedGroups.value[groupKey] === true;
    }
    function toggleGroupExpansion(groupKey: string): void {
        expandedGroups.value = {
            ...expandedGroups.value,
            [groupKey]: !isExpanded(groupKey),
        };
    }
    function groupThreads(group: SidebarGroup): UiThread[] {
        return unpinnedThreadsByGroupKey.value.get(group.key) ?? [];
    }
    function visibleThreads(group: SidebarGroup): UiThread[] {
        if (isSearchActive.value)
            return groupThreads(group);
        if (deps.isCollapsed(group.key))
            return [];
        const rows = groupThreads(group);
        return isExpanded(group.key) ? rows : rows.slice(0, 10);
    }
    function hasHiddenThreads(group: SidebarGroup): boolean {
        if (isSearchActive.value)
            return false;
        return !deps.isCollapsed(group.key) && groupThreads(group).length > 10;
    }
    function hasThreads(group: SidebarGroup): boolean {
        return groupThreads(group).length > 0;
    }
    return {
get hasLoadedPinnedThreadState() { return hasLoadedPinnedThreadState; },
set hasLoadedPinnedThreadState(value) { hasLoadedPinnedThreadState = value; },
pinnedThreadIds,
optimisticallyArchivedThreadIds,
chatSortMode,
sidebarGroups,
sortedGroups,
threadViewMode,
loadThreadViewMode,
isFolderView,
activeGroupKey,
isSearchActive,
pinnedThreadIdSet,
optimisticallyArchivedThreadIdSet,
filteredGroups,
isChronologicalView,
globalThreads,
threadById,
hydrateMissingPinnedThreads,
pinStateError,
refreshPinnedThreadState,
unsubscribeSections,
threadGroupKeyById,
unpinnedThreadsByGroupKey,
threadTimestampById,
pinnedThreads,
togglePin,
isExpanded,
toggleGroupExpansion,
visibleThreads,
hasHiddenThreads,
hasThreads
};
}
