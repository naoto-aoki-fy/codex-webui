<script setup lang="ts">
import type {createNativeQueue} from '../../composables/nativeQueue'
defineProps<{threadId:string;disconnected:boolean;queue:ReturnType<typeof createNativeQueue>}>()
</script>
<template>
 <details id="native-prompt-queue" class="feature-panel native-prompt-queue"><summary>Native deferred prompt queue</summary>
  <p>Thread: {{ threadId }}. Native persistence and ordering; this is separate from immediate steering. Queued input uses native settings when executed.</p>
  <button type="button" :disabled="queue.reading.value||disconnected" @click="queue.refresh()">Read native queue</button>
  <p v-if="queue.stale.value">Queue changed. Refresh before acting.</p><p v-if="queue.loaded.value&&!queue.rows.value.length">No pending prompts returned.</p>
  <p v-if="queue.operationThread.value===threadId" role="status">{{ queue.status.value }}</p><p v-if="queue.readError.value" role="alert">{{ queue.readError.value }}</p>
  <p v-if="queue.uncertain.value" role="alert">{{ queue.uncertain.value }}</p><button v-if="queue.uncertain.value" type="button" :disabled="!queue.loaded.value||queue.reading.value||queue.writing.value" @click="queue.acknowledgeUnknown">Acknowledge uncertain queue outcome after inspection</button>
  <ul><li v-for="row in queue.rows.value" :key="row.id"><p>{{ row.id }} · Client message: {{ row.clientId }}</p><p>Input types: {{ row.types.join(', ') }}</p><details><summary>Pending prompt preview (first 8,000 characters)</summary><pre v-text="row.preview"></pre></details></li></ul>
  <button v-if="queue.cursor.value" type="button" :disabled="queue.reading.value||queue.stale.value||disconnected||queue.rows.value.length>=100" @click="queue.refresh(true)">More queued prompts</button><p v-if="queue.rows.value.length>=100">First 100 queued prompts shown.</p>
 </details>
</template>
