<template>
  <form class="thread-composer" :class="{ 'thread-composer--collapsed': isComposerCollapsed, 'thread-composer--expanded': isComposerExpanded }" @submit.prevent="onSubmit()">
    <div v-if="appsPickerLoaded" v-show="isAppsPickerOpen" class="composer-apps-popover feature-panel" aria-label="Conversation Apps">
      <button type="button" @click="isAppsPickerOpen=false">Close Apps</button>
      <button type="button" @click="isAppsPickerOpen=false;emit('open-settings')">Manage connections in Settings</button>
      <AppsPicker :thread-id="activeThreadId" :epoch="connectionEpoch ?? 0" :selected="selectedApps" :disabled="isInteractionDisabled" @change="selectedApps=$event" @unavailable="input.appsUnavailable.value=$event" />
    </div>
    <p v-if="draftSaveWarning" role="alert">{{ draftSaveWarning }}</p>

    <Teleport to="body">
      <div v-if="isComposerCollapsed && !hasPendingRequest" class="thread-composer-floating-actions">
        <button
          v-if="isTurnInProgress"
          class="thread-composer-stop"
          type="button"
          :aria-label="isStopPending ? 'Saving thread before stop is available' : 'Stop'"
          :title="isStopPending ? 'Saving thread before stop is available' : 'Stop'"
          :disabled="isStopDisabled"
          @click="onInterrupt"
        >
          <span v-if="isStopPending" class="thread-composer-stop-spinner" aria-hidden="true" />
          <IconTablerPlayerStopFilled v-else class="thread-composer-stop-icon" />
        </button>
        <button
          ref="showInputButtonRef"
          class="thread-composer-restore"
          type="button"
          aria-label="Show message input"
          title="Show message input"
          :aria-controls="editorId"
          :aria-expanded="false"
          @click="setComposerCollapsed(false)"
        >
          <IconTablerMessage class="thread-composer-expand-icon" />
        </button>
      </div>
    </Teleport>
    <div
      v-show="!isComposerCollapsed"
      :id="editorId"
      class="thread-composer-shell"
      :class="{
        'thread-composer-shell--drag-active': isDragActive,
      }"
    >
      <div v-if="selectedImages.length > 0" class="thread-composer-attachments">
        <div v-for="image in selectedImages" :key="image.id" class="thread-composer-attachment">
          <img class="thread-composer-attachment-image" :src="image.url" :alt="image.name || 'Selected image'" />
          <button
            class="thread-composer-attachment-remove"
            type="button"
            :aria-label="`Remove ${image.name || 'image'}`"
            :disabled="isInteractionDisabled"
            @click="removeImage(image.id)"
          >
            x
          </button>
        </div>
      </div>

      <div v-if="fileAttachments.length > 0" class="thread-composer-file-chips">
        <span v-for="att in fileAttachments" :key="att.fsPath" class="thread-composer-file-chip">
          <IconTablerFilePencil class="thread-composer-file-chip-icon" />
          <span class="thread-composer-file-chip-name" :title="att.fsPath">{{ att.label }}</span>
          <button
            class="thread-composer-file-chip-remove"
            type="button"
            :aria-label="`Remove ${att.label}`"
            :disabled="isInteractionDisabled"
            @click="removeFileAttachment(att.fsPath)"
          >×</button>
        </span>
      </div>

      <div v-if="selectedSkills.length > 0" class="thread-composer-skill-chips">
        <span v-for="skill in selectedSkills" :key="skill.path" class="thread-composer-skill-chip">
          <button
            class="thread-composer-skill-chip-name"
            type="button"
            :title="skillMarkdownPath(skill.path)"
            :aria-label="`Open ${skill.displayName || skill.name} SKILL.md`"
            @click="openSkillMarkdown(skill)"
          >
            {{ skill.displayName || skill.name }}
          </button>
          <button
            class="thread-composer-skill-chip-remove"
            type="button"
            :aria-label="`Remove skill ${skill.displayName || skill.name}`"
            @click="removeSkill(skill.path)"
          >×</button>
        </span>
      </div>

      <div
        class="thread-composer-input-wrap"
        :class="{
          'thread-composer-input-wrap--drag-active': isDragActive,
          'thread-composer-input-wrap--expanded': isComposerExpanded,
        }"
        @dragenter="onInputDragEnter"
        @dragover="onInputDragOver"
        @dragleave="onInputDragLeave"
        @drop="onInputDrop"
      >
        <div v-if="isDragActive" class="thread-composer-drop-overlay" aria-hidden="true">
          <span class="thread-composer-drop-overlay-copy">Drop images or files</span>
        </div>
        <div v-if="isFileMentionOpen" class="thread-composer-file-mentions">
          <template v-if="fileMentionSuggestions.length > 0">
            <button
              v-for="(item, index) in fileMentionSuggestions"
              :key="item.path"
              class="thread-composer-file-mention-row"
              :class="{ 'is-active': index === fileMentionHighlightedIndex }"
              type="button"
              @mousedown.prevent="applyFileMention(item)"
            >
              <span
                v-if="getMentionBadgeText(item.path)"
                class="thread-composer-file-mention-icon-badge"
                :class="`is-${getMentionBadgeClass(item.path)}`"
              >
                {{ getMentionBadgeText(item.path) }}
              </span>
              <span v-else-if="isMarkdownFile(item.path)" class="thread-composer-file-mention-icon-markdown">↓</span>
              <IconTablerFilePencil v-else class="thread-composer-file-mention-icon-file" />
              <span class="thread-composer-file-mention-text">
                <span class="thread-composer-file-mention-name">{{ getMentionFileName(item.path) }}</span>
                <span v-if="getMentionDirName(item.path)" class="thread-composer-file-mention-dir">{{ getMentionDirName(item.path) }}</span>
              </span>
            </button>
          </template>
          <div v-else class="thread-composer-file-mention-empty">{{ ('No matching files') }}</div>
        </div>
        <div v-if="skillQuery !== null && skillSuggestions.length > 0" class="thread-composer-file-mentions thread-composer-skill-mentions">
          <button v-for="(item, index) in skillSuggestions" :key="item.skill.path"
            class="thread-composer-file-mention-row" :class="{ 'is-active': index === skillIndex }"
            type="button" @mousedown.prevent="applySkillSuggestion(item)">
            <span>/{{ item.name }}</span><small>{{ item.description }}</small>
          </button>
        </div>
        <div v-if="isPlanModeSelected" class="thread-composer-active-mode">
          <button type="button" @click="emit('update:selected-collaboration-mode', 'default')">{{ ('Plan') }} ×</button>
        </div>
        <textarea
          ref="inputRef"
          v-model="draft"
          class="thread-composer-input"
          :placeholder="placeholderText"
          :disabled="isInteractionDisabled"
          @input="onInputChange"
          @keydown="onInputKeydown"
          @paste="onInputPaste"
        />
        <div class="thread-composer-editor-actions">
          <button
            v-if="!isComposerExpanded"
            ref="collapseInputButtonRef"
            class="thread-composer-expand thread-composer-collapse"
            type="button"
            aria-label="Minimize message input"
            title="Minimize message input"
            :aria-controls="editorId"
            :aria-expanded="true"
            @click="setComposerCollapsed(true)"
          >
            <IconTablerMinus class="thread-composer-expand-icon" />
          </button>
          <button
            class="thread-composer-expand"
            type="button"
            :aria-label="isComposerExpanded ? ('Exit full screen composer') : ('Expand composer')"
            :title="isComposerExpanded ? ('Exit full screen composer') : ('Expand composer')"
            :disabled="isInteractionDisabled && !isComposerExpanded"
            :aria-expanded="isComposerExpanded"
            :aria-controls="editorId"
            @click="toggleComposerExpanded"
          >
            <IconTablerMinimize v-if="isComposerExpanded" class="thread-composer-expand-icon" />
            <IconTablerMaximize v-else class="thread-composer-expand-icon" />
          </button>
        </div>
      </div>

      <div
        class="thread-composer-controls"
      >
        <div ref="attachMenuRootRef" class="thread-composer-attach">
          <button
            class="thread-composer-attach-trigger"
            type="button"
            :aria-label="('Add attachments and settings')"
            :aria-expanded="isAttachMenuOpen"
            :disabled="isInteractionDisabled"
            @click="toggleAttachMenu"
          >
            +
          </button>

          <div v-if="isAttachMenuOpen" class="thread-composer-attach-menu" @keydown.esc.stop.prevent="isAttachMenuOpen=false;attachMenuRootRef?.querySelector('button')?.focus()">
            <button
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="triggerPhotoLibrary"
            >
              {{ ('Add photos & files') }}
            </button>

            <button v-if="!isNewThread" class="thread-composer-attach-item" type="button" @click="isAttachMenuOpen=false;isAppsPickerOpen=!isAppsPickerOpen">Apps / Connectors<span v-if="selectedApps.length"> ({{ selectedApps.length }})</span></button>
            <fieldset class="composer-send-modes" role="radiogroup" aria-label="Send mode" @keydown="onSendModeKeydown">
              <legend>Send mode</legend>
              <button v-for="mode in [{queue:false,label:'Immediate mode'},{queue:true,label:'Queue mode'}]" :key="mode.label" class="thread-composer-attach-setting" type="button" role="radio" :tabindex="input.queueMode.value===mode.queue ? 0 : -1" :aria-checked="input.queueMode.value===mode.queue" @click="input.queueMode.value=mode.queue;isAttachMenuOpen=false">
                <span class="thread-composer-attach-setting-label">{{ mode.label }}</span><span aria-hidden="true">{{ input.queueMode.value===mode.queue ? '✓' : '' }}</span>
              </button>
              <p v-if="isNewThread">The first message creates the conversation. Queue mode applies to subsequent submissions.</p>
            </fieldset>
            <div class="thread-composer-attach-separator" />
            <button
              class="thread-composer-attach-setting"
              type="button"
              role="switch"
              :aria-checked="isSkillsSelectorVisible"
              :aria-label="('Skills')"
              :disabled="isComposerConfigDisabled"
              @click="toggleSkillsSelector"
            >
              <span class="thread-composer-attach-setting-label">{{ ('Skills') }}</span>
              <span
                class="thread-composer-attach-switch"
                :class="{ 'is-on': isSkillsSelectorVisible }"
              />
            </button>
            <button
              class="thread-composer-attach-setting"
              type="button"
              role="switch"
              :aria-checked="selectedSpeedMode === 'fast'"
              :aria-label="`${('Fast mode')} ${selectedSpeedMode === 'fast' ? ('enabled') : ('disabled')}`"
              :disabled="isSpeedToggleDisabled"
              @click="onToggleSpeedMode"
            >
              <span class="thread-composer-attach-setting-copy">
                <span class="thread-composer-attach-setting-label">{{ ('Fast mode') }}</span>
                <span class="thread-composer-attach-setting-description">{{ speedModeDescription }}</span>
              </span>
              <span
                class="thread-composer-attach-switch"
                :class="{
                  'is-on': selectedSpeedMode === 'fast',
                  'is-busy': isUpdatingSpeedMode,
                  'is-disabled': isSpeedToggleDisabled,
                }"
              />
            </button>
            <button
              class="thread-composer-attach-setting"
              type="button"
              role="switch"
              :aria-checked="isPlanModeSelected"
              :aria-label="isPlanModeSelected ? ('Disable plan mode') : ('Enable plan mode')"
              :disabled="isComposerConfigDisabled"
              @click="toggleCollaborationMode"
            >
              <span class="thread-composer-attach-setting-copy">
                <span class="thread-composer-attach-setting-label">{{ ('Plan mode') }}</span>
                <span class="thread-composer-attach-setting-description">{{ ('Agent proposes a plan before acting') }}</span>
              </span>
              <span
                class="thread-composer-attach-switch"
                :class="{ 'is-on': isPlanModeSelected }"
              />
            </button>
            <button
              v-if="activeThreadId && activeThreadId !== '__new-thread__'"
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="isAttachMenuOpen = false; emit('edit-goal')"
            >
              {{ ('Goal…') }}
            </button>
          </div>
        </div>

        <ComposerDropdown
          v-if="isNewThread && providerOptions.length"
          class="thread-composer-control"
          :model-value="activeModelProvider"
          :options="providerOptions"
          :placeholder="('Model Provider')"
          open-direction="up"
          :disabled="isComposerConfigDisabled"
          @update:model-value="onProviderSelect"
        />

        <ComposerDropdown
          class="thread-composer-control"
          :model-value="displayedModel"
          :options="modelOptions"
          :selected-prefix-icon="showFastModeModelIcon ? IconTablerBolt : null"
          :placeholder="('Model')"
          open-direction="up"
          :disabled="isComposerConfigDisabled || modelOptions.length === 0"
          enable-search
          :search-placeholder="('Search models...')"
          @update:model-value="onModelSelect"
        />

        <ComposerSearchDropdown
          v-if="isSkillsSelectorVisible && !isComposerCollapsed && !hasPendingRequest"
          class="thread-composer-control"
          :options="skillDropdownOptions"
          :selected-values="selectedSkillPaths"
          :placeholder="('Skills')"
          :search-placeholder="('Search skills...')"
          open-direction="up"
          :disabled="isComposerConfigDisabled"
          @toggle="onSkillDropdownToggle"
        />

        <ComposerDropdown
          class="thread-composer-control"
          :model-value="selectedReasoningEffort"
          :options="reasoningOptions"
          :placeholder="(reasoningOptions.length ? 'Thinking' : 'Model default')"
          open-direction="up"
          :disabled="isComposerConfigDisabled || reasoningOptions.length === 0"
          @update:model-value="onReasoningEffortSelect"
        />

        <button v-if="input.queueMode.value" type="button" class="thread-composer-control thread-composer-queue-mode" aria-label="Send mode: Queue mode" @click.stop="toggleAttachMenu">Queue mode</button>
        <div
          class="thread-composer-actions"
        >
          <button
            v-if="isTurnInProgress && !hasSubmitContent"
            class="thread-composer-stop"
            type="button"
            :aria-label="isStopPending ? ('Saving thread before stop is available') : ('Stop')"
            :title="isStopPending ? ('Saving thread before stop is available') : ('Stop')"
            :disabled="isStopDisabled"
            @click="onInterrupt"
          >
            <span v-if="isStopPending" class="thread-composer-stop-spinner" aria-hidden="true" />
            <IconTablerPlayerStopFilled v-else class="thread-composer-stop-icon" />
          </button>
          <button
            v-else
            class="thread-composer-submit"
            type="button"
            :aria-label="input.queueMode.value && !isNewThread?'Queue prompt':isTurnInProgress ? ('Steer') : ('Send message')"
            :title="input.queueMode.value && !isNewThread?'Add to native queue':isTurnInProgress ? ('Steer') : ('Send')"
            :disabled="!canSubmit"
            @click="onSubmit()"
          >
            <IconTablerArrowUp class="thread-composer-submit-icon" />
          </button>
        </div>
      </div>

    </div>
    <input
      ref="photoLibraryInputRef"
      class="thread-composer-hidden-input"
      type="file"
      multiple
      :disabled="isInteractionDisabled"
      @change="onPhotoLibraryChange"
    />

  </form>
