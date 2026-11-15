<script setup lang="ts">
import {computed} from 'vue'
import type {DeniedAction} from '../../composables/deniedActionObservation'
const props=defineProps<{threadId:string;rows:DeniedAction[]}>()
const selected=computed(()=>props.rows.filter(row=>row.threadId===props.threadId))
</script>
<template>
 <details class="feature-panel denied-actions"><summary>Denied-action inspection</summary>
  <p>Native auto-review denials observed on this connection only. Earlier history and ordinary approval rejections may be unavailable.</p>
  <p v-if="!selected.length">No native denials observed for {{ threadId }}.</p>
  <ul><li v-for="row in selected" :key="row.reviewId"><p>Review: {{ row.reviewId }} · Turn: {{ row.turnId }} · Item: {{ row.targetId??'Unavailable (for example a network review)' }}</p><p>Denied · Risk: {{ row.risk }} · Observed: {{ row.observed }}</p><details><summary>Denied native action (bounded)</summary><pre v-text="row.action"></pre></details><p>Retry eligibility: Unavailable. This notification is not the original native Guardian event required by the retry API.</p></li></ul>
 </details>
</template>
