import { computed, ref } from 'vue';
import { getPinnedThreadState, getThreadSummary, setThreadPinned, subscribeCodexNotifications, } from '../../api/codexGateway';
import type { UiProjectGroup, UiThread } from '../../types/codex';
import type { SidebarProps } from "./sidebarContracts";
import { compareThreads, sortThreadGroups, type ThreadSortMode } from './threadSorting';
import { collectChronologicalThreads, filterSidebarGroups } from './threadVisibility';
/** Owns native pin hydration, search/sort projections and expanded-page state. Creates the existing single section notification subscription; the component registers its disposer and scoped watchers, preserving setup order. */
export function createSidebarThreads(deps: {
    CHAT_SORT_MODE_STORAGE_KEY: string;
    props: Readonly<SidebarProps>;
    THREAD_VIEW_MODE_STORAGE_KEY: string;
    isPinned: (threadId: string) => boolean;
    isCollapsed: (projectName: string) => boolean;
}) {
    const expandedProjects = ref<Record<string, boolean>>({});
    let hasLoadedPinnedThreadState = false;
    const pinnedThreadIds = ref<string[]>([]);
    const hydratedPinnedThreadById = ref<Record<string, UiThread>>({});
    const optimisticallyArchivedThreadIds = ref<string[]>([]);
    const chatSortMode = ref<ThreadSortMode>(typeof window !== 'undefined' && window.localStorage.getItem(deps.CHAT_SORT_MODE_STORAGE_KEY) === 'created' ? 'created' : 'updated');
    const sortedGroups = computed(() => sortThreadGroups(deps.props.groups, chatSortMode.value));
    const threadViewMode = ref<'project' | 'chronological'>(loadThreadViewMode());
    function loadThreadViewMode(): 'project' | 'chronological' {
        if (typeof window === 'undefined')
            return 'project';
        const raw = window.localStorage.getItem(deps.THREAD_VIEW_MODE_STORAGE_KEY);
        return raw === 'chronological' ? 'chronological' : 'project';
    }
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
    const filteredGroups = computed(() => filterSidebarGroups(sortedGroups.value, threadMatchesSearch, isSearchActive.value, deps.props.activeProjectName));
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
    const threadProjectNameById = computed(() => {
        const map = new Map<string, string>();
        for (const group of deps.props.groups) {
            for (const thread of group.threads) {
                map.set(thread.id, group.projectName);
            }
        }
        return map;
    });
    const unpinnedThreadsByProjectName = computed(() => {
        const map = new Map<string, UiThread[]>();
        for (const group of filteredGroups.value) {
            const rows = group.threads.filter((thread) => !pinnedThreadIdSet.value.has(thread.id) && !optimisticallyArchivedThreadIdSet.value.has(thread.id));
            map.set(group.projectName, rows);
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
    function isExpanded(projectName: string): boolean {
        return expandedProjects.value[projectName] === true;
    }
    function toggleProjectExpansion(projectName: string): void {
        expandedProjects.value = {
            ...expandedProjects.value,
            [projectName]: !isExpanded(projectName),
        };
    }
    function projectThreads(group: UiProjectGroup): UiThread[] {
        return unpinnedThreadsByProjectName.value.get(group.projectName) ?? [];
    }
    function visibleThreads(group: UiProjectGroup): UiThread[] {
        if (isSearchActive.value)
            return projectThreads(group);
        if (deps.isCollapsed(group.projectName))
            return [];
        const rows = projectThreads(group);
        return isExpanded(group.projectName) ? rows : rows.slice(0, 10);
    }
    function hasHiddenThreads(group: UiProjectGroup): boolean {
        if (isSearchActive.value)
            return false;
        return !deps.isCollapsed(group.projectName) && projectThreads(group).length > 10;
    }
    function hasThreads(group: UiProjectGroup): boolean {
        return projectThreads(group).length > 0;
    }
    return {
get hasLoadedPinnedThreadState() { return hasLoadedPinnedThreadState; },
set hasLoadedPinnedThreadState(value) { hasLoadedPinnedThreadState = value; },
pinnedThreadIds,
optimisticallyArchivedThreadIds,
chatSortMode,
sortedGroups,
threadViewMode,
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
threadProjectNameById,
unpinnedThreadsByProjectName,
threadTimestampById,
pinnedThreads,
togglePin,
isExpanded,
toggleProjectExpansion,
visibleThreads,
hasHiddenThreads,
hasThreads
};
}