</template>

<script setup lang="ts">
const AppsPicker = defineAsyncComponent(() => import('./AppsPicker.vue'))
const isAppsPickerOpen = ref(false)
const appsPickerLoaded = ref(false)
watch(isAppsPickerOpen, open => { if (open) appsPickerLoaded.value = true })
const draftSaveWarning = ref('')
function recoverDraft(payload: ComposerDraftPayload): boolean {
  if (input.hasUnsavedDraft.value && !archiveDraftBeforeRecovery(props.activeThreadId, input.getCurrentDraftPayload())) {
    draftSaveWarning.value = 'Could not preserve the current draft. Copy it before recovering another draft.'
    return false
  }
  input.hydrateDraft(payload)
  return true
}
import type { ComposerProps, SubmitPayload, ThreadComposerExposed } from "./composerContracts"
import { createComposerInput } from './composerInput'
import { createComposerSettings } from './composerSettings'
import { createComposerAttachments } from './composerAttachments'

import { loadPersistedDraftForThread, persistDraftForThread, draftStorageError, archiveDraftBeforeRecovery, type ComposerDraftPayload } from '../../utils/composerDraftStorage'
import { reasoningCatalog } from '../../api/codexGateway'
import { parseModelSelection, defaultModelForProvider, modelSelectionKey } from '../../api/modelCapabilities'

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { CollaborationModeKind, ReasoningEffort, SpeedMode } from '../../types/codex'
import { useMobile } from '../../composables/useMobile'

