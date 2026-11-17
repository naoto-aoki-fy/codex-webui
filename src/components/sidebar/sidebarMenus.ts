import type { ComponentPublicInstance } from 'vue';
import { computed, nextTick, ref } from 'vue';
import type { Router, RouteLocationRaw } from 'vue-router';
import type { ForkMethod } from '../../types/codex';
import type { MenuDirection, SidebarProps } from "./sidebarContracts";
import { createSidebarThreads } from './sidebarThreads';
import { copyTextToClipboard } from '../../utils/clipboard';
/** Owns menu/dialog refs, action handlers, placement maps and listener callbacks. The component scopes menu-open watchers and invokes both listener disposers on unmount; tree measurement remains in the component. */
export function createSidebarMenus(deps: {
    threads: ReturnType<typeof createSidebarThreads>;
    emit: ((evt: "select", threadId: string) => void) & ((evt: "archive", threadId: string) => void) & ((evt: "start-new-thread", projectName: string) => void) & ((evt: "rename-thread", payload: {
        threadId: string;
        title: string;
    }) => void) & ((evt: "remove-project", projectName: string) => void) & ((evt: "copy-thread-chat", threadId: string) => void) & ((evt: "fork-thread", payload: {
        threadId: string;
        method: ForkMethod;
    }) => void);
    props: Readonly<SidebarProps>;
    getProjectDisplayName: (projectName: string) => string;
    router: Router;
}) {
    const inlineDeleteConfirmThreadId = ref('');
    const openProjectMenuId = ref('');
    const openThreadMenuId = ref('');
    const projectMenuDirectionById = ref<Record<string, MenuDirection>>({});
    const threadMenuDirectionById = ref<Record<string, MenuDirection>>({});
    const openThreadMenuStyle = ref<Record<string, string>>({});
    const renameThreadDialogVisible = ref(false);
    const renameThreadDialogThreadId = ref('');
    const renameThreadDraft = ref('');
    const renameThreadInputRef = ref<HTMLInputElement | null>(null);
    const deleteThreadDialogVisible = ref(false);
    const deleteThreadDialogThreadId = ref('');
    const deleteThreadTitle = ref('');
    const projectMenuWrapElementByName = new Map<string, HTMLElement>();
    const threadMenuWrapElementById = new Map<string, HTMLElement>();
    const organizeMenuWrapRef = ref<HTMLElement | null>(null);
    const openThreadMenuPanelRef = ref<HTMLElement | null>(null);
    const isOrganizeMenuOpen = ref(false);
    const openThreadMenuThread = computed(() => {
        const threadId = openThreadMenuId.value;
        return threadId ? (deps.threads.threadById.value.get(threadId) ?? null) : null;
    });
    function onTogglePinFromMenu(threadId: string): void {
        deps.threads.togglePin(threadId);
        closeThreadMenu();
    }
    function onSelect(threadId: string): void {
        inlineDeleteConfirmThreadId.value = '';
        deps.emit('select', threadId);
    }
    function onCopyThreadChat(threadId: string): void {
        if (threadId !== deps.props.selectedThreadId)
            return;
        deps.emit('copy-thread-chat', threadId);
        closeThreadMenu();
    }
    function onForkThread(threadId: string, method: ForkMethod): void {
        if (deps.props.isForkDisabled)
            return;
        deps.emit('fork-thread', { threadId, method });
        closeThreadMenu();
    }
    function getNewThreadButtonAriaLabel(projectName: string): string {
        return `start new thread ${deps.getProjectDisplayName(projectName)}`;
    }
    function onStartNewThread(projectName: string): void {
        deps.emit('start-new-thread', projectName);
    }
    async function onCopyThreadPath(threadId: string): Promise<void> {
        const path = deps.threads.threadById.value.get(threadId)?.cwd?.trim() ?? '';
        closeThreadMenu();
        if (!path)
            return;
        try {
            await copyTextToClipboard(path);
        }
        catch {
            // Clipboard writes can be blocked by browser permissions; the menu action is best-effort.
        }
    }
    function onThreadRowLeave(threadId: string, event?: MouseEvent): void {
        if (openThreadMenuId.value !== threadId)
            return;
        if (event) {
            const relatedTarget = event.relatedTarget;
            const panelElement = openThreadMenuPanelRef.value;
            if (relatedTarget instanceof Node && panelElement && panelElement.contains(relatedTarget))
                return;
        }
        closeThreadMenu();
    }
    function isThreadMenuOpen(threadId: string): boolean {
        return openThreadMenuId.value === threadId;
    }
    function closeThreadMenu(): void {
        openThreadMenuId.value = '';
        openThreadMenuStyle.value = {};
    }
    function toggleThreadMenu(threadId: string): void {
        inlineDeleteConfirmThreadId.value = '';
        if (openThreadMenuId.value === threadId) {
            closeThreadMenu();
            return;
        }
        closeProjectMenu();
        isOrganizeMenuOpen.value = false;
        openThreadMenuId.value = threadId;
        nextTick(() => {
            updateOpenThreadMenuPlacement(threadId);
        });
    }
    function onThreadRowContextMenu(event: MouseEvent, threadId: string): void {
        event.preventDefault();
        inlineDeleteConfirmThreadId.value = '';
        openThreadMenuId.value = threadId;
    }
    function openRouteInNewTab(location: RouteLocationRaw): void {
        const { href } = deps.router.resolve(location);
        window.open(href, '_blank', 'noopener,noreferrer');
    }
    function onOpenProjectInNewTab(projectName: string): void {
        const cwd = deps.props.resolveNewThreadCwd?.(projectName) ?? '';
        openRouteInNewTab({ name: 'home', query: { projectId: projectName, ...(cwd ? { cwd } : {}) } });
        closeProjectMenu();
    }
    function onOpenThreadInNewTab(threadId: string): void {
        openRouteInNewTab({ name: 'thread', params: { threadId } });
        closeThreadMenu();
    }
    function openRenameThreadDialog(threadId: string, currentTitle: string): void {
        renameThreadDialogThreadId.value = threadId;
        renameThreadDraft.value = currentTitle;
        renameThreadDialogVisible.value = true;
        closeThreadMenu();
        nextTick(() => {
            renameThreadInputRef.value?.focus();
            renameThreadInputRef.value?.select();
        });
    }
    function closeRenameThreadDialog(): void {
        renameThreadDialogVisible.value = false;
        renameThreadDialogThreadId.value = '';
        renameThreadDraft.value = '';
    }
    function submitRenameThread(): void {
        const threadId = renameThreadDialogThreadId.value;
        const title = renameThreadDraft.value.trim();
        if (!threadId || !title)
            return;
        deps.emit('rename-thread', { threadId, title });
        closeRenameThreadDialog();
    }
    function openDeleteThreadDialog(threadId: string, currentTitle: string): void {
        inlineDeleteConfirmThreadId.value = '';
        deleteThreadDialogThreadId.value = threadId;
        deleteThreadTitle.value = currentTitle;
        deleteThreadDialogVisible.value = true;
        closeThreadMenu();
    }
    function closeDeleteThreadDialog(): void {
        deleteThreadDialogVisible.value = false;
        deleteThreadDialogThreadId.value = '';
        deleteThreadTitle.value = '';
    }
    async function submitDeleteThread(): Promise<void> {
        const threadId = deleteThreadDialogThreadId.value;
        if (!threadId)
            return;
        deleteThreadById(threadId);
        closeDeleteThreadDialog();
    }
    function isInlineDeleteConfirming(threadId: string): boolean {
        return inlineDeleteConfirmThreadId.value === threadId;
    }
    function onInlineDeleteClick(threadId: string): void {
        if (inlineDeleteConfirmThreadId.value !== threadId) {
            inlineDeleteConfirmThreadId.value = threadId;
            closeThreadMenu();
            return;
        }
        deleteThreadById(threadId);
        inlineDeleteConfirmThreadId.value = '';
    }
    function deleteThreadById(threadId: string): void {
        if (!deps.threads.optimisticallyArchivedThreadIdSet.value.has(threadId)) {
            deps.threads.optimisticallyArchivedThreadIds.value = [threadId, ...deps.threads.optimisticallyArchivedThreadIds.value];
        }
        inlineDeleteConfirmThreadId.value = '';
        closeThreadMenu();
        deps.threads.pinnedThreadIds.value = deps.threads.pinnedThreadIds.value.filter((id) => id !== threadId);
        deps.emit('archive', threadId);
    }
    const removableProjectIdSet = computed(() => new Set(deps.props.removableProjectIds ?? []));
    function canRemoveProject(projectName: string): boolean {
        return removableProjectIdSet.value.has(projectName);
    }
    function isProjectMenuOpen(projectName: string): boolean {
        return openProjectMenuId.value === projectName;
    }
    function closeProjectMenu(): void {
        openProjectMenuId.value = '';
    }
    function toggleOrganizeMenu(): void {
        const nextValue = !isOrganizeMenuOpen.value;
        if (nextValue) {
            closeProjectMenu();
            closeThreadMenu();
        }
        isOrganizeMenuOpen.value = nextValue;
    }
    function setThreadViewMode(mode: 'project' | 'chronological'): void {
        deps.threads.threadViewMode.value = mode;
        isOrganizeMenuOpen.value = false;
    }
    function scheduleProjectMenuDirection(projectName: string): void {
        nextTick(() => {
            updateProjectMenuDirection(projectName);
        });
    }
    function toggleProjectMenu(projectName: string): void {
        if (openProjectMenuId.value === projectName) {
            closeProjectMenu();
            return;
        }
        closeThreadMenu();
        isOrganizeMenuOpen.value = false;
        openProjectMenuId.value = projectName;
        scheduleProjectMenuDirection(projectName);
    }
    function openProjectContextMenu(projectName: string): void {
        closeThreadMenu();
        isOrganizeMenuOpen.value = false;
        openProjectMenuId.value = projectName;
        scheduleProjectMenuDirection(projectName);
    }
    function onRemoveProject(projectName: string): void {
        if (!canRemoveProject(projectName))
            return;
        deps.emit('remove-project', projectName);
        closeProjectMenu();
    }
    function setProjectMenuWrapRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
        const htmlElement = element instanceof HTMLElement
            ? element
            : element && '$el' in element && element.$el instanceof HTMLElement
                ? element.$el
                : null;
        if (htmlElement) {
            projectMenuWrapElementByName.set(projectName, htmlElement);
            return;
        }
        projectMenuWrapElementByName.delete(projectName);
    }
    function setThreadMenuWrapRef(threadId: string, element: Element | ComponentPublicInstance | null): void {
        const htmlElement = element instanceof HTMLElement
            ? element
            : element && '$el' in element && element.$el instanceof HTMLElement
                ? element.$el
                : null;
        if (htmlElement) {
            threadMenuWrapElementById.set(threadId, htmlElement);
            return;
        }
        threadMenuWrapElementById.delete(threadId);
    }
    function findMenuBoundaryRect(element: HTMLElement): DOMRect {
        let parent: HTMLElement | null = element.parentElement;
        while (parent) {
            const styles = window.getComputedStyle(parent);
            const overflowY = styles.overflowY || styles.overflow;
            if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'clip') {
                return parent.getBoundingClientRect();
            }
            parent = parent.parentElement;
        }
        return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    }
    function resolveMenuDirection(menuWrapElement: HTMLElement, panelHeight: number): MenuDirection {
        const wrapRect = menuWrapElement.getBoundingClientRect();
        const boundaryRect = findMenuBoundaryRect(menuWrapElement);
        const panelGap = 6;
        const spaceBelow = boundaryRect.bottom - wrapRect.bottom;
        const spaceAbove = wrapRect.top - boundaryRect.top;
        if (spaceBelow >= panelHeight + panelGap)
            return 'down';
        if (spaceAbove > spaceBelow)
            return 'up';
        return 'down';
    }
    function updateThreadMenuDirection(threadId: string, panelHeight: number): MenuDirection {
        const menuWrapElement = threadMenuWrapElementById.get(threadId);
        if (!menuWrapElement)
            return 'down';
        const direction = resolveMenuDirection(menuWrapElement, panelHeight);
        threadMenuDirectionById.value = {
            ...threadMenuDirectionById.value,
            [threadId]: direction,
        };
        return direction;
    }
    function getThreadMenuDirection(threadId: string): MenuDirection {
        return threadMenuDirectionById.value[threadId] ?? 'down';
    }
    function updateProjectMenuDirection(projectName: string): void {
        const menuWrapElement = projectMenuWrapElementByName.get(projectName);
        if (!menuWrapElement)
            return;
        const menuPanelElement = menuWrapElement.querySelector<HTMLElement>('.project-menu-panel');
        const panelHeight = menuPanelElement?.getBoundingClientRect().height ?? 0;
        projectMenuDirectionById.value = {
            ...projectMenuDirectionById.value,
            [projectName]: resolveMenuDirection(menuWrapElement, panelHeight),
        };
    }
    function clamp(value: number, minValue: number, maxValue: number): number {
        return Math.min(Math.max(value, minValue), maxValue);
    }
    function updateOpenThreadMenuPlacement(threadId: string): void {
        const menuWrapElement = threadMenuWrapElementById.get(threadId);
        if (!menuWrapElement)
            return;
        const panelElement = openThreadMenuPanelRef.value;
        const panelRect = panelElement?.getBoundingClientRect();
        const panelHeight = panelRect?.height || panelElement?.offsetHeight || 112;
        const panelWidth = panelRect?.width || panelElement?.offsetWidth || 160;
        const direction = updateThreadMenuDirection(threadId, panelHeight);
        const wrapRect = menuWrapElement.getBoundingClientRect();
        const viewportGap = 8;
        const offset = 4;
        const maxLeft = Math.max(viewportGap, window.innerWidth - panelWidth - viewportGap);
        const left = clamp(wrapRect.right - panelWidth, viewportGap, maxLeft);
        const top = direction === 'up'
            ? clamp(wrapRect.top - panelHeight - offset, viewportGap, Math.max(viewportGap, window.innerHeight - panelHeight - viewportGap))
            : clamp(wrapRect.bottom + offset, viewportGap, Math.max(viewportGap, window.innerHeight - panelHeight - viewportGap));
        openThreadMenuStyle.value = {
            left: `${Math.round(left)}px`,
            top: `${Math.round(top)}px`,
        };
    }
    function onThreadMenuViewportChange(): void {
        const threadId = openThreadMenuId.value;
        if (!threadId)
            return;
        updateOpenThreadMenuPlacement(threadId);
    }
    function bindThreadMenuPositionListeners(): void {
        window.addEventListener('resize', onThreadMenuViewportChange);
        document.addEventListener('scroll', onThreadMenuViewportChange, true);
    }
    function unbindThreadMenuPositionListeners(): void {
        window.removeEventListener('resize', onThreadMenuViewportChange);
        document.removeEventListener('scroll', onThreadMenuViewportChange, true);
    }
    function isEventInsideOpenProjectMenu(event: Event): boolean {
        const projectName = openProjectMenuId.value;
        if (!projectName)
            return false;
        const openMenuWrapElement = projectMenuWrapElementByName.get(projectName);
        if (!openMenuWrapElement)
            return false;
        const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (eventPath.includes(openMenuWrapElement))
            return true;
        const target = event.target;
        return target instanceof Node ? openMenuWrapElement.contains(target) : false;
    }
    function isEventInsideOpenThreadMenu(event: Event): boolean {
        const threadId = openThreadMenuId.value;
        if (!threadId)
            return false;
        const openMenuWrapElement = threadMenuWrapElementById.get(threadId);
        if (!openMenuWrapElement)
            return false;
        const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (eventPath.includes(openMenuWrapElement))
            return true;
        const panelElement = openThreadMenuPanelRef.value;
        if (panelElement && eventPath.includes(panelElement))
            return true;
        const target = event.target;
        if (!(target instanceof Node))
            return false;
        if (openMenuWrapElement.contains(target))
            return true;
        if (panelElement && panelElement.contains(target))
            return true;
        return false;
    }
    function onProjectMenuPointerDown(event: PointerEvent): void {
        if (isOrganizeMenuOpen.value) {
            const organizeElement = organizeMenuWrapRef.value;
            const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const isInsideOrganizeMenu = !!organizeElement &&
                (eventPath.includes(organizeElement) || (event.target instanceof Node && organizeElement.contains(event.target)));
            if (!isInsideOrganizeMenu) {
                isOrganizeMenuOpen.value = false;
            }
        }
        if (!openProjectMenuId.value)
            return;
        if (!isEventInsideOpenProjectMenu(event)) {
            closeProjectMenu();
        }
        if (!openThreadMenuId.value)
            return;
        if (isEventInsideOpenThreadMenu(event))
            return;
        closeThreadMenu();
    }
    function onProjectMenuFocusIn(event: FocusEvent): void {
        if (openProjectMenuId.value && !isEventInsideOpenProjectMenu(event)) {
            closeProjectMenu();
        }
        if (openThreadMenuId.value && !isEventInsideOpenThreadMenu(event)) {
            closeThreadMenu();
        }
    }
    function onWindowBlurForProjectMenu(): void {
        if (isOrganizeMenuOpen.value) {
            isOrganizeMenuOpen.value = false;
        }
        if (openProjectMenuId.value) {
            closeProjectMenu();
        }
        if (openThreadMenuId.value) {
            closeThreadMenu();
        }
    }
    function bindProjectMenuDismissListeners(): void {
        window.addEventListener('pointerdown', onProjectMenuPointerDown, { capture: true });
        window.addEventListener('focusin', onProjectMenuFocusIn, { capture: true });
        window.addEventListener('blur', onWindowBlurForProjectMenu);
    }
    function unbindProjectMenuDismissListeners(): void {
        window.removeEventListener('pointerdown', onProjectMenuPointerDown, { capture: true });
        window.removeEventListener('focusin', onProjectMenuFocusIn, { capture: true });
        window.removeEventListener('blur', onWindowBlurForProjectMenu);
    }
    const hasOpenDismissableMenu = computed(() => isOrganizeMenuOpen.value || openProjectMenuId.value !== '' || openThreadMenuId.value !== '');
    return {
openProjectMenuId,
openThreadMenuId,
projectMenuDirectionById,
openThreadMenuStyle,
renameThreadDialogVisible,
renameThreadDraft,
renameThreadInputRef,
deleteThreadDialogVisible,
deleteThreadTitle,
projectMenuWrapElementByName,
organizeMenuWrapRef,
openThreadMenuPanelRef,
isOrganizeMenuOpen,
openThreadMenuThread,
onTogglePinFromMenu,
onSelect,
onCopyThreadChat,
onForkThread,
getNewThreadButtonAriaLabel,
onStartNewThread,
onOpenProjectInNewTab,
onCopyThreadPath,
onThreadRowLeave,
isThreadMenuOpen,
toggleThreadMenu,
onThreadRowContextMenu,
onOpenThreadInNewTab,
openRenameThreadDialog,
closeRenameThreadDialog,
submitRenameThread,
openDeleteThreadDialog,
closeDeleteThreadDialog,
submitDeleteThread,
isInlineDeleteConfirming,
onInlineDeleteClick,
canRemoveProject,
isProjectMenuOpen,
toggleOrganizeMenu,
setThreadViewMode,
toggleProjectMenu,
openProjectContextMenu,
onRemoveProject,
setProjectMenuWrapRef,
setThreadMenuWrapRef,
getThreadMenuDirection,
updateOpenThreadMenuPlacement,
bindThreadMenuPositionListeners,
unbindThreadMenuPositionListeners,
bindProjectMenuDismissListeners,
unbindProjectMenuDismissListeners,
hasOpenDismissableMenu
};
}
