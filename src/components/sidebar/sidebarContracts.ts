import type { UiProjectGroup } from '../../types/codex';
export type SidebarProps = {
    isForkDisabled?: boolean;
    groups: UiProjectGroup[];
    removableProjectIds?: string[];
    resolveNewThreadCwd?: (projectId: string) => string;
    projectDisplayNameById: Record<string, string>;
    selectedThreadId: string;
    activeProjectName: string | null;
    newThreadCwd?: string;
    isLoading: boolean;
    isThreadListFullyLoaded: boolean;
    searchQuery: string;
    searchMatchedThreadIds: string[] | null;
};
export type MenuDirection = 'up' | 'down';