import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerMessage from '../icons/IconTablerMessage.vue'
import IconTablerMinus from '../icons/IconTablerMinus.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerMaximize from '../icons/IconTablerMaximize.vue'
import IconTablerMinimize from '../icons/IconTablerMinimize.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import ComposerDropdown from './ComposerDropdown.vue'
import ComposerSearchDropdown from './ComposerSearchDropdown.vue'

const props = withDefaults(defineProps<ComposerProps>(), { selectedQueueMode: undefined })

export type { FileAttachment, ComposerDraftPayload } from '../../utils/composerDraftStorage'

const emit = defineEmits<{
  'update:expanded': [expanded: boolean]
  'update:selected-queue-mode': [queue: boolean]
  'open-settings': []
  submit: [payload: SubmitPayload, settle: (accepted: boolean) => void]
  interrupt: []
  'edit-goal': []
  'update:selected-collaboration-mode': [mode: CollaborationModeKind]
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
  'update:selected-speed-mode': [mode: SpeedMode]
}>()

const input = createComposerInput({
  get props() { return props; },
  get settings() { return settings; },
  get emit() { return emit; },
  get attachments() { return attachments; },
  get isAttachMenuOpen() { return isAttachMenuOpen; },
  get isMobile() { return isMobile; }
})
watch(() => props.activeThreadId, () => { isAppsPickerOpen.value = false }, { flush: 'sync' })
watch(() => props.connectionEpoch, () => { input.selectedApps.value = []; input.appsUnavailable.value = false })

