import { recordSubmittedPrompt } from '../../utils/promptLibrary'
import type { Ref } from 'vue';
import { computed, nextTick, ref } from 'vue';
import { searchComposerFiles, type ComposerFileSuggestion } from '../../api/codexGateway';
import type { CollaborationModeKind, SpeedMode } from '../../types/codex';
import { persistDraftForThread, type ComposerDraftPayload } from '../../utils/composerDraftStorage';
import { createComposerAttachments } from './composerAttachments';
import type { ComposerProps, SlashSuggestion, SubmitPayload } from "./composerContracts";
import { createComposerSettings } from './composerSettings';
/** Single owner of live text, suggestions, keyboard/IME, submit settlement and draft generation. Attachment and settings controllers supply their owned selections. Component hooks persist thread changes and clear the mention debounce timer on unmount. */
export function createComposerInput(deps: {
    props: Readonly<ComposerProps>;
    settings: ReturnType<typeof createComposerSettings>;
    emit: ((evt: "submit", payload: SubmitPayload, settle: (accepted: boolean) => void) => void) & ((evt: "thread-action", action: string) => void) & ((evt: "interrupt") => void) & ((evt: "edit-goal") => void) & ((evt: "update:selected-collaboration-mode", mode: CollaborationModeKind) => void) & ((evt: "update:selected-model", modelId: string) => void) & ((evt: "update:selected-reasoning-effort", effort: string) => void) & ((evt: "update:selected-speed-mode", mode: SpeedMode) => void);
    attachments: ReturnType<typeof createComposerAttachments>;
    isAttachMenuOpen: Ref<boolean, boolean>;
    isMobile: Ref<boolean, boolean>;
}) {
    const appsUnavailable = ref(false);
    const queueMode = ref(false);
    const selectedApps = ref<import('../../api/apps').AppReference[]>([]);
    const draft = ref('');
    const promptLibraryOpen = ref(false);
    const promptStorageNotice = ref('');
    const slashQuery = ref<string | null>(null);
    const slashStart = ref(0);
    const slashCursor = ref(0);
    const slashIndex = ref(0);
    const slashSuggestions = computed<SlashSuggestion[]>(() => {
        const query = (slashQuery.value ?? '').toLowerCase();
        const commands: SlashSuggestion[] = [
            { name: 'goal', description: 'Set or manage the goal for this thread' },
            { name: 'plan', description: 'Toggle plan mode for this thread' },
            { name: 'prompts', description: 'Open editable text presets and recent prompts' },
            { name: 'history', description: 'Open recent submitted prompts (editable, never auto-send)' },
            { name: 'presets', description: 'Manage text presets' },
            { name: 'help', description: 'Discover supported commands' },
            ...(deps.props.activeThreadId === '__new-thread__' ? [] : ['review','compact','diff','processes'].map(name => ({name,description:`Open ${name} controls; does not execute automatically`}))),
        ].filter(item => item.name.includes(query));
        const skills = (deps.props.skills ?? []).filter(skill => skill.enabled !== false && skill.name.trim() && skill.path.trim())
            .map(skill => ({ name: skill.displayName || skill.name, description: skill.description, skill }))
            .filter(item => `${item.name} ${item.skill.name} ${item.description} ${item.skill.path}`.toLowerCase().includes(query))
            .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name));
        return [...skills, ...commands].slice(0, 20);
    });
    function updateSlashSuggestions() {
        const cursor = inputRef.value?.selectionStart ?? draft.value.length;
        const match = /(?:^|\s)\/([^\s/]*)$/.exec(draft.value.slice(0, cursor));
        slashQuery.value = match?.[1] ?? null;
        slashCursor.value = cursor;
        slashStart.value = match ? cursor - match[1]!.length - 1 : cursor;
        slashIndex.value = 0;
    }
    function applySlashSuggestion(item: SlashSuggestion) {
        const before = draft.value.slice(0, slashStart.value);
        const after = draft.value.slice(slashCursor.value);
        if (item.skill) {
            if (!deps.settings.selectedSkills.value.some(skill => skill.path === item.skill!.path))
                deps.settings.selectedSkills.value.push(item.skill);
            draft.value = before + after;
        }
        else if (['prompts','history','presets','help','review','compact','diff','processes'].includes(item.name)) {
            openCommand(item.name);
            draft.value = before + after;
        }
        else if (item.name === 'plan') {
            deps.emit('update:selected-collaboration-mode', deps.settings.isPlanModeSelected.value ? 'default' : 'plan');
            draft.value = before + after;
        }
        else {
            draft.value = before + '/goal ' + after;
        }
        slashQuery.value = null;
        nextTick(() => inputRef.value?.focus());
    }
    const inputRef = ref<HTMLTextAreaElement | null>(null);
    const mentionStartIndex = ref<number | null>(null);
    const mentionQuery = ref('');
    const fileMentionSuggestions = ref<ComposerFileSuggestion[]>([]);
    const isFileMentionOpen = ref(false);
    const fileMentionHighlightedIndex = ref(0);
    const isComposerExpanded = ref(false);
    const isDraftOverflowing = ref(false);
    let composerOverflowMeasurementQueued = false;
    const draftGeneration = ref(0);
    let fileMentionSearchToken = 0;
    let fileMentionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    const isSubmitting = ref(false);
    const canSubmit = computed(() => {
        if(queueMode.value&&!deps.props.queueReady)return false;
        if (appsUnavailable.value) return false;
        if (isSubmitting.value)
            return false;
        if (deps.props.disabled)
            return false;
        if (deps.props.isUpdatingSpeedMode)
            return false;
        if (!deps.props.activeThreadId)
            return false;
        if (deps.settings.isPlanModeWaitingForModel.value)
            return false;
        if (deps.attachments.pendingAttachmentCount.value > 0)
            return false;
        return draft.value.trim().length > 0 || deps.attachments.selectedImages.value.length > 0 || deps.attachments.fileAttachments.value.length > 0;
    });
    const hasUnsavedDraft = computed(() => selectedApps.value.length > 0 || draft.value.trim().length > 0
        || deps.attachments.selectedImages.value.length > 0
        || deps.settings.selectedSkills.value.length > 0
        || deps.attachments.fileAttachments.value.length > 0);
    const isInteractionDisabled = computed(() => deps.props.disabled || !deps.props.activeThreadId);
    const placeholderText = computed(() => !deps.props.activeThreadId
        ? ('Select a thread to send a message')
        : deps.settings.isPlanModeWaitingForModel.value
            ? ('Loading models for plan mode...')
            : ('Type a message... (@ for files)'));
    const hasSubmitContent = computed(() => draft.value.trim().length > 0 || deps.attachments.selectedImages.value.length > 0 || deps.attachments.fileAttachments.value.length > 0);
    const draftLineCount = computed(() => draft.value.split('\n').length);
    const hasExpandedComposerToggle = computed(() => isComposerExpanded.value || draftLineCount.value >= 6 || isDraftOverflowing.value);
    function openCommand(name: string) {
        if (['prompts','history','presets','help'].includes(name)) promptLibraryOpen.value = true;
        else deps.emit('thread-action', name);
    }
    function populatePrompt(text: string) { draft.value = text; slashQuery.value = null; promptLibraryOpen.value = false; nextTick(() => inputRef.value?.focus()); }
    function onSubmit(): void {
        const text = draft.value.trim();
        if (!canSubmit.value)
            return;
        if (/^\/(prompts|presets|history|help|review|compact|diff|processes)$/.test(text) &&
            (!['/review','/compact','/diff','/processes'].includes(text) || deps.props.activeThreadId !== '__new-thread__')) {
            openCommand(text.slice(1)); draft.value = ''; slashQuery.value = null; return;
        }
        if (text === '/goal' && deps.props.activeThreadId !== '__new-thread__') {
            deps.emit('edit-goal');
            clearPersistedDraftForThread(deps.props.activeThreadId);
            clearDraftState();
            return;
        }
        if (text === '/plan') {
            deps.emit('update:selected-collaboration-mode', deps.settings.isPlanModeSelected.value ? 'default' : 'plan');
            clearPersistedDraftForThread(deps.props.activeThreadId);
            clearDraftState();
            return;
        }
        const threadId = deps.props.activeThreadId;
        const payload = getCurrentDraftPayload();
        const snapshot = JSON.stringify(payload);
        isSubmitting.value = true;
        let settled = false;
        deps.emit('submit', { ...payload, text, ...(queueMode.value?{queue:true}:{}) }, (accepted) => {
            if (settled)
                return;
            settled = true;
            isSubmitting.value = false;
            if (!accepted)
                return;
            promptStorageNotice.value = recordSubmittedPrompt(text);
            // Acceptance may arrive after a thread switch or after the user edits again.
            if (deps.props.activeThreadId !== threadId || JSON.stringify(getCurrentDraftPayload()) !== snapshot)
                return;
            clearPersistedDraftForThread(threadId);
            clearDraftState();
            isComposerExpanded.value = false;
            deps.isAttachMenuOpen.value = false;
            closeFileMention();
            if (isAndroid || deps.isMobile.value)
                inputRef.value?.blur();
            else
                nextTick(() => inputRef.value?.focus());
        });
    }
    function replaceDraftState(payload: ComposerDraftPayload): void {
        draftGeneration.value += 1;
        selectedApps.value = payload.apps?.map(app=>({...app})) ?? [];
        draft.value = payload.text;
        deps.attachments.selectedImages.value = payload.imageUrls.map((url, index) => ({
            id: `draft-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            name: `Image ${index + 1}`,
            url,
        }));
        deps.settings.selectedSkills.value = payload.skills.map((skill) => ((deps.props.skills ?? []).find((item) => item.path === skill.path)
            ?? { name: skill.name, displayName: undefined, description: '', path: skill.path }));
        deps.attachments.fileAttachments.value = payload.fileAttachments.map((attachment) => ({ ...attachment }));
        deps.attachments.attachmentBatchStats.value = null;
        deps.attachments.pendingAttachmentCount.value = 0;
        deps.isAttachMenuOpen.value = false;
        closeFileMention();
        deps.attachments.attachmentSessionToken += 1;
    }
    function clearDraftState(): void {
        slashQuery.value = null;
        replaceDraftState({
            text: '',
            imageUrls: [],
            fileAttachments: [],
            skills: [],
        });
        isComposerExpanded.value = false;
    }
    function clearPersistedDraftForThread(threadId: string): void {
        persistDraftForThread(threadId, {
            text: '',
            imageUrls: [],
            fileAttachments: [],
            skills: [],
        });
    }
    function getCurrentDraftPayload(): ComposerDraftPayload {
        return {
            ...(selectedApps.value.length ? {apps:selectedApps.value.map(app=>({...app}))} : {}),
            text: draft.value,
            imageUrls: deps.attachments.selectedImages.value.map((image) => image.url),
            fileAttachments: deps.attachments.fileAttachments.value.map((attachment) => ({ ...attachment })),
            skills: deps.settings.selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
        };
    }
    function onInterrupt(): void {
        deps.emit('interrupt');
    }
    function updateComposerOverflowState(): void {
        const input = inputRef.value;
        if (!input) {
            isDraftOverflowing.value = false;
            return;
        }
        isDraftOverflowing.value = input.scrollHeight > input.clientHeight + 2;
    }
    function queueComposerOverflowMeasurement(): void {
        if (composerOverflowMeasurementQueued)
            return;
        composerOverflowMeasurementQueued = true;
        void nextTick(() => {
            composerOverflowMeasurementQueued = false;
            updateComposerOverflowState();
        });
    }
    function toggleComposerExpanded(): void {
        if (isInteractionDisabled.value)
            return;
        isComposerExpanded.value = !isComposerExpanded.value;
        queueComposerOverflowMeasurement();
        void nextTick(() => inputRef.value?.focus());
    }
    function onInputChange(): void {
        queueComposerOverflowMeasurement();
        updateSlashSuggestions();
        updateFileMentionState();
    }
    function onInputKeydown(event: KeyboardEvent): void {
        if (event.isComposing)
            return;
        if (slashQuery.value !== null) {
            if (event.key === 'Escape') {
                event.preventDefault();
                slashQuery.value = null;
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const size = slashSuggestions.value.length;
                if (size)
                    slashIndex.value = (slashIndex.value + (event.key === 'ArrowDown' ? 1 : size - 1)) % size;
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                const item = slashSuggestions.value[slashIndex.value];
                if (item) {
                    event.preventDefault();
                    applySlashSuggestion(item);
                    return;
                }
            }
        }
        if (isFileMentionOpen.value) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeFileMention();
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (fileMentionSuggestions.value.length > 0) {
                    fileMentionHighlightedIndex.value =
                        (fileMentionHighlightedIndex.value + 1) % fileMentionSuggestions.value.length;
                }
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (fileMentionSuggestions.value.length > 0) {
                    const size = fileMentionSuggestions.value.length;
                    fileMentionHighlightedIndex.value = (fileMentionHighlightedIndex.value + size - 1) % size;
                }
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const selected = fileMentionSuggestions.value[fileMentionHighlightedIndex.value];
                if (selected) {
                    applyFileMention(selected);
                }
                else {
                    closeFileMention();
                }
                return;
            }
        }
        const shouldSend = deps.props.sendWithEnter !== false
            ? event.key === 'Enter' && !event.shiftKey
            : event.key === 'Enter' && (event.metaKey || event.ctrlKey);
        if (shouldSend) {
            event.preventDefault();
            onSubmit();
            return;
        }
    }
    function closeFileMention(): void {
        isFileMentionOpen.value = false;
        mentionStartIndex.value = null;
        mentionQuery.value = '';
        fileMentionSuggestions.value = [];
        fileMentionHighlightedIndex.value = 0;
    }
    function updateFileMentionState(): void {
        const input = inputRef.value;
        if (!input) {
            closeFileMention();
            return;
        }
        const cursor = input.selectionStart ?? draft.value.length;
        const beforeCursor = draft.value.slice(0, cursor);
        const match = beforeCursor.match(/(^|\s)(@[^\s@]*)$/);
        if (!match) {
            closeFileMention();
            return;
        }
        const mentionToken = match[2] ?? '';
        const mentionOffset = mentionToken.length;
        const startIndex = cursor - mentionOffset;
        mentionStartIndex.value = startIndex;
        mentionQuery.value = mentionToken.slice(1);
        isFileMentionOpen.value = true;
        void queueFileMentionSearch();
    }
    async function queueFileMentionSearch(): Promise<void> {
        if (!isFileMentionOpen.value)
            return;
        const cwd = (deps.props.cwd ?? '').trim();
        if (!cwd) {
            fileMentionSuggestions.value = [];
            return;
        }
        if (fileMentionDebounceTimer) {
            clearTimeout(fileMentionDebounceTimer);
        }
        const token = ++fileMentionSearchToken;
        fileMentionDebounceTimer = setTimeout(async () => {
            try {
                const rows = await searchComposerFiles(cwd, mentionQuery.value, 20);
                if (!isFileMentionOpen.value || token !== fileMentionSearchToken)
                    return;
                fileMentionSuggestions.value = rows;
                fileMentionHighlightedIndex.value = 0;
            }
            catch {
                if (!isFileMentionOpen.value || token !== fileMentionSearchToken)
                    return;
                fileMentionSuggestions.value = [];
            }
        }, 120);
    }
    function applyFileMention(suggestion: ComposerFileSuggestion): void {
        const input = inputRef.value;
        const start = mentionStartIndex.value;
        if (start !== null && input) {
            const cursor = input.selectionStart ?? draft.value.length;
            draft.value = `${draft.value.slice(0, start)}${draft.value.slice(cursor)}`.trimEnd();
        }
        deps.attachments.addFileAttachment(suggestion.path);
        closeFileMention();
        nextTick(() => input?.focus());
    }
    function hydrateDraft(payload: ComposerDraftPayload): void {
        replaceDraftState(payload);
        void nextTick(() => {
            inputRef.value?.focus();
            updateComposerOverflowState();
        });
    }
    function appendTextToDraft(text: string): void {
        const nextText = text.trim();
        if (!nextText)
            return;
        if (draft.value.trim().length > 0) {
            draft.value = `${draft.value.trimEnd()}\n${nextText}`;
        }
        else {
            draft.value = nextText;
        }
        nextTick(() => inputRef.value?.focus());
    }
    function getMentionFileName(path: string): string {
        const idx = path.lastIndexOf('/');
        if (idx < 0)
            return path;
        return path.slice(idx + 1);
    }
    function getMentionDirName(path: string): string {
        const idx = path.lastIndexOf('/');
        if (idx <= 0)
            return '';
        return path.slice(0, idx);
    }
    function getFileExtension(path: string): string {
        const base = getMentionFileName(path);
        const idx = base.lastIndexOf('.');
        if (idx <= 0)
            return '';
        return base.slice(idx + 1).toLowerCase();
    }
    function getMentionBadgeText(path: string): string {
        const ext = getFileExtension(path);
        if (ext === 'ts')
            return 'TS';
        if (ext === 'tsx')
            return 'TSX';
        if (ext === 'js')
            return 'JS';
        if (ext === 'jsx')
            return 'JSX';
        if (ext === 'json')
            return '{}';
        return '';
    }
    function getMentionBadgeClass(path: string): string {
        const ext = getFileExtension(path);
        if (ext.startsWith('ts'))
            return 'ts';
        if (ext.startsWith('js'))
            return 'js';
        if (ext === 'json')
            return 'json';
        return 'default';
    }
    function isMarkdownFile(path: string): boolean {
        const ext = getFileExtension(path);
        return ext === 'md' || ext === 'mdx';
    }
    return {
queueMode, appsUnavailable, selectedApps, promptLibraryOpen, promptStorageNotice, populatePrompt,
draft,
slashQuery,
slashIndex,
slashSuggestions,
applySlashSuggestion,
inputRef,
fileMentionSuggestions,
isFileMentionOpen,
fileMentionHighlightedIndex,
isComposerExpanded,
get fileMentionDebounceTimer() { return fileMentionDebounceTimer; },
set fileMentionDebounceTimer(value) { fileMentionDebounceTimer = value; },
canSubmit,
hasUnsavedDraft,
isInteractionDisabled,
placeholderText,
hasSubmitContent,
hasExpandedComposerToggle,
onSubmit,
replaceDraftState,
clearDraftState,
getCurrentDraftPayload,
onInterrupt,
queueComposerOverflowMeasurement,
toggleComposerExpanded,
onInputChange,
onInputKeydown,
closeFileMention,
queueFileMentionSearch,
applyFileMention,
hydrateDraft,
appendTextToDraft,
getMentionFileName,
getMentionDirName,
getMentionBadgeText,
getMentionBadgeClass,
isMarkdownFile
};
}
