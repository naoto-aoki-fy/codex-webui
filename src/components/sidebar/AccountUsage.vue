<script setup lang="ts">
import { ref, toRef } from 'vue'
import { usageMetrics } from '../../api/accountUsage'
import { createAccountUsage } from '../../composables/accountUsage'
const props = defineProps<{ epoch: number }>()
const { busy, loaded, data, error, refresh } = createAccountUsage(toRef(props, 'epoch'))
const visibleDays = ref(30)
</script>
<template>
  <details class="feature-panel account-usage">
    <summary>Account usage history</summary>
    <p>Account-wide token activity from the connected server. Separate from conversation context and remaining rate limits. No cost estimates.</p>
    <button type="button" :disabled="busy" @click="refresh()">{{ busy ? 'Loading usage…' : 'Refresh account usage' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!loaded && !busy">Load usage on demand.</p>
    <p v-else-if="loaded && !data">Account usage unavailable for this account.</p>
    <template v-if="data">
      <dl><template v-for="[key, label, unit] in usageMetrics" :key="key"><dt>{{ label }}</dt><dd>{{ data.summary[key] === undefined ? 'Unavailable' : `${data.summary[key]?.toLocaleString()} ${unit}` }}</dd></template></dl>
      <p v-if="data.daily === null">Daily history unavailable.</p>
      <p v-else-if="!data.daily.length">No daily usage records returned.</p>
      <template v-else>
        <p>Daily buckets — dates as reported by the server; timezone unavailable.</p>
        <ul><li v-for="(day, index) in data.daily.slice(0, visibleDays)" :key="index">{{ day.startDate }}: {{ day.tokens.toLocaleString() }} tokens</li></ul>
        <button v-if="data.daily.length > visibleDays" type="button" @click="visibleDays += 30">Show more days</button>
      </template>
    </template>
  </details>
</template>
