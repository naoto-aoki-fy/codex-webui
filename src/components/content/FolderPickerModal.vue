<template>
  <Teleport to="body">
    <div class="new-thread-open-folder-overlay" @click.self="emit('close')">
      <div class="new-thread-open-folder" role="dialog" aria-modal="true" :aria-label="t('Select folder')" @keydown.esc.prevent="emit('close')">
        <div class="new-thread-open-folder-header">
          <p class="new-thread-open-folder-title">{{ t('Select folder') }}</p>
          <button class="new-thread-open-folder-close" type="button" @click="emit('close')">
            {{ t('Cancel') }}
          </button>
        </div>
        <p class="new-thread-open-folder-label">{{ t('Current folder') }}</p>
        <div class="new-thread-open-folder-current">
          <input
            ref="existingFolderPathInputRef"
            v-model="existingFolderPathDraftModel"
            class="new-thread-open-folder-path"
            type="text"
            :placeholder="t('Current folder')"
            :title="existingFolderPathDraft || t('Unavailable')"
            :disabled="isExistingFolderLoading || isOpeningExistingFolder"
            @keydown.enter.prevent="emit('retry')"
            @keydown.esc.prevent="emit('close')"
          />
        </div>
        <div class="new-thread-open-folder-actions">
          <button
            class="new-thread-folder-action"
            type="button"
            :disabled="!resolvedExistingFolderPath || isExistingFolderLoading || isOpeningExistingFolder"
            @click="emit('retry')"
          >
            {{ t('Browse') }}
          </button>
          <button
            class="new-thread-folder-action new-thread-folder-action-primary"
            type="button"
            :disabled="!resolvedExistingFolderPath || isExistingFolderLoading || isOpeningExistingFolder"
            @click="emit('confirm')"
          >
            {{ isOpeningExistingFolder ? t('Opening…') : t('Select') }}
          </button>
        </div>
        <div class="new-thread-open-folder-actions">
          <label class="new-thread-open-folder-toggle">
            <input
              v-model="showHiddenFoldersModel"
              class="new-thread-open-folder-toggle-input"
              type="checkbox"
              @change="emit('toggleHidden')"
            />
            <span>{{ t('Show hidden folders') }}</span>
          </label>
          <button
            class="new-thread-folder-action"
            :class="{ 'new-thread-folder-action-primary': isCreateFolderOpen }"
            type="button"
            :aria-pressed="isCreateFolderOpen"
            :disabled="!existingFolderBrowsePath || isExistingFolderLoading || isOpeningExistingFolder || isCreatingFolder || (!!existingFolderError && !isCreateFolderOpen)"
            @click="emit('toggleCreate')"
          >
            {{ t('New folder') }}
          </button>
        </div>
        <div v-if="isCreateFolderOpen" class="new-thread-open-folder-create">
          <div class="new-thread-open-folder-create-composer">
            <input
              ref="createFolderInputRef"
              v-model="createFolderDraftModel"
              class="new-thread-open-folder-create-input"
              type="text"
              :placeholder="t('Folder name')"
              @keydown.enter.prevent="emit('create')"
              @keydown.esc.prevent="emit('closeCreate')"
            />
            <button
              class="new-thread-folder-action new-thread-folder-action-primary new-thread-open-folder-create-submit"
              type="button"
              :disabled="!canCreateFolder || isCreatingFolder"
              @click="emit('create')"
            >
              {{ createFolderSubmitLabel }}
            </button>
          </div>
          <div v-if="createFolderError" class="new-thread-open-folder-error">
            <span>{{ createFolderError }}</span>
          </div>
        </div>
        <input
            v-model="existingFolderFilterModel"
          class="new-thread-open-folder-filter"
          type="text"
          :placeholder="t('Filter folders...')"
          @keydown.esc.prevent="emit('close')"
        />
        <div v-if="existingFolderError" class="new-thread-open-folder-error-actions">
          <div class="new-thread-open-folder-error">
            <span>{{ existingFolderError }}</span>
          </div>
          <button
            class="new-thread-folder-action"
            type="button"
            :disabled="isExistingFolderLoading || isOpeningExistingFolder"
            @click="emit('retry')"
          >
            {{ t('Retry') }}
          </button>
        </div>
        <p v-if="isExistingFolderLoading" class="new-thread-open-folder-status">{{ t('Loading folders…') }}</p>
        <p v-else-if="!existingFolderError && existingFolderFilteredEntries.length === 0" class="new-thread-open-folder-status">
          {{ existingFolderFilter.trim() ? t('No folders match this filter.') : t('No subfolders found here.') }}
        </p>
        <ul v-else-if="existingFolderFilteredEntries.length > 0" class="new-thread-open-folder-list">
          <li v-for="entry in existingFolderFilteredEntries" :key="entry.key" class="new-thread-open-folder-item">
            <button
              class="new-thread-open-folder-item-main"
              type="button"
              :title="entry.path"
              :disabled="isExistingFolderLoading || isOpeningExistingFolder"
              @click="emit('browse', entry.path)"
            >
              <span class="new-thread-open-folder-item-name">{{ entry.name }}</span>
            </button>
            <button
              v-if="entry.kind === 'directory'"
              class="new-thread-open-folder-item-open"
              type="button"
              :disabled="isExistingFolderLoading || isOpeningExistingFolder"
              @click="emit('confirm', entry.path)"
            >
              {{ t('Select') }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../composables/useUiLanguage'

const props = defineProps<{
  existingFolderPathDraft: string
  showHiddenFolders: boolean
  createFolderDraft: string
  existingFolderFilter: string
  resolvedExistingFolderPath: string
  isExistingFolderLoading: boolean
  isOpeningExistingFolder: boolean
  existingFolderBrowsePath: string
  isCreatingFolder: boolean
  existingFolderError: string
  isCreateFolderOpen: boolean
  canCreateFolder: boolean
  createFolderSubmitLabel: string
  createFolderError: string
  existingFolderFilteredEntries: Array<{ key: string; name: string; path: string; kind: 'parent' | 'directory' }>
}>()

const emit = defineEmits<{
  'update:existingFolderPathDraft': [value: string]
  'update:showHiddenFolders': [value: boolean]
  'update:createFolderDraft': [value: string]
  'update:existingFolderFilter': [value: string]
  close: []
  retry: []
  confirm: [path?: string]
  toggleHidden: []
  toggleCreate: []
  create: []
  closeCreate: []
  browse: [path: string]
}>()

const existingFolderPathDraftModel = computed({
  get: () => props.existingFolderPathDraft,
  set: (value: string) => emit('update:existingFolderPathDraft', value),
})

const showHiddenFoldersModel = computed({
  get: () => props.showHiddenFolders,
  set: (value: boolean) => emit('update:showHiddenFolders', value),
})

const createFolderDraftModel = computed({
  get: () => props.createFolderDraft,
  set: (value: string) => emit('update:createFolderDraft', value),
})

const existingFolderFilterModel = computed({
  get: () => props.existingFolderFilter,
  set: (value: string) => emit('update:existingFolderFilter', value),
})

const existingFolderPathInputRef = ref<HTMLInputElement | null>(null)
const createFolderInputRef = ref<HTMLInputElement | null>(null)
defineExpose({
  focusPathInput: () => existingFolderPathInputRef.value?.focus(),
  focusCreateInput: () => createFolderInputRef.value?.focus(),
})
</script>

<style scoped>
@reference "tailwindcss";

.new-thread-open-folder {
  @apply flex w-full max-w-3xl max-h-[90vh] flex-col gap-2 overflow-y-auto rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-left shadow-xl;
}

.new-thread-open-folder-current {
  @apply flex items-start gap-2;
}

.new-thread-open-folder-actions {
  @apply flex flex-wrap items-center gap-2;
}

.new-thread-open-folder-toggle {
  @apply inline-flex items-center gap-2 text-sm text-zinc-600;
}

.new-thread-open-folder-toggle-input {
  @apply relative h-4 w-4 shrink-0 appearance-none rounded-[4px] border border-zinc-300 bg-white outline-none transition;
}

.new-thread-open-folder-toggle-input:focus-visible {
  box-shadow: 0 0 0 3px rgb(228 228 231);
}

.new-thread-open-folder-toggle-input:checked {
  border-color: rgb(24 24 27);
  background-color: rgb(255 255 255);
}

.new-thread-open-folder-toggle-input::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border-right: 2px solid rgb(24 24 27);
  border-bottom: 2px solid rgb(24 24 27);
  transform: rotate(45deg);
  opacity: 0;
}

