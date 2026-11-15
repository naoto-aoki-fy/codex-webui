<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { sanitizedDiagnosticReport, type DiagnosticWarning } from '../../diagnostics'
import { copyTextToClipboard } from '../../utils/clipboard'
const props = defineProps<{ epoch: number; warnings: DiagnosticWarning[] }>()
const copied = ref('')
const report = computed(() => sanitizedDiagnosticReport(diagnosis.value, props.warnings))
watch(() => props.epoch, () => { diagnosis.value = null; uploads.value = null; copied.value = ''; error.value = 'Connection changed. Read diagnostics again.' })
async function copyReport() {
  try { await copyTextToClipboard(report.value); copied.value = 'Copied sanitized diagnostic report.' }
  catch { copied.value = 'Clipboard unavailable. Select and copy the report below.' }
}
const busy = ref(false)
const uploads = ref<{ trackedBytes: number; capacityBytes: number; unknownSizeCount: number; capacityWarning: boolean; cleanup: { reason: string }; uploads: Array<{ path: string; bytes?: number; profile?: string; status?: string }> } | null>(null)
const error = ref('')
const diagnosis = ref<{ connection?: string; platformOs?: string; profile: string; generation: number; directory: string | null; capabilities: Record<string, { support: string; diagnosis: string; detail: string }>; git?: { available: boolean | null; detail: string } } | null>(null)
async function refresh(probe = false) {
  if (busy.value) return
  const epoch = props.epoch
  busy.value = true
  error.value = ''
  diagnosis.value = null
  copied.value = ''
  try {
    const response = await fetch(`/codex-api/connection-diagnostics${probe ? '?probe=1' : ''}`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Cannot read connection diagnostics')
    if (epoch !== props.epoch) return
    if (!body.data || typeof body.data !== 'object') throw new Error('Incompatible diagnostic response')
    diagnosis.value = body.data
    if (!probe) return
    const inventoryResponse = await fetch('/codex-api/uploads')
    const inventory = await inventoryResponse.json()
    if (epoch === props.epoch && inventoryResponse.ok) uploads.value = inventory
  } catch (cause) { if (epoch === props.epoch) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>
<template>
  <details class="connection-diagnostics feature-panel">
    <summary>Warnings and diagnostics ({{ warnings.length }})</summary>
    <button type="button" :disabled="busy" @click="refresh()">Read diagnostics</button>
    <button type="button" :disabled="busy" @click="refresh(true)">{{ (busy ? 'Checking…' : 'Check remote compatibility') }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="diagnosis">
      <p>Connection: {{ diagnosis.connection || 'Unknown' }} · Platform: {{ diagnosis.platformOs || 'Unavailable' }} · Runtime version: unavailable</p>
      <p>{{ ('Connection profile') }}: {{ diagnosis.profile }} · {{ diagnosis.generation }}</p>
      <p>{{ ('Remote directory') }}: {{ diagnosis.directory || ('Set CODEXUI_REMOTE_INITIAL_DIRECTORY or select a workspace') }}</p>
      <ul><li v-for="(item, method) in diagnosis.capabilities" :key="method"><strong>{{ method }}</strong>: {{ (item.support) }} — {{ (item.diagnosis) }}<br>{{ item.detail }}</li></ul>
      <p v-if="diagnosis.git">Git: {{ diagnosis.git.detail }}</p>
    </template>
    <p>Warnings observed in this browser session (latest 20; cleared on connection change).</p>
    <p v-if="!warnings.length">No warnings observed. This does not prove the runtime has no warnings.</p>
    <ul><li v-for="(warning, index) in warnings" :key="index">{{ warning.atIso }} — {{ warning.message }}</li></ul>
    <template v-if="diagnosis">
      <button type="button" @click="copyReport">Copy diagnostic report</button>
      <p v-if="copied" role="status">{{ copied }}</p>
      <details><summary>Inspect sanitized report</summary><pre class="diagnostic-report">{{ report }}</pre></details>
    </template>
    <p>No feedback is uploaded. Copied reports omit all free-form warning/error messages, URLs, paths and configuration.</p>
    <details v-if="uploads">
      <summary>{{ ('Managed uploads') }}: {{ uploads.trackedBytes }} / {{ uploads.capacityBytes }} {{ ('tracked bytes') }}</summary>
      <p>{{ ('Tracked attempts only; remote directory totals and references are unknown. Automatic deletion is disabled.') }}</p>
      <p v-if="uploads.capacityWarning" role="alert">{{ ('Upload capacity is nearly full. Audit retained attachments before raising the capacity limit.') }}</p>
      <p>{{ ('Unknown sizes') }}: {{ uploads.unknownSizeCount }}</p>
      <ul><li v-for="upload in uploads.uploads" :key="upload.path">{{ upload.path }} · {{ upload.bytes ?? '?' }} · {{ upload.profile || 'legacy/unknown' }} · {{ upload.status || 'unknown' }}</li></ul>
      <p>{{ uploads.cleanup.reason }}</p>
    </details>
  </details>
</template>
