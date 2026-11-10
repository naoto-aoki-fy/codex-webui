<template>
  <Teleport to="body">
    <div class="new-thread-open-folder-overlay" @click.self="emit('close')">
      <div class="new-thread-project-modal" role="dialog" aria-modal="true" :aria-label="t('Create or clone project')" @keydown.esc.prevent="emit('close')">
        <div class="new-thread-open-folder-header">
          <p class="new-thread-open-folder-title">{{ t('Create or clone project') }}</p>
          <button class="new-thread-open-folder-close" type="button" :disabled="submitting" @click="emit('close')">
            {{ t('Cancel') }}
          </button>
        </div>
        <div class="new-thread-project-mode-tabs" role="tablist" :aria-label="t('Project source')">
          <button
            class="new-thread-project-mode-tab"
            :class="{ 'is-active': mode === 'create' }"
            type="button"
            role="tab"
            :aria-selected="mode === 'create'"
            :disabled="submitting"
            @click="emit('update:mode', 'create')"
          >
            {{ t('New project') }}
          </button>
          <button
            class="new-thread-project-mode-tab"
            :class="{ 'is-active': mode === 'clone' }"
            type="button"
            role="tab"
            :aria-selected="mode === 'clone'"
            :disabled="submitting"
            @click="emit('update:mode', 'clone')"
          >
            {{ t('Clone from GitHub') }}
          </button>
        </div>
        <label class="new-thread-project-field">
          <span class="new-thread-open-folder-label">{{ t('Destination folder') }}</span>
          <input
            v-model="baseDirModel"
            class="new-thread-open-folder-path"
            type="text"
            :disabled="submitting"
            :placeholder="t('Destination folder')"
          />
        </label>
        <label v-if="mode === 'create'" class="new-thread-project-field">
          <span class="new-thread-open-folder-label">{{ t('Project name') }}</span>
          <input
            ref="primaryInputRef"
            v-model="projectNameModel"
            class="new-thread-open-folder-create-input"
            type="text"
            :disabled="submitting"
            :placeholder="t('Project name')"
            @keydown.enter.prevent="emit('submit')"
          />
        </label>
        <label v-else-if="mode === 'clone'" class="new-thread-project-field">
          <span class="new-thread-open-folder-label">{{ t('GitHub repository URL') }}</span>
          <input
            ref="primaryInputRef"
            v-model="cloneUrlModel"
            class="new-thread-open-folder-create-input"
            type="url"
            :disabled="submitting"
            placeholder="https://github.com/owner/repo"
            @keydown.enter.prevent="emit('submit')"
          />
        </label>
        <div v-if="error" class="new-thread-open-folder-error">
          <span>{{ error }}</span>
        </div>
        <div class="new-thread-project-modal-actions">
          <button class="new-thread-folder-action" type="button" :disabled="submitting" @click="emit('close')">
            {{ t('Cancel') }}
          </button>
          <button
            class="new-thread-folder-action new-thread-folder-action-primary"
            type="button"
            :disabled="!canSubmit || submitting"
            @click="emit('submit')"
          >
            {{ submitLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../composables/useUiLanguage'

const props = defineProps<{
  mode: 'create' | 'clone'
  baseDir: string
  projectName: string
  cloneUrl: string
  submitting: boolean
  error: string
  canSubmit: boolean
  submitLabel: string
}>()

const emit = defineEmits<{
  'update:mode': [value: 'create' | 'clone']
  'update:baseDir': [value: string]
  'update:projectName': [value: string]
  'update:cloneUrl': [value: string]
  close: []
  submit: []
}>()

const baseDirModel = computed({
  get: () => props.baseDir,
  set: (value: string) => emit('update:baseDir', value),
})

const projectNameModel = computed({
  get: () => props.projectName,
  set: (value: string) => emit('update:projectName', value),
})

const cloneUrlModel = computed({
  get: () => props.cloneUrl,
  set: (value: string) => emit('update:cloneUrl', value),
})

const primaryInputRef = ref<HTMLInputElement | null>(null)
defineExpose({ focusPrimaryInput: () => primaryInputRef.value?.focus() })
</script>
