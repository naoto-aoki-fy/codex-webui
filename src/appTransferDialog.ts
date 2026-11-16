import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';
import type { Router } from 'vue-router';
import { cancelConversationTransfer, prepareConversationTransfer, reasoningCatalog } from './api/codexGateway';
import { defaultModelForProvider, modelSelectionKey, parseModelSelection } from './api/modelCapabilities';
import type { ForkMethod, PortableRevertTarget, UiMessage } from './types/codex';
/** Owns the existing prepare/select/confirm/cancel dialog state machine and native-fork publication. No automatic retry, injection replay, lifecycle hook or module-level state is introduced. */
export function createAppTransferDialog(deps: {
    messages: ComputedRef<UiMessage[]>;
    selectedThreadId: Ref<string, string>;
    composerSelectedModelId: ComputedRef<string>;
    forkThreadById: (threadId: string, transferId?: string, modelId?: string) => Promise<string>;
    forkThreadFromTurn: (threadId: string, _turnIndex: number, transferId?: string, modelId?: string) => Promise<string>;
    desktopError: Ref<string, string>;
    router: Pick<Router, 'push'>;
    isMobile: Ref<boolean, boolean>;
    setSidebarCollapsed: (nextValue: boolean) => void;
    forkNativeThreadById: (threadId: string, turnIndex?: number, expectedTurnId?: string) => Promise<string>;
}) {
    const transferPicker = ref<null | {
        sourceId: string;
        turnIndex?: number;
        turnId?: string;
        revertTarget?: PortableRevertTarget;
        id: string;
        loading: boolean;
        pending: boolean;
        failure: string;
    }>(null);
    const nativeForkPending = ref(false);
    const nativeForkFailure = ref('');
    const isForkOperationPending = computed(() => nativeForkPending.value || transferPicker.value !== null);
    const canConfirmFork = computed(() => {
        const picker = transferPicker.value;
        return !!picker && !picker.pending && !picker.loading && !!picker.id && !picker.failure && !!transferModel.value && transferProviderOptions.value.some(option => option.value === transferProvider.value);
    });
    const transferProvider = ref('');
    const isSelectedThreadImportIncomplete = computed(() => deps.messages.value.some(message => message.id === `import-status-${deps.selectedThreadId.value}`));
    const transferProviderOptions = computed(() => [...new Map(reasoningCatalog.value.filter(model => !!model.modelProvider)
            .map(model => [model.modelProvider!, { value: model.modelProvider!, label: model.providerDisplayName || model.modelProvider! }])).values()]);
    const transferModel = computed(() => {
        const model = defaultModelForProvider(reasoningCatalog.value, transferProvider.value);
        return model && transferProvider.value ? modelSelectionKey(transferProvider.value, model) : '';
    });
    async function openTransferPicker(sourceId: string, turnIndex?: number, revertTarget?: PortableRevertTarget): Promise<void> {
        if (isForkOperationPending.value)
            return;
        const turnId = turnIndex !== undefined && deps.selectedThreadId.value === sourceId ? deps.messages.value.find(message => message.role === 'assistant' && message.turnIndex === turnIndex)?.turnId : undefined;
        transferPicker.value = { sourceId, turnIndex, turnId, revertTarget, id: '', loading: true, pending: false, failure: '' };
        const picker = transferPicker.value;
        // Capture the opening selection without binding later dialog choices to the composer.
        const composerProvider = parseModelSelection(deps.composerSelectedModelId.value).provider;
        transferProvider.value = '';
        try {
            const prepared = await prepareConversationTransfer(sourceId, turnIndex, turnId, revertTarget);
            Object.assign(picker, prepared);
            // Cancellation can finish while this read is pending.
            if (transferPicker.value !== picker)
                await cancelConversationTransfer(prepared.id);
            else {
                const options = transferProviderOptions.value;
                transferProvider.value = (options.find(option => option.value === composerProvider)
                    ?? options.find(option => option.value !== prepared.sourceModelProvider) ?? options[0])?.value ?? '';
            }
        }
        catch (cause) {
            picker.failure = cause instanceof Error ? cause.message : String(cause);
        }
        finally {
            picker.loading = false;
        }
    }
    async function cancelTransferPicker(): Promise<void> {
        const picker = transferPicker.value;
        if (!picker || picker.pending)
            return;
        transferPicker.value = null;
        if (picker.id)
            await cancelConversationTransfer(picker.id).catch(() => { });
    }
    async function confirmTransferPicker(): Promise<void> {
        const picker = transferPicker.value;
        if (!picker || !canConfirmFork.value)
            return;
        picker.pending = true;
        const nextId = picker.turnIndex === undefined
            ? await deps.forkThreadById(picker.sourceId, picker.id, transferModel.value)
            : await deps.forkThreadFromTurn(picker.sourceId, picker.turnIndex, picker.id, transferModel.value);
        picker.pending = false;
        if (!nextId) {
            picker.failure = deps.desktopError.value || 'Import did not complete. Do not retry injection.';
            return;
        }
        transferPicker.value = null;
        await navigateToFork(nextId);
    }
    async function navigateToFork(threadId: string): Promise<void> {
        await deps.router.push({ name: 'thread', params: { threadId } });
        if (deps.isMobile.value)
            deps.setSidebarCollapsed(true);
    }
    async function onForkThread(payload: {
        threadId: string;
        turnIndex?: number;
        method: ForkMethod;
    }): Promise<void> {
        if (isForkOperationPending.value)
            return;
        nativeForkFailure.value = '';
        if (payload.method === 'portable') {
            await openTransferPicker(payload.threadId, payload.turnIndex);
            return;
        }
        nativeForkPending.value = true;
        try {
            const turnId = payload.turnIndex !== undefined && deps.selectedThreadId.value === payload.threadId
                ? deps.messages.value.find(message => message.role === 'assistant' && message.turnIndex === payload.turnIndex)?.turnId : undefined;
            const nextId = await deps.forkNativeThreadById(payload.threadId, payload.turnIndex, turnId);
            if (nextId)
                await navigateToFork(nextId);
            else
                nativeForkFailure.value = deps.desktopError.value || 'Native Fork did not complete. Inspect the thread list before trying again.';
        }
        finally {
            nativeForkPending.value = false;
        }
    }
    async function onForkThreadFromMessage(payload: {
        threadId: string;
        turnIndex: number;
        method: ForkMethod;
    }): Promise<void> {
        await onForkThread(payload);
    }
    return {
transferPicker,
nativeForkFailure,
isForkOperationPending,
canConfirmFork,
transferProvider,
isSelectedThreadImportIncomplete,
transferProviderOptions,
openTransferPicker,
cancelTransferPicker,
confirmTransferPicker,
onForkThread,
onForkThreadFromMessage
};
}
