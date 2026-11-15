import type { UiProjectGroup } from '../../types/codex';
export type SidebarProps = {
    isForkDisabled?: boolean;
    isExporting?: boolean;
    groups: UiProjectGroup[];
    removableProjectIds?: string[];
    projectDisplayNameById: Record<string, string>;
    selectedThreadId: string;
    activeProjectName: string | null;
    isLoading: boolean;
    isThreadListFullyLoaded: boolean;
    searchQuery: string;
    searchMatchedThreadIds: string[] | null;
};
export type MenuDirection = 'up' | 'down';