const {
  selectedApps,
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
  canSubmit,
  isInteractionDisabled,
  placeholderText,
  hasSubmitContent,
  onSubmit,
  onInterrupt,
  toggleComposerExpanded,
  onInputChange,
  onInputKeydown,
  closeFileMention,
  applyFileMention,
  getMentionFileName,
  getMentionDirName,
  getMentionBadgeText,
  getMentionBadgeClass,
  isMarkdownFile,
} = input

// Notify the layout for every exit path, including submit, pending requests and thread changes.
watch(isComposerExpanded, expanded => emit('update:expanded', expanded), { flush: 'sync' })

const attachments = createComposerAttachments({
  get isAttachMenuOpen() { return isAttachMenuOpen; },
  get closeFileMention() { return input.closeFileMention; },
  get isInteractionDisabled() { return input.isInteractionDisabled; }
})
const {
  selectedImages,
  fileAttachments,
  isDragActive,
  photoLibraryInputRef,
  removeImage,
  removeFileAttachment,
  onPhotoLibraryChange,
  onInputDragEnter,
  onInputDragOver,
  onInputDragLeave,
  onInputDrop,
  onInputPaste,
} = attachments

const settings = createComposerSettings({
  get props() { return props; },
  get isInteractionDisabled() { return input.isInteractionDisabled; },
  get emit() { return emit; }
})
const {
  selectedSkills,
  reasoningOptions,
  activeModelProvider,
  isNewThread,
  providerOptions,
  modelOptions,
  displayedModel,
  isPlanModeSelected,
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
  onSkillDropdownToggle,
} = settings

