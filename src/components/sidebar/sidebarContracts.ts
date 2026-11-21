import type { UiProjectGroup } from '../../types/codex';
import type { Project } from '../../server/protocol/0.167.2/v2/Project'
import type { SidebarSearch } from './sidebarSearch'
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
    projects?: readonly Project[];
    search?: SidebarSearch | null;
};
export type MenuDirection = 'up' | 'down';
