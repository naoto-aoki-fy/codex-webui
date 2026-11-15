import type { CollaborationModeKind, CollaborationModeOption, ReasoningEffort, SpeedMode } from '../../types/codex';
import type { ComposerDraftPayload, FileAttachment } from '../../utils/composerDraftStorage';
export type ComposerProps = {
    queueReady?: boolean;
    connectionEpoch?: number;
    activeThreadId: string;
    cwd?: string;
    collaborationModes?: CollaborationModeOption[];
    selectedCollaborationMode: CollaborationModeKind;
    modelProvider?: string;
    models: string[];
    selectedModel: string;
    selectedReasoningEffort: ReasoningEffort | '';
    reasoningEffortOptions?: Array<{
        value: ReasoningEffort;
        label: string;
        description?: string;
    }>;
    selectedSpeedMode: SpeedMode;
    skills?: SkillItem[];
    isTurnInProgress?: boolean;
    isStopPending?: boolean;
    isInterruptingTurn?: boolean;
    isUpdatingSpeedMode?: boolean;
    disabled?: boolean;
    allowInterruptWhenDisabled?: boolean;
    sendWithEnter?: boolean;
};
export type SkillSourceBadge = {
    badge: string;
    badgeLabel: string;
    badgeTone: 'repo' | 'system' | 'plugin' | 'user';
};
export type SkillItem = {
    name: string;
    displayName?: string;
    description: string;
    path: string;
    scope?: string;
    enabled?: boolean;
};
export type SubmitPayload = {
    queue?: boolean;
    apps?: import('../../api/apps').AppReference[];
    text: string;
    imageUrls: string[];
    fileAttachments: FileAttachment[];
    skills: Array<{
        name: string;
        path: string;
    }>;
};
export type ThreadComposerExposed = {
    hydrateDraft: (payload: ComposerDraftPayload) => void;
    appendTextToDraft: (text: string) => void;
    hasUnsavedDraft: () => boolean;
};
export type SelectedImage = {
    id: string;
    name: string;
    url: string;
};
export type AttachmentBatchStats = {
    total: number;
    succeeded: number;
    failed: number;
};
export type SlashSuggestion = {
    name: string;
    description: string;
    skill?: SkillItem;
};