const editorId = useId()
const showInputButtonRef = ref<HTMLButtonElement | null>(null)
const collapseInputButtonRef = ref<HTMLButtonElement | null>(null)
const isStopDisabled = computed(() => props.disabled
  || !props.activeThreadId || props.isInterruptingTurn || props.isStopPending)

function setComposerCollapsed(collapsed: boolean): void {
  // Keep the editor mounted: drafts, attachments and control selections have one owner.
  isComposerCollapsed.value = collapsed
  isComposerExpanded.value = false
  closeComposerPopovers()
  void nextTick(() => {
    if (collapsed) showInputButtonRef.value?.focus({ preventScroll: true })
    else {
      const target = isInteractionDisabled.value ? collapseInputButtonRef.value : inputRef.value
      target?.focus({ preventScroll: true })
    }
  })
}

function closeComposerPopovers(): void {
  isAttachMenuOpen.value = false
  isAppsPickerOpen.value = false
  skillQuery.value = null
  closeFileMention()
  attachments.onWindowDragCleanup()
}

watch(() => props.hasPendingRequest, pending => {
  if (!pending) return
  closeComposerPopovers()
  isComposerExpanded.value = false
})

const attachMenuRootRef = ref<HTMLElement | null>(null)

const { isMobile } = useMobile()
const isAttachMenuOpen = ref(false)
const isSkillsSelectorVisible = ref(false)

