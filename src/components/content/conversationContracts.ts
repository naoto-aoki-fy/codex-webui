import type { HistoryQuestionResponse } from './questionResponseRows';
import type { QuestionDraft } from '../../questionResponses';
import type { UiLiveOverlay, UiMessage, UiServerRequest } from '../../types/codex';
export type ConversationProps = {
    messages: UiMessage[];
    pendingRequests: UiServerRequest[];
    pendingQuestion?: UiServerRequest | null;
    questionDraft?: QuestionDraft;
    questionResponses?: HistoryQuestionResponse[];
    liveOverlay: UiLiveOverlay | null;
    isForkDisabled?: boolean;
    isRevertDisabled?: boolean;
    isLoading: boolean;
    activeThreadId: string;
    cwd: string;
    hasMorePersistedAbove?: boolean;
    isLoadingPersistedAbove?: boolean;
    loadEarlierMessages?: (threadId: string) => Promise<void>;
};