.new-thread-open-folder-toggle-input:checked::after {
  opacity: 1;
}

.new-thread-open-folder-filter {
  @apply w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400;
}

.new-thread-open-folder-create {
  @apply flex flex-col gap-2;
}

.new-thread-open-folder-create-composer {
  @apply flex items-center gap-2;
}

.new-thread-open-folder-create-submit {
  @apply shrink-0;
}

.new-thread-folder-action[aria-pressed='true'] {
  @apply border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800;
}

.new-thread-open-folder-status {
  @apply m-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600;
}

.new-thread-open-folder-error-actions {
  @apply flex flex-wrap items-start gap-2;
}

.new-thread-open-folder-list {
  @apply m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0 pr-3;
  scrollbar-gutter: stable;
  scrollbar-color: rgb(161 161 170) rgb(244 244 245);
  scrollbar-width: thin;
}

.new-thread-open-folder-list::-webkit-scrollbar {
  width: 10px;
}

.new-thread-open-folder-list::-webkit-scrollbar-track {
  background: rgb(244 244 245);
  border-radius: 9999px;
}

.new-thread-open-folder-list::-webkit-scrollbar-thumb {
  background: rgb(161 161 170);
  border-radius: 9999px;
  border: 2px solid rgb(244 244 245);
}

.new-thread-open-folder-list::-webkit-scrollbar-thumb:hover {
  background: rgb(113 113 122);
}

.new-thread-open-folder-item {
  @apply grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1;
}

.new-thread-open-folder-item-main {
  @apply min-w-0 truncate rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-left text-sm font-medium leading-5 text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-100;
}

.new-thread-open-folder-item-main:disabled,
.new-thread-open-folder-item-open:disabled {
  @apply cursor-default opacity-60;
}

.new-thread-open-folder-item-name {
  @apply block truncate;
}

.new-thread-open-folder-item-open {
  @apply inline-flex h-7 items-center justify-center rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50;
}

</style>
