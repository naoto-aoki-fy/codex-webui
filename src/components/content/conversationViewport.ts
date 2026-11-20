import { computed, nextTick, ref, watch } from 'vue';
import type { ConversationProps } from "./conversationContracts";
type TaskListItem = {
    text: string;
    checked: boolean;
};
type TableAlignment = 'left' | 'center' | 'right' | null;
type ListItem = {
    paragraphs: string[];
    children?: MessageBlock[];
};
type MessageBlock = {
    kind: 'paragraph';
    value: string;
} | {
    kind: 'heading';
    level: number;
    value: string;
} | {
    kind: 'blockquote';
    value: string;
} | {
    kind: 'unorderedList';
    items: ListItem[];
} | {
    kind: 'taskList';
    items: TaskListItem[];
} | {
    kind: 'orderedList';
    items: ListItem[];
    start: number;
} | {
    kind: 'table';
    headers: string[];
    rows: string[][];
    alignments: TableAlignment[];
} | {
    kind: 'codeBlock';
    language: string;
    value: string;
} | {
    kind: 'thematicBreak';
} | {
    kind: 'image';
    url: string;
    alt: string;
    markdown: string;
};
/** Owns viewport refs, render window, navigation and scroll/image frame work. Component watchers call these methods in their existing order; invalidateThreadWork cancels frames and retires pending callbacks on thread changes/unmount. */
export function createConversationViewport(deps: {
    props: Readonly<ConversationProps>;
}) {
    const conversationListRef = ref<HTMLElement | null>(null);
    const bottomAnchorRef = ref<HTMLElement | null>(null);
    const autoFollowOutput = ref(true);
    const BOTTOM_THRESHOLD_PX = 16;
    let conversationScrollResolve: (() => void) | null = null;
    let conversationScrollFrame = 0;
    let bottomLockFrame = 0;
    let bottomLockFramesLeft = 0;
    let questionJumpScrollTop: number | null = null;
    let historyQuestionJump: { threadId: string; questionId: number } | null = null;
    let shouldRestoreHistoryScroll = false;
    let conversationUnmounted = false;
    let threadGeneration = 0;
    function isCurrentThreadGeneration(generation: number): boolean {
        return !conversationUnmounted && generation === threadGeneration;
    }
    let conversationScrollPromise: Promise<void> | null = null;
    let trackedPendingImages = new WeakSet<HTMLImageElement>();
    const RENDER_WINDOW_SIZE = 50;
    const LOAD_MORE_CHUNK = 30;
    const LOAD_MORE_SCROLL_THRESHOLD_PX = 200;
    const renderWindowStart = ref(0);
    const isLoadingMore = ref(false);
    const visibleMessages = computed(() => deps.props.messages.slice(renderWindowStart.value));
    const hasMoreAbove = computed(() => renderWindowStart.value > 0 || deps.props.hasMorePersistedAbove === true);
    const showJumpToLatestButton = computed(() => !autoFollowOutput.value && (deps.props.messages.length > 0 || deps.props.pendingRequests.length > 0 || Boolean(deps.props.liveOverlay)));
    let navigationMessageId: string | null = null;
    let navigationScrollTop = -1;
    let messageNavigationPending = false;
    function resetMessageNavigation(): void {
        navigationMessageId = null;
        historyQuestionJump = null;
    }
    async function navigateMessage(direction: -1 | 1): Promise<void> {
        const container = conversationListRef.value;
        if (!container || messageNavigationPending)
            return;
        messageNavigationPending = true;
        historyQuestionJump = null;
        const generation = threadGeneration;
        autoFollowOutput.value = false;
        if (bottomLockFrame)
            cancelAnimationFrame(bottomLockFrame);
        bottomLockFrame = 0;
        try {
            const findTarget = (): HTMLElement | undefined => {
                const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > li[data-navigation-message="true"]'));
                const current = Math.abs(container.scrollTop - navigationScrollTop) <= 2
                    ? rows.findIndex((row) => row.dataset.messageId === navigationMessageId)
                    : -1;
                if (current >= 0)
                    return rows[current + direction];
                const top = container.getBoundingClientRect().top + container.clientTop;
                return direction === -1
                    ? rows.reverse().find((row) => row.getBoundingClientRect().top < top - 2)
                    : rows.find((row) => row.getBoundingClientRect().top > top + 2);
            };
            let target = findTarget();
            if (!target && direction === -1 && hasMoreAbove.value) {
                await loadMoreAbove();
                if (!isCurrentThreadGeneration(generation))
                    return;
                target = findTarget();
            }
            if (!target)
                return;
            navigationMessageId = target.dataset.messageId ?? null;
            container.scrollTop += target.getBoundingClientRect().top
                - container.getBoundingClientRect().top - container.clientTop;
            navigationScrollTop = container.scrollTop;
        }
        finally {
            messageNavigationPending = false;
        }
    }
    function onMessageNavigationKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
            return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
            return;
        if (!conversationListRef.value || deps.props.isLoading)
            return;
        // Leave modal controls to their own keyboard handlers.
        const target = event.target;
        if (target instanceof Element && target.closest('[role="dialog"], [aria-modal="true"]'))
            return;
        event.preventDefault();
        void navigateMessage(event.key === 'ArrowUp' ? -1 : 1);
    }
    function scrollToBottom(): void {
        const container = conversationListRef.value;
        const anchor = bottomAnchorRef.value;
        if (!container || !anchor)
            return;
        container.scrollTop = container.scrollHeight;
        anchor.scrollIntoView({ block: 'end' });
    }
    function isAtBottom(container: HTMLElement): boolean {
        const distance = container.scrollHeight - (container.scrollTop + container.clientHeight);
        return distance <= BOTTOM_THRESHOLD_PX;
    }
    function applyConversationScrollState(): void {
        const container = conversationListRef.value;
        if (!container)
            return;
        if (autoFollowOutput.value) {
            enforceBottomState();
            return;
        }
    }
    function enforceBottomState(): void {
        const container = conversationListRef.value;
        if (!container)
            return;
        scrollToBottom();
    }
    function shouldLockToBottom(): boolean {
        return autoFollowOutput.value;
    }
    function runBottomLockFrame(): void {
        if (!shouldLockToBottom()) {
            bottomLockFramesLeft = 0;
            bottomLockFrame = 0;
            return;
        }
        enforceBottomState();
        bottomLockFramesLeft -= 1;
        if (bottomLockFramesLeft <= 0) {
            bottomLockFrame = 0;
            return;
        }
        bottomLockFrame = requestAnimationFrame(runBottomLockFrame);
    }
    function scheduleBottomLock(frames = 6): void {
        if (!shouldLockToBottom())
            return;
        if (bottomLockFrame) {
            cancelAnimationFrame(bottomLockFrame);
            bottomLockFrame = 0;
        }
        bottomLockFramesLeft = Math.max(frames, 1);
        bottomLockFrame = requestAnimationFrame(runBottomLockFrame);
    }
    function jumpToLatest(): void {
        resetMessageNavigation();
        questionJumpScrollTop = null;
        autoFollowOutput.value = true;
        enforceBottomState();
        scheduleBottomLock(4);
    }
    function findQuestionHeading(): HTMLButtonElement | null {
        return conversationListRef.value?.querySelector<HTMLButtonElement>('[data-pending-question-heading]') ?? null;
    }
    watch(() => deps.props.pendingQuestion?.id, () => {
        historyQuestionJump = null;
    }, { flush: 'sync' });
    function onQuestionFocusIn(event: FocusEvent): void {
        if (historyQuestionJump && event.target !== findQuestionHeading())
            historyQuestionJump = null;
    }
    function applyQuestionJump(heading: HTMLButtonElement, restore: boolean): void {
        const container = conversationListRef.value;
        if (!container)
            return;
        autoFollowOutput.value = false;
        if (bottomLockFrame)
            cancelAnimationFrame(bottomLockFrame);
        bottomLockFrame = 0;
        bottomLockFramesLeft = 0;
        const previousScrollTop = container.scrollTop;
        const top = container.getBoundingClientRect().top + container.clientTop;
        const bounds = heading.getBoundingClientRect();
        if (!restore || bounds.top < top || bounds.bottom > top + container.clientHeight)
            container.scrollTo({ top: previousScrollTop + bounds.top - top - 8, behavior: 'instant' });
        if (restore || container.scrollTop !== previousScrollTop)
            questionJumpScrollTop = container.scrollTop;
        if (!restore || heading.ownerDocument.activeElement !== heading)
            heading.focus({ preventScroll: true });
    }
    function jumpToQuestion(heading: HTMLButtonElement): void {
        resetMessageNavigation();
        shouldRestoreHistoryScroll = false;
        applyQuestionJump(heading, false);

        const questionId = deps.props.pendingQuestion?.id;
        if (isLoadingMore.value && questionId !== undefined)
            historyQuestionJump = { threadId: deps.props.activeThreadId, questionId };
    }
    async function loadMoreAbove(): Promise<void> {
        const container = conversationListRef.value;
        if (!container || !hasMoreAbove.value || isLoadingMore.value || deps.props.isLoadingPersistedAbove === true)
            return;
        isLoadingMore.value = true;
        shouldRestoreHistoryScroll = true;
        const threadIdAtStart = deps.props.activeThreadId;
        const generation = threadGeneration;
        const prevScrollHeight = container.scrollHeight;
        const prevScrollTop = container.scrollTop;
        try {
            if (renderWindowStart.value > 0) {
                renderWindowStart.value = Math.max(0, renderWindowStart.value - LOAD_MORE_CHUNK);
            }
            else if (deps.props.hasMorePersistedAbove === true) {
                await deps.props.loadEarlierMessages?.(threadIdAtStart);
            }
            await nextTick();
            if (!isCurrentThreadGeneration(generation))
                return;
            const jump = historyQuestionJump;
            if (jump && jump.threadId === deps.props.activeThreadId && jump.questionId === deps.props.pendingQuestion?.id) {
                const heading = findQuestionHeading();
                if (heading)
                    applyQuestionJump(heading, true);
            }
            else if (shouldRestoreHistoryScroll) {
                container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
            }
        }
        finally {
            if (isCurrentThreadGeneration(generation)) {
                historyQuestionJump = null;
                isLoadingMore.value = false;
            }
        }
    }
    function bindPendingImageHandlers(): void {
        if (!shouldLockToBottom())
            return;
        const container = conversationListRef.value;
        if (!container)
            return;
        const images = container.querySelectorAll<HTMLImageElement>('img.message-image-preview');
        for (const image of images) {
            if (image.complete || trackedPendingImages.has(image))
                continue;
            trackedPendingImages.add(image);
            const generation = threadGeneration;
            const onPendingImageSettled = () => {
                if (isCurrentThreadGeneration(generation))
                    scheduleBottomLock(3);
            };
            image.addEventListener('load', onPendingImageSettled, { once: true });
            image.addEventListener('error', onPendingImageSettled, { once: true });
        }
    }
    async function scheduleConversationScroll(): Promise<void> {
        if (conversationScrollPromise)
            return conversationScrollPromise;
        const generation = threadGeneration;
        const pending = nextTick().then(() => new Promise<void>((resolve) => {
            if (!isCurrentThreadGeneration(generation)) {
                resolve();
                return;
            }
            conversationScrollResolve = resolve;
            conversationScrollFrame = requestAnimationFrame(() => {
                conversationScrollFrame = 0;
                conversationScrollResolve = null;
                if (isCurrentThreadGeneration(generation)) {
                    applyConversationScrollState();
                    bindPendingImageHandlers();
                    scheduleBottomLock();
                }
                resolve();
            });
        })).finally(() => {
            if (conversationScrollPromise === pending)
                conversationScrollPromise = null;
        });
        conversationScrollPromise = pending;
        return conversationScrollPromise;
    }
    function invalidateThreadWork(): void {
        threadGeneration += 1;
        questionJumpScrollTop = null;
        historyQuestionJump = null;
        shouldRestoreHistoryScroll = false;
        trackedPendingImages = new WeakSet<HTMLImageElement>();
        if (conversationScrollFrame)
            cancelAnimationFrame(conversationScrollFrame);
        conversationScrollFrame = 0;
        conversationScrollResolve?.();
        conversationScrollResolve = null;
        conversationScrollPromise = null;
        if (bottomLockFrame)
            cancelAnimationFrame(bottomLockFrame);
        bottomLockFrame = 0;
        bottomLockFramesLeft = 0;
    }
    function onConversationScroll(): void {
        const container = conversationListRef.value;
        if (!container || deps.props.isLoading)
            return;
        const isQuestionJump = container.scrollTop === questionJumpScrollTop;
        questionJumpScrollTop = null;
        if (isQuestionJump)
            return;
        historyQuestionJump = null;
        autoFollowOutput.value = isAtBottom(container);
        if (!autoFollowOutput.value && hasMoreAbove.value && !isLoadingMore.value && container.scrollTop < LOAD_MORE_SCROLL_THRESHOLD_PX) {
            void loadMoreAbove();
        }
    }
    return {
conversationListRef,
bottomAnchorRef,
autoFollowOutput,
get conversationUnmounted() { return conversationUnmounted; },
set conversationUnmounted(value) { conversationUnmounted = value; },
get threadGeneration() { return threadGeneration; },
isCurrentThreadGeneration,
RENDER_WINDOW_SIZE,
renderWindowStart,
isLoadingMore,
visibleMessages,
hasMoreAbove,
showJumpToLatestButton,
resetMessageNavigation,
onMessageNavigationKeydown,
enforceBottomState,
scheduleBottomLock,
jumpToLatest,
findQuestionHeading,
onQuestionFocusIn,
jumpToQuestion,
loadMoreAbove,
bindPendingImageHandlers,
scheduleConversationScroll,
invalidateThreadWork,
onConversationScroll
};
}