let lastActiveThreadId = ''

watch([settings.activeModelProvider, settings.modelOptions, () => props.selectedModel], () => {
  if (!props.modelProvider || !props.selectedModel || parseModelSelection(props.selectedModel).provider === props.modelProvider) return
  const fallback = modelSelectionKey(props.modelProvider, defaultModelForProvider(reasoningCatalog.value, props.modelProvider))
  const next = settings.modelOptions.value.find(option => option.value === fallback)?.value || settings.modelOptions.value[0]?.value || ''
  emit('update:selected-model', next)
}, { immediate: true })

function onSendModeKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  input.queueMode.value = event.key === 'Home' ? false : event.key === 'End' ? true : !input.queueMode.value
  const group = event.currentTarget as HTMLElement
  nextTick(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
}

function toggleAttachMenu(): void {
  if (input.isInteractionDisabled.value) return
  isAttachMenuOpen.value = !isAttachMenuOpen.value
}

function toggleSkillsSelector(): void {
  if (settings.isComposerConfigDisabled.value) return
  isSkillsSelectorVisible.value = !isSkillsSelectorVisible.value
  isAttachMenuOpen.value = false
}

function triggerPhotoLibrary(): void {
  attachments.photoLibraryInputRef.value?.click()
}

function onDocumentClick(event: MouseEvent): void {
  if (!isAttachMenuOpen.value) return
  const root = attachMenuRootRef.value
  if (!root) return
  const target = event.target as Node | null
  if (!target || root.contains(target)) return
  isAttachMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('drop', attachments.onWindowDragCleanup)
  window.addEventListener('dragend', attachments.onWindowDragCleanup)
  window.addEventListener('blur', attachments.onWindowDragCleanup)
})

defineExpose<ThreadComposerExposed>({
  hydrateDraft: input.hydrateDraft,
  recoverDraft,
  appendTextToDraft: input.appendTextToDraft,
  hasUnsavedDraft: () => input.hasUnsavedDraft.value,
})

onBeforeUnmount(() => {
  emit('update:expanded', false)
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('drop', attachments.onWindowDragCleanup)
  window.removeEventListener('dragend', attachments.onWindowDragCleanup)
  window.removeEventListener('blur', attachments.onWindowDragCleanup)
  if (input.fileMentionDebounceTimer) {
    clearTimeout(input.fileMentionDebounceTimer)
  }
})

watch(
  () => props.activeThreadId,
  (nextThreadId) => {
    if (lastActiveThreadId) {
      persistDraftForThread(lastActiveThreadId, input.getCurrentDraftPayload())
    }
    isComposerCollapsed.value = false
    input.clearDraftState()
    const restored = loadPersistedDraftForThread(nextThreadId)
    draftSaveWarning.value = draftStorageError
    if (restored) {
      input.replaceDraftState(restored)
      input.onInputChange()
    }
    lastActiveThreadId = nextThreadId.trim()
  },
  { immediate: true },
)

watch([input.selectedApps, input.draft, attachments.selectedImages, attachments.fileAttachments, settings.selectedSkills], () => {
  if (!lastActiveThreadId) return
  persistDraftForThread(lastActiveThreadId, input.getCurrentDraftPayload())
  draftSaveWarning.value = draftStorageError
}, { deep: true })

watch(
  () => props.cwd,
  () => {
    if (input.isFileMentionOpen.value) {
      void input.queueFileMentionSearch()
    }
  },
)
watch(()=>props.activeThreadId,()=>{if(props.selectedQueueMode===undefined)input.queueMode.value=false},{flush:'sync'})

