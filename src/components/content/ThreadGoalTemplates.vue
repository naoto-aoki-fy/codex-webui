<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { rpcCall } from '../../api/codexRpcClient'
import type { GoalTemplate, SaveGoalTemplateResult } from '../../goalTemplates'
import { getBrowserConnectionProfile } from '../../utils/browserConnectionProfile'

const props = defineProps<{
  threadId: string
  connectionEpoch: number
  objective: string
  disabled: boolean
}>()
const emit = defineEmits<{ useTemplate: [body: string] }>()

const panel = ref<'save' | 'list' | null>(null)
const name = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const saveTrigger = ref<HTMLButtonElement | null>(null)
const listTrigger = ref<HTMLButtonElement | null>(null)
const confirmationCancel = ref<HTMLButtonElement | null>(null)
const templates = ref<GoalTemplate[]>([])
const confirmation = ref<{ action: 'overwrite'; template: GoalTemplate } | { action: 'delete'; name: string } | null>(null)
const pending = ref(false)
const error = ref('')
let request: AbortController | null = null

function reset() {
  request?.abort()
  request = null
  pending.value = false
  panel.value = null
  name.value = ''
  templates.value = []
  confirmation.value = null
  error.value = ''
}

watch(() => [props.threadId, props.connectionEpoch], reset, { flush: 'sync' })
watch(confirmation, value => {
  if (value) confirmationCancel.value?.focus()
}, { flush: 'post' })
onBeforeUnmount(reset)

async function run<T>(method: string, params: object, apply: (result: T) => void) {
  if (pending.value || props.disabled) return
  const current = new AbortController()
  request = current
  pending.value = true
  error.value = ''
  try {
    const result = await rpcCall<T>(`goal-templates/${method}`, {
      ...params, connectionProfile: getBrowserConnectionProfile(),
    }, current.signal)
    if (request === current) apply(result)
  } catch (cause) {
    if (request === current) error.value = cause instanceof Error ? cause.message : 'Goal template request failed'
  } finally {
    if (request === current) {
      request = null
      pending.value = false
    }
  }
}

function focusName() {
  void nextTick(() => nameInput.value?.focus())
}

function toggleSave() {
  const opening = panel.value !== 'save'
  reset()
  if (opening) {
    panel.value = 'save'
    focusName()
  }
}

function toggleList() {
  const opening = panel.value !== 'list'
  reset()
  if (opening) {
    panel.value = 'list'
    void run<GoalTemplate[]>('list', {}, result => { templates.value = result })
  }
}

function save(template = { name: name.value.trim(), body: props.objective }, overwrite = false) {
  if (!template.name || !template.body.trim()) return
  void run<SaveGoalTemplateResult>('save', { ...template, overwrite }, result => {
    if (!result.saved) {
      confirmation.value = { action: 'overwrite', template }
      return
    }
    reset()
    void nextTick(() => saveTrigger.value?.focus())
  })
}

function saveFromKeyboard(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  save()
}

function dismissConfirmation() {
  const action = confirmation.value?.action
  confirmation.value = null
  error.value = ''
  if (action === 'overwrite') focusName()
  else listTrigger.value?.focus()
}

function remove(name: string) {
  void run<null>('delete', { name }, () => {
    templates.value = templates.value.filter(template => template.name !== name)
    confirmation.value = null
    void nextTick(() => listTrigger.value?.focus())
  })
}

function useTemplate(template: GoalTemplate) {
  reset()
  emit('useTemplate', template.body)
}
</script>

<template>
  <div class="thread-goal-templates">
    <div class="thread-goal-template-buttons">
      <button
        ref="saveTrigger"
        type="button"
        :aria-expanded="panel === 'save'"
        :disabled="disabled || pending || (panel !== 'save' && !objective.trim())"
        @click="toggleSave"
      >Save as template</button>
      <button
        ref="listTrigger"
        type="button"
        :aria-expanded="panel === 'list'"
        :disabled="disabled || pending"
        @click="toggleList"
      >Saved templates</button>
    </div>

    <div v-if="confirmation?.action === 'overwrite'" class="thread-goal-template-panel">
      <p>Overwrite the saved template “{{ confirmation.template.name }}”?</p>
      <div class="thread-goal-template-buttons">
        <button ref="confirmationCancel" type="button" :disabled="disabled || pending" @click="dismissConfirmation">Use a different name</button>
        <button type="button" :disabled="disabled || pending" @click="save(confirmation.template, true)">Overwrite template</button>
      </div>
    </div>
    <div v-else-if="panel === 'save'" class="thread-goal-template-panel">
      <label>
        <span>Template name</span>
        <input
          ref="nameInput"
          v-model="name"
          type="text"
          :disabled="disabled || pending"
          @keydown.enter="saveFromKeyboard"
        />
      </label>
      <div class="thread-goal-template-buttons">
        <button type="button" :disabled="disabled || pending || !name.trim() || !objective.trim()" @click="save()">Save template</button>
      </div>
    </div>

    <div v-if="panel === 'list'" class="thread-goal-template-panel">
      <div v-if="confirmation?.action === 'delete'" class="thread-goal-template-panel">
        <p>Delete the saved template “{{ confirmation.name }}”?</p>
        <div class="thread-goal-template-buttons">
          <button ref="confirmationCancel" type="button" :disabled="disabled || pending" @click="dismissConfirmation">Keep template</button>
          <button type="button" :disabled="disabled || pending" @click="remove(confirmation.name)">Delete template</button>
        </div>
      </div>
      <ul v-else-if="templates.length" class="thread-goal-template-list">
        <li v-for="template in templates" :key="template.name">
          <button type="button" :disabled="disabled || pending" @click="useTemplate(template)">{{ template.name }}</button>
          <button
            type="button"
            :aria-label="`Delete ${template.name}`"
            :disabled="disabled || pending"
            @click="confirmation = { action: 'delete', name: template.name }"
          >Delete</button>
        </li>
      </ul>
      <p v-else-if="pending" role="status">Loading templates…</p>
      <p v-else-if="!error">No saved templates.</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
