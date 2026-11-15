<script setup lang="ts">
import { toRef } from 'vue'
import { createArchivedThreads } from '../../composables/archivedThreads'
const props = defineProps<{ epoch: number; restore: (id: string) => Promise<void> }>()
const { rows, busy, error, cursor, loaded, load, restoreRow } = createArchivedThreads(toRef(props, 'epoch'), props.restore)
function opened(event: Event) {
  if ((event.target as HTMLDetailsElement).open && !loaded.value) void load()
}
</script>
<template>
  <details class="archive-browser feature-panel" @toggle="opened">
    <summary>Archived conversations</summary>
    <p>Restore keeps the original conversation and native project association.</p>
    <button type="button" :disabled="busy" @click="load()">Refresh archived conversations</button>
    <p v-if="busy" role="status">Loading…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loaded && !busy && !rows.length">No archived conversations.</p>
    <ul>
      <li v-for="row in rows" :key="row.id">
        <span>{{ row.title }}</span>
        <button type="button" :disabled="busy" :aria-label="`Restore ${row.title}`" @click="restoreRow(row.id)">Restore</button>
      </li>
    </ul>
    <button v-if="cursor" type="button" :disabled="busy" @click="load(true)">Load more archived conversations</button>
  </details>
</template>
