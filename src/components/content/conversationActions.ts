import type { ComputedRef } from 'vue';
import { computed, ref } from 'vue';
import type { ForkMethod, RevertOperation, UiMessage } from '../../types/codex';
import { copyTextToClipboard } from '../../utils/clipboard';
import { isCopyableAssistantMessage, type TurnFileChangeSummary } from '../../utils/conversationFileChanges';
import type { ConversationPlan } from '../../utils/conversationPlan';
import { isPlanMessage } from '../../utils/conversationPlan';
import { buildUserMessageCopyText } from '../../utils/userMessageCopy';
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
/** Owns message-action feedback and timers, copy content and native/Portable fork/edit boundaries. Uses viewport generation checks after async copy. The component clears feedback timers on thread changes and unmount. */
export function createConversationActions(deps: {
    readonly threadGeneration: number;
    readPlan: (message: UiMessage) => ConversationPlan;
    isCurrentThreadGeneration: (generation: number) => boolean;
    props: Readonly<ConversationProps>;
    anchoredFileChangeSummaryByAnchorId: ComputedRef<Record<string, TurnFileChangeSummary>>;
    buildFileChangeCopyText: (summary: TurnFileChangeSummary | null) => string;
    emit: ((evt: "forkThread", payload: {
        threadId: string;
        turnIndex: number;
        method: ForkMethod;
    }) => void) & ((evt: "rollback", payload: {
        threadId: string;
        turnId: string;
        operation: RevertOperation;
        messageId?: string;
    }) => void) & ((evt: "implementPlan", payload: {
        turnId: string;
    }) => void);
}) {
    const copiedResponseAnchorId = ref('');
    const copiedUserMessageId = ref('');
    const copiedPlanId = ref('');
    let copiedMessageResetTimer: ReturnType<typeof setTimeout> | null = null;
    let copiedUserMessageResetTimer: ReturnType<typeof setTimeout> | null = null;
    let copiedPlanResetTimer: ReturnType<typeof setTimeout> | null = null;
    async function copyPlan(message: UiMessage): Promise<void> {
        const generation = deps.threadGeneration;
        const content = deps.readPlan(message).copyText || message.text.trim();
        if (!content)
            return;
        try {
            await copyTextToClipboard(content);
        }
        catch {
            return;
        }
        if (!deps.isCurrentThreadGeneration(generation))
            return;
        copiedPlanId.value = message.id;
        if (copiedPlanResetTimer)
            clearTimeout(copiedPlanResetTimer);
        copiedPlanResetTimer = setTimeout(() => {
            copiedPlanId.value = '';
            copiedPlanResetTimer = null;
        }, 1800);
    }
    function buildCopyableMessageContent(message: UiMessage): string {
        const sections: string[] = [];
        const rawTextContent = message.text.trim() || deps.readPlan(message).copyText;
        const textContent = isPlanMessage(message) && rawTextContent
            ? `Plan\n${rawTextContent}`
            : rawTextContent;
        if (textContent) {
            sections.push(textContent);
        }
        const attachmentLines = (message.fileAttachments ?? [])
            .map((attachment) => attachment.path.trim())
            .filter((pathValue) => pathValue.length > 0);
        if (attachmentLines.length > 0) {
            sections.push(`Files:\n${attachmentLines.join('\n')}`);
        }
        const imageLines = (message.images ?? [])
            .map((imageUrl) => imageUrl.trim())
            .filter((imageUrl) => imageUrl.length > 0);
        if (imageLines.length > 0) {
            sections.push(`Images:\n${imageLines.join('\n')}`);
        }
        return sections.join('\n\n').trim();
    }
    const copyableResponseContentByAnchorId = computed<Record<string, string>>(() => {
        const groupedResponses = new Map<string, {
            anchorMessageId: string;
            parts: string[];
        }>();
        for (const message of deps.props.messages) {
            if (!isCopyableAssistantMessage(message))
                continue;
            const content = buildCopyableMessageContent(message);
            if (!content)
                continue;
            const responseKey = typeof message.turnIndex === 'number'
                ? `turn:${message.turnIndex}`
                : `message:${message.id}`;
            const existing = groupedResponses.get(responseKey);
            if (existing) {
                existing.anchorMessageId = message.id;
                existing.parts.push(content);
                continue;
            }
            groupedResponses.set(responseKey, {
                anchorMessageId: message.id,
                parts: [content],
            });
        }
        const next: Record<string, string> = {};
        for (const response of groupedResponses.values()) {
            const content = response.parts.join('\n\n').trim();
            if (!content)
                continue;
            next[response.anchorMessageId] = content;
        }
        for (const [anchorMessageId, summary] of Object.entries(deps.anchoredFileChangeSummaryByAnchorId.value)) {
            if (summary.source !== 'metadata')
                continue;
            const fileChangeCopy = deps.buildFileChangeCopyText(summary);
            if (!fileChangeCopy)
                continue;
            const existing = next[anchorMessageId]?.trim();
            next[anchorMessageId] = existing ? `${existing}\n\n${fileChangeCopy}` : fileChangeCopy;
        }
        return next;
    });
    const forkableTurnIndexByAnchorId = computed<Record<string, number>>(() => {
        const groupedTurns = new Map<string, {
            anchorMessageId: string;
            turnIndex: number;
        }>();
        for (const message of deps.props.messages) {
            if (!isCopyableAssistantMessage(message) || typeof message.turnIndex !== 'number')
                continue;
            const responseKey = `turn:${message.turnIndex}`;
            const existing = groupedTurns.get(responseKey);
            if (existing) {
                existing.anchorMessageId = message.id;
                existing.turnIndex = message.turnIndex;
                continue;
            }
            groupedTurns.set(responseKey, {
                anchorMessageId: message.id,
                turnIndex: message.turnIndex,
            });
        }
        const next: Record<string, number> = {};
        for (const groupedTurn of groupedTurns.values()) {
            next[groupedTurn.anchorMessageId] = groupedTurn.turnIndex;
        }
        return next;
    });
    function showCopyResponseButton(message: UiMessage): boolean {
        return typeof copyableResponseContentByAnchorId.value[message.id] === 'string';
    }
    function showForkResponseButton(message: UiMessage): boolean {
        return typeof forkableTurnIndexByAnchorId.value[message.id] === 'number';
    }
    async function copyUserMessage(message: UiMessage): Promise<void> {
        const generation = deps.threadGeneration;
        const content = buildUserMessageCopyText(message);
        if (!content)
            return;
        try {
            await copyTextToClipboard(content);
        }
        catch {
            return;
        }
        if (!deps.isCurrentThreadGeneration(generation))
            return;
        copiedUserMessageId.value = message.id;
        if (copiedUserMessageResetTimer)
            clearTimeout(copiedUserMessageResetTimer);
        copiedUserMessageResetTimer = setTimeout(() => {
            copiedUserMessageId.value = '';
            copiedUserMessageResetTimer = null;
        }, 1800);
    }
    async function copyResponse(anchorMessageId: string): Promise<void> {
        const generation = deps.threadGeneration;
        const content = copyableResponseContentByAnchorId.value[anchorMessageId] ?? '';
        if (!content)
            return;
        try {
            await copyTextToClipboard(content);
        }
        catch {
            return;
        }
        if (!deps.isCurrentThreadGeneration(generation))
            return;
        copiedResponseAnchorId.value = anchorMessageId;
        if (copiedMessageResetTimer) {
            clearTimeout(copiedMessageResetTimer);
        }
        copiedMessageResetTimer = setTimeout(() => {
            if (copiedResponseAnchorId.value === anchorMessageId) {
                copiedResponseAnchorId.value = '';
            }
            copiedMessageResetTimer = null;
        }, 1800);
    }
    function forkResponse(anchorMessageId: string, method: ForkMethod = 'native'): void {
        const turnIndex = forkableTurnIndexByAnchorId.value[anchorMessageId];
        if (deps.props.isForkDisabled || typeof turnIndex !== 'number' || (method === 'native' && turnIndex < 0))
            return;
        if (!deps.props.activeThreadId)
            return;
        deps.emit('forkThread', {
            method,
            threadId: deps.props.activeThreadId,
            turnIndex,
        });
    }
    const editableTurnIdByMessageId = computed<Record<string, string>>(() => {
        const next: Record<string, string> = {};
        for (const message of deps.props.messages) {
            if (message.role !== 'user' || typeof message.turnIndex !== 'number')
                continue;
            const turnId = typeof message.turnId === 'string' && message.turnId.length > 0 ? message.turnId : '';
            if (!turnId || message.text.trim().length === 0)
                continue;
            next[message.id] = turnId;
        }
        return next;
    });
    function showEditMessageButton(message: UiMessage): boolean {
        return typeof editableTurnIdByMessageId.value[message.id] === 'string';
    }
    function editMessage(messageId: string, operation: string = 'fork-and-revert'): void {
        if (deps.props.isRevertDisabled || (operation !== 'revert' && operation !== 'fork-and-revert' && operation !== 'portable-fork-and-revert'))
            return;
        const turnId = editableTurnIdByMessageId.value[messageId];
        if (!turnId)
            return;
        deps.emit('rollback', { threadId: deps.props.activeThreadId, turnId, operation, ...(operation === 'portable-fork-and-revert' ? { messageId } : {}) });
    }
    return {
copiedResponseAnchorId,
copiedUserMessageId,
copiedPlanId,
get copiedMessageResetTimer() { return copiedMessageResetTimer; },
set copiedMessageResetTimer(value) { copiedMessageResetTimer = value; },
get copiedUserMessageResetTimer() { return copiedUserMessageResetTimer; },
set copiedUserMessageResetTimer(value) { copiedUserMessageResetTimer = value; },
get copiedPlanResetTimer() { return copiedPlanResetTimer; },
set copiedPlanResetTimer(value) { copiedPlanResetTimer = value; },
copyPlan,
forkableTurnIndexByAnchorId,
showCopyResponseButton,
showForkResponseButton,
copyUserMessage,
copyResponse,
forkResponse,
showEditMessageButton,
editMessage
};
}
