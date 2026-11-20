<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { THREAD_GOAL_STATUSES, type ThreadGoal, type ThreadGoalStatus } from '../../api/codexGateway'
import ComposerDropdown from './ComposerDropdown.vue'

const props = defineProps<{
  threadId: string
  goal: ThreadGoal | null
  loadError: string
  saveGoal: (objective: string, status: ThreadGoalStatus, clear: boolean) => Promise<void>
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
    objectiveInput.value?.focus()
    return
  }
  objective.value = props.goal?.objective ?? ''
  status.value = props.goal?.status ?? 'active'
  error.value = ''
  editing.value = true
  void nextTick(() => objectiveInput.value?.focus())
}
async function save(clear = false) {
  if (busy.value || (!clear && !objective.value.trim())) return
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    await props.saveGoal(objective.value.trim(), status.value, clear)
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
  <section v-if="goal || editing" class="thread-goal-panel" :aria-label="('Goal')">
    <button v-if="goal && !editing" type="button" class="thread-goal-summary" :title="goal.objective" :aria-label="`${('Edit goal')}: ${goal.objective}`" :aria-expanded="false" @click="edit">
      <strong>{{ ('Goal') }} · {{ goal.status }}</strong>
      <span class="thread-goal-preview">— {{ goal.objective }}</span>
    </button>
    <form v-if="editing" class="thread-goal-editor" @submit.prevent="save()">
      <strong>{{ (goal ? 'Edit goal' : 'Set goal') }}</strong>
      <small v-if="goal">{{ goal.tokensUsed.toLocaleString() }} {{ ('tokens') }}<template v-if="goal.tokenBudget !== null"> / {{ goal.tokenBudget.toLocaleString() }}</template> · {{ Math.round(goal.timeUsedSeconds) }}s</small>
      <textarea ref="objectiveInput" v-model="objective" :aria-label="('Goal objective')" :disabled="busy" rows="3" />
      <ComposerDropdown :model-value="status" :options="statusOptions" :disabled="busy" @update:model-value="status = $event as ThreadGoalStatus" />
      <p v-if="error || loadError" role="alert">{{ error || loadError }}</p>
      <div class="thread-goal-actions">
        <button v-if="goal" type="button" :disabled="busy" @click="save(true)">{{ ('Clear goal') }}</button>
        <button type="button" :disabled="busy" @click="editing = false">{{ ('Cancel') }}</button>
        <button type="submit" :disabled="busy || !objective.trim()">{{ ('Save goal') }}</button>
      </div>
    </form>
  </section>
</template>
