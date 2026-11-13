<script setup lang="ts">
import { ref } from 'vue'
import { useUiLanguage } from '../../composables/useUiLanguage'
const { t } = useUiLanguage()
const busy = ref(false)
const uploads = ref<{ trackedBytes: number; capacityBytes: number; unknownSizeCount: number; capacityWarning: boolean; cleanup: { reason: string }; uploads: Array<{ path: string; bytes?: number; profile?: string; status?: string }> } | null>(null)
const error = ref('')
const diagnosis = ref<{ profile: string; generation: number; directory: string | null; capabilities: Record<string, { support: string; diagnosis: string; detail: string }>; git?: { available: boolean | null; detail: string } } | null>(null)
async function refresh() {
  busy.value = true
  error.value = ''
  try {
    const response = await fetch('/codex-api/connection-diagnostics?probe=1')
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Cannot read connection diagnostics')
    diagnosis.value = body.data
    const inventoryResponse = await fetch('/codex-api/uploads')
    const inventory = await inventoryResponse.json()
    if (inventoryResponse.ok) uploads.value = inventory
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>
<template>
  <section class="connection-diagnostics">
    <button type="button" :disabled="busy" @click="refresh">{{ t(busy ? 'Checking…' : 'Check remote compatibility') }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="diagnosis">
      <p>{{ t('Connection profile') }}: {{ diagnosis.profile }} · {{ diagnosis.generation }}</p>
      <p>{{ t('Remote directory') }}: {{ diagnosis.directory || t('Set CODEXUI_REMOTE_INITIAL_DIRECTORY or select a workspace') }}</p>
      <ul><li v-for="(item, method) in diagnosis.capabilities" :key="method"><strong>{{ method }}</strong>: {{ t(item.support) }} — {{ t(item.diagnosis) }}<br>{{ item.detail }}</li></ul>
      <p v-if="diagnosis.git">Git: {{ diagnosis.git.detail }}</p>
    </template>
    <details v-if="uploads">
      <summary>{{ t('Managed uploads') }}: {{ uploads.trackedBytes }} / {{ uploads.capacityBytes }} {{ t('tracked bytes') }}</summary>
      <p>{{ t('Tracked attempts only; remote directory totals and references are unknown. Automatic deletion is disabled.') }}</p>
      <p v-if="uploads.capacityWarning" role="alert">{{ t('Upload capacity is nearly full. Audit retained attachments before raising the capacity limit.') }}</p>
      <p>{{ t('Unknown sizes') }}: {{ uploads.unknownSizeCount }}</p>
      <ul><li v-for="upload in uploads.uploads" :key="upload.path">{{ upload.path }} · {{ upload.bytes ?? '?' }} · {{ upload.profile || 'legacy/unknown' }} · {{ upload.status || 'unknown' }}</li></ul>
      <p>{{ uploads.cleanup.reason }}</p>
    </details>
  </section>
</template>