export type { SubmitPayload, ThreadComposerExposed } from './composerContracts'
</script>

<style scoped>
@reference "tailwindcss";

.thread-composer {
  @apply w-full max-w-[min(var(--chat-column-max,72rem),100%)] mx-auto;
}

.thread-composer--expanded {
  @apply flex h-full min-h-0 max-w-none flex-col bg-white p-3 sm:p-6;
  padding-top: max(0.75rem, env(safe-area-inset-top, 0px));
  padding-right: max(0.75rem, env(safe-area-inset-right, 0px));
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));
  padding-left: max(0.75rem, env(safe-area-inset-left, 0px));
}

.thread-composer-shell {
  @apply relative rounded-2xl border border-zinc-300 bg-white p-2 sm:p-3 shadow-sm;
}

.thread-composer--expanded .thread-composer-shell {
  @apply flex min-h-0 w-full flex-1 flex-col;
}

.thread-composer--expanded .thread-composer-attachments,
.thread-composer--expanded .thread-composer-file-chips,
.thread-composer--expanded .thread-composer-skill-chips {
  @apply min-h-0 overflow-y-auto;
  max-height: 20%;
}

.thread-composer--expanded .thread-composer-controls {
  @apply shrink-0;
}

.thread-composer--expanded .composer-apps-popover {
  top: 1rem;
  bottom: auto;
}

.thread-composer--expanded .thread-composer-file-mentions {
  top: 2.75rem;
  bottom: auto;
  max-height: min(50dvh, 13rem);
}

.thread-composer-floating-actions {
  @apply fixed z-20 flex items-center gap-2;
  right: calc(1rem + env(safe-area-inset-right, 0px));
  bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
}

.thread-composer-restore {
  @apply inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm transition hover:bg-zinc-100 hover:text-zinc-900;
}

.thread-composer-restore:focus-visible,
.thread-composer-expand:focus-visible,
.thread-composer-floating-actions .thread-composer-stop:focus-visible {
  @apply outline-2 outline-offset-2 outline-blue-500;
}

.thread-composer-shell--drag-active {
  @apply border-zinc-900 shadow-md;
}

.thread-composer-attachments {
  @apply mb-2 flex flex-wrap gap-2;
}

.thread-composer-attachment {
  @apply relative h-14 w-14 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50;
}

.thread-composer-attachment-image {
  @apply h-full w-full object-cover;
}

.thread-composer-attachment-remove {
  @apply absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border-0 bg-black/70 text-xs leading-none text-white;
}

.thread-composer-file-chips {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.thread-composer-file-chip {
  @apply inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700;
}

.thread-composer-file-chip-icon {
  @apply h-3.5 w-3.5 text-zinc-400 shrink-0;
}

.thread-composer-file-chip-name {
  @apply truncate max-w-40 font-mono;
}

.thread-composer-file-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 text-xs leading-none p-0;
}

.thread-composer-skill-chips {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.thread-composer-skill-chip {
  @apply inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700;
}

.thread-composer-skill-chip-name {
  @apply min-w-0 max-w-[12rem] truncate border-0 bg-transparent p-0 text-left font-medium text-inherit underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500;
}

.thread-composer-skill-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent text-emerald-500 transition hover:bg-emerald-200 hover:text-emerald-700 text-xs leading-none p-0;
}

.thread-composer-input-wrap {
  @apply relative;
}

.thread-composer-input-wrap--expanded {
  @apply flex min-h-12 flex-1 flex-col;
}

.thread-composer-input-wrap--drag-active {
  @apply rounded-xl bg-zinc-50;
}

.thread-composer-drop-overlay {
  @apply pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border border-dashed border-zinc-900 bg-white/90;
}

.thread-composer-drop-overlay-copy {
  @apply rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white shadow-sm;
}

.thread-composer-file-mentions {
  @apply absolute left-0 right-0 bottom-[calc(100%+8px)] z-40 max-h-52 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg;
}

.thread-composer-file-mention-row {
  @apply flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-xs text-zinc-700 transition hover:bg-zinc-100;
}

