<script setup lang="ts">
import { toRef, watch } from 'vue'
import { createArchivedThreads } from '../../composables/archivedThreads'
const props = defineProps<{ active: boolean; epoch: number; restore: (id: string) => Promise<void> }>()
const { rows, busy, error, cursor, loaded, load, restoreRow } = createArchivedThreads(toRef(props, 'epoch'), props.restore)
watch(() => props.active, active => { if (active && !loaded.value) void load() }, { immediate: true })
</script>
<template>
  <section class="archive-browser feature-panel" aria-label="Archived conversations">
    <h3 class="mb-4 text-base font-semibold">Archived conversations</h3>
    <p>Restore keeps the original conversation and native project association.</p>
    <button type="button" :disabled="busy" @click="load()">Refresh archived conversations</button>
    <p v-if="busy" role="status">Loading…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loaded && !busy && !rows.length">No archived conversations.</p>
    <ul>
      <li v-for="row in rows" :key="row.id">
        <span :title="row.title">{{ row.title }}</span>
        <button type="button" :disabled="busy" :aria-label="`Restore ${row.title}`" @click="restoreRow(row.id)">Restore</button>
      </li>
    </ul>
    <button v-if="cursor" type="button" :disabled="busy" @click="load(true)">Load more archived conversations</button>
  </section>
</template>
