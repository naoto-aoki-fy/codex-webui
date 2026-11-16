<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { recoverableDrafts, type ComposerDraftPayload } from '../../utils/composerDraftStorage'

const props = defineProps<{
  threadId: string
  disabled?: boolean
  recoverDraft: (payload: ComposerDraftPayload) => boolean
}>()
const emit = defineEmits<{ count: [count: number] }>()
const listId = useId()
const entries = ref<ReturnType<typeof recoverableDrafts>>([])
const expanded = ref(false)
const status = ref('')
const error = ref('')

function refresh() {
  entries.value = recoverableDrafts(props.threadId)
  emit('count', entries.value.length)
}
function recover(entry: typeof entries.value[number]) {
  status.value = ''
  error.value = ''
  if (!props.recoverDraft(entry.draft)) {
    error.value = 'Could not preserve the current draft. Copy it before recovering another draft.'
    return
  }
  status.value = 'Draft copied to the composer. Close Settings to review it before sending. The saved source is still available.'
  refresh()
}
function onStorage(event: StorageEvent) {
  if (event.key === null || event.key.includes('thread-draft.') || event.key.includes('thread-fork-recovery.')) refresh()
}
watch(() => props.threadId, () => {
  expanded.value = false
  status.value = ''
  error.value = ''
  refresh()
}, { immediate: true })
onMounted(() => window.addEventListener('storage', onStorage))
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
</script>

<template>
  <section class="draft-recovery-settings" aria-label="Draft Recovery">
    <h3>Draft Recovery</h3>
    <p>Recover a saved copy for the current conversation and connection profile. Your current draft is saved first.</p>
    <p v-if="!entries.length" role="status">No other saved drafts for this conversation.</p>
    <button v-else type="button" class="draft-recovery-action" :aria-expanded="expanded" :aria-controls="listId"
      @click="refresh(); expanded = !expanded">
      Recover saved drafts ({{ entries.length }})
    </button>
    <button type="button" class="draft-recovery-action" @click="refresh">Refresh saved drafts</button>
    <ul v-if="expanded && entries.length" :id="listId" class="draft-recovery-list">
      <li v-for="entry in entries" :key="entry.key">
        <button type="button" class="draft-recovery-action" :disabled="disabled" @click="recover(entry)">
          Recover copy: {{ entry.draft.text.slice(0, 80) || 'Attachments / Skills / Apps' }}
        </button>
      </li>
    </ul>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>

<style scoped>
.draft-recovery-settings { margin-top: 24px; padding: 16px 12px; border-top: 1px solid #e4e4e7; }
.draft-recovery-settings h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.draft-recovery-settings p { margin: 8px 0; font-size: 13px; color: #71717a; }
.draft-recovery-action { display: block; max-width: 100%; margin-top: 8px; padding: 8px 12px; border: 1px solid #d4d4d8; border-radius: 8px; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.draft-recovery-action:hover { background: #f4f4f5; }
.draft-recovery-action:disabled { opacity: .5; cursor: default; }
.draft-recovery-list { list-style: none; padding: 0; margin: 12px 0 0; }
</style>
