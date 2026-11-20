import type { Ref } from 'vue';
import { computed, nextTick, ref } from 'vue';
import { searchComposerFiles, type ComposerFileSuggestion } from '../../api/codexGateway';
import { persistDraftForThread, type ComposerDraftPayload } from '../../utils/composerDraftStorage';
import { createComposerAttachments } from './composerAttachments';
import type { ComposerProps, SkillSuggestion, SubmitPayload } from "./composerContracts";
import { createComposerSettings } from './composerSettings';
/** Single owner of live text, suggestions, keyboard/IME, submit settlement and draft generation. Attachment and settings controllers supply their owned selections. Component hooks persist thread changes and clear the mention debounce timer on unmount. */
export function createComposerInput(deps: {
    props: Readonly<ComposerProps>;
    settings: ReturnType<typeof createComposerSettings>;
    emit: ((evt: 'update:selected-queue-mode', queue: boolean) => void)
        & ((evt: 'submit', payload: SubmitPayload, settle: (accepted: boolean) => void) => void)
        & ((evt: 'interrupt') => void);
    attachments: ReturnType<typeof createComposerAttachments>;
    isAttachMenuOpen: Ref<boolean, boolean>;
    isMobile: Ref<boolean, boolean>;
}) {
    const appsUnavailable = ref(false);
    const localQueueMode = ref(false);
    const queueMode = computed({
        get: () => deps.props.selectedQueueMode ?? localQueueMode.value,
        set: (queue: boolean) => { localQueueMode.value = queue; deps.emit('update:selected-queue-mode', queue); },
    });
    const selectedApps = ref<import('../../api/apps').AppReference[]>([]);
    const draft = ref('');
    const skillQuery = ref<string | null>(null);
    const skillStart = ref(0);
    const skillCursor = ref(0);
    const skillIndex = ref(0);
    const skillSuggestions = computed<SkillSuggestion[]>(() => {
        const query = (skillQuery.value ?? '').toLowerCase();
        const skills = (deps.props.skills ?? []).filter(skill => skill.enabled !== false && skill.name.trim() && skill.path.trim())
            .map(skill => ({ name: skill.displayName || skill.name, description: skill.description, skill }))
            .filter(item => `${item.name} ${item.skill.name} ${item.description} ${item.skill.path}`.toLowerCase().includes(query))
            .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name));
        return skills.slice(0, 20);
    });
    function updateSkillSuggestions() {
        const cursor = inputRef.value?.selectionStart ?? draft.value.length;
        const match = /(?:^|\s)\/([^\s/]*)$/.exec(draft.value.slice(0, cursor));
        skillQuery.value = match?.[1] ?? null;
        skillCursor.value = cursor;
        skillStart.value = match ? cursor - match[1]!.length - 1 : cursor;
        skillIndex.value = 0;
    }
    function applySkillSuggestion(item: SkillSuggestion) {
        const before = draft.value.slice(0, skillStart.value);
        const after = draft.value.slice(skillCursor.value);
        if (!deps.settings.selectedSkills.value.some(skill => skill.path === item.skill.path))
            deps.settings.selectedSkills.value.push(item.skill);
        draft.value = before + after;
        skillQuery.value = null;
        nextTick(() => inputRef.value?.focus());
    }
    const inputRef = ref<HTMLTextAreaElement | null>(null);
    const mentionStartIndex = ref<number | null>(null);
    const mentionQuery = ref('');
    const fileMentionSuggestions = ref<ComposerFileSuggestion[]>([]);
    const isFileMentionOpen = ref(false);
    const fileMentionHighlightedIndex = ref(0);
    const isComposerExpanded = ref(false);
    const isComposerCollapsed = ref(false);
    let fileMentionSearchToken = 0;
    let fileMentionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    const isSubmitting = ref(false);
    const hasSubmitContent = computed(() => draft.value.trim().length > 0 || deps.attachments.selectedImages.value.length > 0 || deps.attachments.fileAttachments.value.length > 0);
    const canSubmit = computed(() => {
        if(queueMode.value&&deps.props.activeThreadId!=='__new-thread__'&&!deps.props.queueReady)return false;
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
        return hasSubmitContent.value;
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
    function onSubmit(): void {
        const text = draft.value.trim();
        if (!canSubmit.value)
            return;
        const threadId = deps.props.activeThreadId;
        const payload = getCurrentDraftPayload();
        const snapshot = JSON.stringify(payload);
        isSubmitting.value = true;
        let settled = false;
        deps.emit('submit', { ...payload, text, ...(queueMode.value&&threadId!=='__new-thread__'?{queue:true}:{}) }, (accepted) => {
            if (settled)
                return;
            settled = true;
            isSubmitting.value = false;
            if (!accepted)
                return;
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
        deps.attachments.pendingAttachmentCount.value = 0;
        deps.isAttachMenuOpen.value = false;
        closeFileMention();
        deps.attachments.attachmentSessionToken += 1;
    }
    function clearDraftState(): void {
        skillQuery.value = null;
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
    function toggleComposerExpanded(): void {
        if (isInteractionDisabled.value && !isComposerExpanded.value)
            return;
        isComposerExpanded.value = !isComposerExpanded.value;
        void nextTick(() => inputRef.value?.focus());
    }
    function onInputChange(): void {
        updateSkillSuggestions();
        updateFileMentionState();
    }
    function onInputKeydown(event: KeyboardEvent): void {
        if (event.isComposing)
            return;
        if (skillQuery.value !== null && skillSuggestions.value.length > 0) {
            if (event.key === 'Escape') {
                event.preventDefault();
                skillQuery.value = null;
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const size = skillSuggestions.value.length;
                if (size)
                    skillIndex.value = (skillIndex.value + (event.key === 'ArrowDown' ? 1 : size - 1)) % size;
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                const item = skillSuggestions.value[skillIndex.value];
                if (item) {
                    event.preventDefault();
                    applySkillSuggestion(item);
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
        if (event.key !== 'Enter')
            return;
        const shouldSend = isComposerExpanded.value || deps.props.sendWithEnter === false
            ? event.metaKey || event.ctrlKey
            : !event.shiftKey;
        if (shouldSend) {
            event.preventDefault();
            onSubmit();
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
        void nextTick(() => inputRef.value?.focus());
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
queueMode, appsUnavailable, selectedApps,
draft,
skillQuery,
skillIndex,
skillSuggestions,
applySkillSuggestion,
inputRef,
fileMentionSuggestions,
isFileMentionOpen,
fileMentionHighlightedIndex,
isComposerExpanded,
isComposerCollapsed,
get fileMentionDebounceTimer() { return fileMentionDebounceTimer; },
canSubmit,
hasUnsavedDraft,
isInteractionDisabled,
placeholderText,
hasSubmitContent,
onSubmit,
replaceDraftState,
clearDraftState,
getCurrentDraftPayload,
onInterrupt,
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