.thread-composer-file-mention-row.is-active {
  @apply bg-zinc-100;
}

.thread-composer-file-mention-icon-badge {
  @apply inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[9px] font-semibold leading-none;
}

.thread-composer-file-mention-icon-badge.is-ts {
  @apply bg-zinc-700 text-white;
}

.thread-composer-file-mention-icon-badge.is-js {
  @apply bg-zinc-600 text-white;
}

.thread-composer-file-mention-icon-badge.is-json {
  @apply bg-zinc-600 text-white;
}

.thread-composer-file-mention-icon-markdown {
  @apply inline-flex h-5 min-w-5 items-center justify-center text-sm leading-none text-zinc-700;
}

.thread-composer-file-mention-icon-file {
  @apply h-4 w-4 text-zinc-600;
}

.thread-composer-file-mention-text {
  @apply min-w-0 flex items-baseline gap-2;
}

.thread-composer-file-mention-name {
  @apply truncate text-zinc-900;
}

.thread-composer-file-mention-dir {
  @apply truncate text-zinc-400;
}

.thread-composer-file-mention-empty {
  @apply px-2 py-1.5 text-xs text-zinc-500;
}

.thread-composer-input {
  @apply w-full min-w-0 min-h-10 sm:min-h-11 max-h-40 rounded-xl border-0 bg-transparent px-1 py-2 pr-20 text-sm text-zinc-900 outline-none transition resize-none overflow-y-auto;
}

.thread-composer-input-wrap--expanded .thread-composer-input {
  @apply block min-h-0 flex-1 max-h-none pr-12 text-base leading-6;
}

.thread-composer-input:focus {
  @apply ring-0;
}

.thread-composer-input:disabled {
  @apply bg-zinc-100 text-zinc-500 cursor-not-allowed;
}

.thread-composer-editor-actions {
  @apply absolute right-0.5 top-0.5 inline-flex items-center gap-1;
}

.thread-composer-expand {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-100 text-zinc-500 shadow-sm transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-expand-icon {
  @apply h-[18px] w-[18px];
}

.thread-composer-controls {
  @apply relative mt-2 sm:mt-3 flex items-center gap-2 sm:gap-4 overflow-visible pb-px;
}

.thread-composer-attach {
  @apply relative shrink-0;
}

.thread-composer-attach-trigger {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none border-0 bg-transparent pb-px text-xl leading-tight text-zinc-700 transition hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-attach-menu {
  @apply absolute bottom-11 left-0 z-20 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-white p-1 shadow-lg;
}

.thread-composer-attach-item {
  @apply block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-attach-separator {
  @apply my-1 h-px bg-zinc-100;
}

.thread-composer-attach-setting {
  @apply flex w-full items-center justify-between gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-attach-setting-copy {
  @apply min-w-0 flex flex-col;
}

.thread-composer-attach-setting-label {
  @apply text-sm text-zinc-800;
}

.thread-composer-attach-setting-description {
  @apply mt-0.5 text-xs text-zinc-500;
}

.thread-composer-attach-switch {
  @apply relative h-5 w-9 shrink-0 rounded-full bg-zinc-300 transition-colors;
}

.thread-composer-attach-switch::after {
  content: '';
  @apply absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow-sm;
}

.thread-composer-attach-switch.is-on {
  @apply bg-emerald-600;
}

.thread-composer-attach-switch.is-on::after {
  transform: translateX(16px);
}

.thread-composer-attach-switch.is-busy {
  @apply opacity-70;
}

.thread-composer-attach-switch.is-disabled {
  @apply opacity-50;
}

.thread-composer-control {
  @apply shrink-1 min-w-0;
}

.thread-composer-control :deep(.composer-dropdown-value) {
  @apply truncate;
}

.thread-composer-actions {
  @apply ml-auto flex min-w-0 items-center gap-2;
}

.thread-composer-submit {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-900 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-submit-icon {
  @apply h-5 w-5;
}

.thread-composer-stop {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-zinc-900 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-stop-icon {
  @apply h-5 w-5;
}

.thread-composer-stop-spinner {
  @apply h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin;
}

.thread-composer-hidden-input {
  @apply hidden;
}
</style>
