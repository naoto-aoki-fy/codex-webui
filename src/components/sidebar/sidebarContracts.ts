import type { UiProjectGroup } from '../../types/codex';
export type NewThreadTarget = { cwd: string; projectId?: string };
export type SidebarProps = {
    isForkDisabled?: boolean;
    groups: UiProjectGroup[];
    removableProjectIds?: string[];
    resolveNewThreadCwd?: (projectName: string) => string;
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
