<script setup lang="ts">
import { onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import { THREAD_GOAL_STATUSES, type ThreadGoal, type ThreadGoalStatus } from '../../api/codexGateway'
import ManagementDialog from '../shared/ManagementDialog.vue'
import ComposerDropdown from './ComposerDropdown.vue'
import ThreadGoalTemplates from './ThreadGoalTemplates.vue'

const props = defineProps<{
  threadId: string
  connectionEpoch: number
  goal: ThreadGoal | null
  loadError: string
  saveGoal: (objective: string, status: ThreadGoalStatus, clear: boolean) => Promise<void>
  viewportStyle?: CSSProperties
}>()
const editing = ref(false)
const busy = ref(false)
const error = ref('')
const objective = ref('')
const objectiveInput = ref<HTMLTextAreaElement | null>(null)
const status = ref<ThreadGoalStatus>('active')
let generation = 0
const statusOptions = THREAD_GOAL_STATUSES.map(value => ({ value, label: value.replace(/([A-Z])/g, ' $1').toLowerCase() }))

function edit() {
  if (busy.value || !props.threadId) return
  if (editing.value) {
    focusObjective()
    return
  }
  objective.value = props.goal?.objective ?? ''
  status.value = props.goal?.status ?? 'active'
  error.value = ''
  editing.value = true
}

function focusObjective() {
  objectiveInput.value?.focus({ preventScroll: true })
}

function useTemplate(body: string) {
  objective.value = body
  focusObjective()
}

async function save(clear = false) {
  if (busy.value || (!clear && !objective.value.trim())) return
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    await props.saveGoal(objective.value, status.value, clear)
    if (current !== generation) return
    editing.value = false
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : 'Failed to save goal'
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(() => props.threadId, () => {
  generation++
  editing.value = false
  busy.value = false
  error.value = ''
})
onBeforeUnmount(() => { generation++ })
defineExpose({ edit })
</script>

<template>
  <ManagementDialog
    :open="editing"
    title="Goal settings"
    dialog-class="thread-goal-dialog"
    :dialog-style="viewportStyle"
    :close-disabled="busy"
    @opened="focusObjective"
    @close="editing = false"
  >
    <form v-if="editing" class="thread-goal-editor" @submit.prevent="save()">
      <label class="thread-goal-objective">
        <span>Goal objective</span>
        <textarea ref="objectiveInput" v-model="objective" :disabled="busy" rows="1" />
      </label>
      <div class="thread-goal-status">
        <span>Status:</span>
        <ComposerDropdown
          :model-value="status"
          :options="statusOptions"
          :disabled="busy"
          open-direction="up"
          constrain-menu-height
          @update:model-value="status = $event as ThreadGoalStatus"
        />
      </div>
      <ThreadGoalTemplates
        :thread-id="threadId"
        :connection-epoch="connectionEpoch"
        :objective="objective"
        :disabled="busy"
        @use-template="useTemplate"
      />
      <small v-if="goal">{{ goal.tokensUsed.toLocaleString() }} {{ ('tokens') }}<template v-if="goal.tokenBudget !== null"> / {{ goal.tokenBudget.toLocaleString() }}</template> · {{ Math.round(goal.timeUsedSeconds) }}s</small>
      <p v-if="error || loadError" role="alert">{{ error || loadError }}</p>
      <div class="thread-goal-actions">
        <button v-if="goal" class="thread-goal-clear" type="button" :disabled="busy" @click="save(true)">{{ ('Clear goal') }}</button>
        <button type="button" :disabled="busy" @click="editing = false">{{ ('Cancel') }}</button>
        <button type="submit" :disabled="busy || !objective.trim()">{{ ('Save goal') }}</button>
      </div>
    </form>
  </ManagementDialog>
</template>
