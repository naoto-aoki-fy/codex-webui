<script setup lang="ts">
import { ref } from 'vue'
import { copyTextToClipboard } from '../../utils/clipboard'

const commitSha = __BUILD_COMMIT_SHA__
const buildTimestamp = __BUILD_TIMESTAMP__
const hasCommit = commitSha !== 'Unknown'
const shortCommitSha = hasCommit ? commitSha.slice(0, 12) : 'Unknown'
const commitUrl = `https://github.com/naoto-aoki-fy/codex-webui/commit/${commitSha}`
const readableTimestamp = buildTimestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
const copyStatus = ref('')
const isCopying = ref(false)

async function copyCommitSha() {
  if (!hasCommit || isCopying.value) return
  isCopying.value = true
  copyStatus.value = ''
  try {
    await copyTextToClipboard(commitSha)
    copyStatus.value = 'Copied full commit SHA.'
  } catch {
    copyStatus.value = 'Could not copy commit SHA.'
  } finally {
    isCopying.value = false
  }
}
</script>

<template>
  <section class="about-settings" aria-label="About">
    <h3>Codex WebUI</h3>
    <dl>
      <div class="about-settings-row">
        <dt>Git commit SHA</dt>
        <dd>
          <template v-if="hasCommit">
            <a :href="commitUrl" target="_blank" rel="noopener noreferrer" :title="`View commit ${commitSha} on GitHub`"><code>{{ shortCommitSha }}</code></a>
            <button type="button" :disabled="isCopying" aria-label="Copy full commit SHA" @click="copyCommitSha">Copy</button>
          </template>
          <span v-else>Unknown</span>
        </dd>
      </div>
      <div class="about-settings-row">
        <dt>Build timestamp</dt>
        <dd><time :datetime="buildTimestamp">{{ readableTimestamp }}</time></dd>
      </div>
    </dl>
    <p class="about-settings-status" role="status">{{ copyStatus }}</p>
  </section>
</template>

<style scoped>
@reference "tailwindcss";

.about-settings h3 {
  @apply mb-4 text-base font-semibold;
}
.about-settings-row {
  @apply flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-200 py-3;
}
.about-settings-row dt {
  @apply text-zinc-500;
}
.about-settings-row dd {
  @apply flex flex-wrap items-center gap-3 min-w-0;
  overflow-wrap: anywhere;
}
.about-settings-row a {
  @apply text-blue-600 underline underline-offset-2;
}
.about-settings-row button {
  @apply rounded border border-zinc-300 px-2 py-1 text-xs cursor-pointer hover:bg-zinc-100 disabled:opacity-50;
}
.about-settings-status {
  @apply mt-3 text-sm;
}
</style>
