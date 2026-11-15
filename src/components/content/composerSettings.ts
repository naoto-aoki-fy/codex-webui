import type { ComputedRef } from 'vue';
import { computed, ref } from 'vue';
import { reasoningCatalog } from '../../api/codexGateway';
import { defaultModelForProvider, fastModeAvailability, findReasoningModel as findModelCapabilities, modelSelectionKey, parseModelSelection, providerModelOptions } from '../../api/modelCapabilities';
import { normalizeSkillMarkdownPath } from '../../api/normalizers/skills';
import type { CollaborationModeKind, ReasoningEffort, SpeedMode } from '../../types/codex';
import { toBrowseUrl } from '../../utils/conversationLinks';
import type { ComposerProps, SkillItem, SkillSourceBadge, SubmitPayload } from "./composerContracts";
/** Owns selected Skills and derives model/provider/reasoning/Plan controls from component props and the shared catalog. The component owns scoped model-preference watchers; no catalog request or subscription is created here. */
export function createComposerSettings(deps: {
    props: Readonly<ComposerProps>;
    isInteractionDisabled: ComputedRef<boolean>;
    emit: ((evt: "submit", payload: SubmitPayload, settle: (accepted: boolean) => void) => void) & ((evt: "interrupt") => void) & ((evt: "edit-goal") => void) & ((evt: "update:selected-collaboration-mode", mode: CollaborationModeKind) => void) & ((evt: "update:selected-model", modelId: string) => void) & ((evt: "update:selected-reasoning-effort", effort: string) => void) & ((evt: "update:selected-speed-mode", mode: SpeedMode) => void);
}) {
    const selectedSkills = ref<SkillItem[]>([]);
    const reasoningOptions = computed(() => deps.props.reasoningEffortOptions ?? []);
    const activeModelProvider = computed(() => deps.props.modelProvider || parseModelSelection(deps.props.selectedModel).provider);
    const isNewThread = computed(() => !deps.props.activeThreadId || deps.props.activeThreadId === '__new-thread__');
    const providerOptions = computed(() => {
        const availableProviders = new Set(deps.props.models.map(id => parseModelSelection(id).provider));
        const providers = new Map<string, {
            value: string;
            label: string;
        }>();
        for (const entry of reasoningCatalog.value) {
            const provider = entry.modelProvider?.trim();
            if (!provider || providers.has(provider))
                continue;
            if (!availableProviders.has(provider))
                continue;
            providers.set(provider, { value: provider, label: entry.providerDisplayName || provider });
        }
        return [...providers.values()];
    });
    const modelOptions = computed(() => providerModelOptions(deps.props.models, activeModelProvider.value, reasoningCatalog.value));
    const displayedModel = computed(() => modelOptions.value.some(option => option.value === deps.props.selectedModel) ? deps.props.selectedModel : '');
    const isPlanModeSelected = computed(() => deps.props.selectedCollaborationMode === 'plan');
    const isPlanModeWaitingForModel = computed(() => deps.props.selectedCollaborationMode === 'plan' && deps.props.selectedModel.trim().length === 0);
    const selectedSkillPaths = computed(() => selectedSkills.value.map((s) => s.path));
    const skillDropdownOptions = computed(() => [
        ...(deps.props.skills ?? []).map((s) => {
            const source = skillSourceBadge(s);
            return {
                value: s.path,
                label: s.name,
                description: s.description,
                badge: source.badge,
                badgeLabel: source.badgeLabel,
                badgeTone: source.badgeTone,
            };
        }),
    ]);
    const isComposerConfigDisabled = computed(() => deps.props.disabled || !deps.props.activeThreadId);
    const fastAvailability = computed(() => fastModeAvailability(findModelCapabilities(reasoningCatalog.value, deps.props.selectedModel)));
    const isFastModeSupported = computed(() => fastAvailability.value === 'supported');
    const showFastModeModelIcon = computed(() => deps.props.selectedSpeedMode === 'fast' && isFastModeSupported.value);
    const isSpeedToggleDisabled = computed(() => deps.isInteractionDisabled.value || deps.props.isUpdatingSpeedMode === true || (!isFastModeSupported.value && deps.props.selectedSpeedMode !== 'fast'));
    const speedModeDescription = computed(() => {
        if (deps.props.isUpdatingSpeedMode) {
            return ('Saving speed setting...');
        }
        if (fastAvailability.value === 'unknown')
            return ('Fast mode availability is unknown');
        if (fastAvailability.value === 'unsupported')
            return ('Fast mode is unavailable for this model');
        return deps.props.selectedSpeedMode === 'fast' ? ('Fast mode enabled') : ('Standard mode');
    });
    function onProviderSelect(provider: string): void {
        if (!isNewThread.value || isComposerConfigDisabled.value || provider === activeModelProvider.value)
            return;
        if (!providerOptions.value.some(option => option.value === provider))
            return;
        const options = providerModelOptions(deps.props.models, provider, reasoningCatalog.value);
        const preferred = modelSelectionKey(provider, defaultModelForProvider(reasoningCatalog.value, provider));
        const model = options.find(option => option.value === preferred)?.value || options[0]?.value;
        if (model)
            deps.emit('update:selected-model', model);
    }
    function onModelSelect(value: string): void {
        if (!modelOptions.value.some(option => option.value === value))
            return;
        deps.emit('update:selected-model', value);
    }
    function toggleCollaborationMode(): void {
        deps.emit('update:selected-collaboration-mode', isPlanModeSelected.value ? 'default' : 'plan');
    }
    function onReasoningEffortSelect(value: string): void {
        deps.emit('update:selected-reasoning-effort', value as ReasoningEffort);
    }
    function onToggleSpeedMode(): void {
        if (isSpeedToggleDisabled.value)
            return;
        deps.emit('update:selected-speed-mode', deps.props.selectedSpeedMode === 'fast' ? 'standard' : 'fast');
    }
    function removeSkill(path: string): void {
        selectedSkills.value = selectedSkills.value.filter((s) => s.path !== path);
    }
    function skillMarkdownPath(path: string): string {
        const trimmed = path.trim();
        if (!trimmed)
            return '';
        return normalizeSkillMarkdownPath(trimmed.replace(/[\\/]+$/, ''));
    }
    function openSkillMarkdown(skill: SkillItem): void {
        const markdownPath = skillMarkdownPath(skill.path);
        if (!markdownPath || typeof window === 'undefined')
            return;
        window.open(toBrowseUrl(markdownPath, ''), '_blank', 'noopener,noreferrer');
    }
    function skillSourceBadge(skill: SkillItem): SkillSourceBadge {
        const path = skill.path.toLowerCase();
        if (path.includes('/plugins/cache/')) {
            return { badge: 'P', badgeLabel: 'Plugin', badgeTone: 'plugin' };
        }
        if (skill.scope === 'repo') {
            return { badge: 'R', badgeLabel: 'Repo', badgeTone: 'repo' };
        }
        if (skill.scope === 'system') {
            return { badge: 'S', badgeLabel: 'System', badgeTone: 'system' };
        }
        return { badge: 'U', badgeLabel: 'User', badgeTone: 'user' };
    }
    function onSkillDropdownToggle(path: string, checked: boolean): void {
        if (checked) {
            const skill = (deps.props.skills ?? []).find((s) => s.path === path);
            if (skill && !selectedSkills.value.some((s) => s.path === path)) {
                selectedSkills.value = [...selectedSkills.value, skill];
            }
        }
        else {
            selectedSkills.value = selectedSkills.value.filter((s) => s.path !== path);
        }
    }
    return {
selectedSkills,
reasoningOptions,
activeModelProvider,
isNewThread,
providerOptions,
modelOptions,
displayedModel,
isPlanModeSelected,
isPlanModeWaitingForModel,
selectedSkillPaths,
skillDropdownOptions,
isComposerConfigDisabled,
showFastModeModelIcon,
isSpeedToggleDisabled,
speedModeDescription,
onProviderSelect,
onModelSelect,
toggleCollaborationMode,
onReasoningEffortSelect,
onToggleSpeedMode,
removeSkill,
skillMarkdownPath,
openSkillMarkdown,
onSkillDropdownToggle
};
}
