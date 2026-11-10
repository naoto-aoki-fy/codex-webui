<template>
  <div class="skills-hub">
    <div class="skills-hub-header">
      <h2 class="skills-hub-title">{{ t('Skills Hub') }}</h2>
      <p class="skills-hub-subtitle">{{ t('Install and manage skills outside this web app. Reload this page after installing skills.') }}</p>
    </div>

    <div v-if="toast" class="skills-hub-toast" :class="toastClass">{{ toast.text }}</div>

    <slot name="before-installed" />

    <div v-if="installedSkills.length > 0" class="skills-hub-section">
      <button class="skills-hub-section-toggle" type="button" @click="isInstalledOpen = !isInstalledOpen">
        <span class="skills-hub-section-title">{{ t('Installed skills ({count})', { count: installedSkills.length }) }}</span>
        <IconTablerChevronRight class="skills-hub-section-chevron" :class="{ 'is-open': isInstalledOpen }" />
      </button>
      <div v-if="isInstalledOpen" class="skills-hub-grid">
        <SkillCard
          v-for="skill in installedSkills"
          :key="skill.name"
          :skill="skill"
          @select="openDetail"
        />
      </div>
    </div>

    <div class="skills-hub-section">
      <div v-if="isLoading" class="skills-hub-loading">{{ t('Loading skills...') }}</div>
      <div v-else-if="error" class="skills-hub-error">
        <span>{{ error }}</span>
      </div>
      <div v-else-if="installedSkills.length === 0" class="skills-hub-empty">{{ t('No installed skills found. Install skills outside this web app, then reload this page.') }}</div>
    </div>

    <SkillDetailModal
      :skill="detailSkill"
      :visible="isDetailOpen"
      :is-trying="props.tryInFlightKey === skillTryKey(detailSkill)"
      @close="isDetailOpen = false"
      @toggle-enabled="handleToggleEnabled"
      @try="handleTrySkill"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import SkillCard from './SkillCard.vue'
import SkillDetailModal from './SkillDetailModal.vue'
import type { LocalSkill } from '../../types/skills'
import { useUiLanguage } from '../../composables/useUiLanguage'

const EMPTY_SKILL: LocalSkill = { name: '', description: '' }
type SkillsHubPayload = { installed?: LocalSkill[] }

const installedSkills = ref<LocalSkill[]>([])
const isLoading = ref(false)
const error = ref('')
const isInstalledOpen = ref(true)
const isDetailOpen = ref(false)
const detailSkill = ref<LocalSkill>(EMPTY_SKILL)
const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
const { t } = useUiLanguage()

const props = defineProps<{
  tryInFlightKey?: string
}>()

const emit = defineEmits<{
  'skills-changed': []
  'try-item': [payload: { kind: 'skill'; name: string; displayName: string; skillPath?: string }]
}>()

const toastClass = computed(() => toast.value?.type === 'error' ? 'skills-hub-toast-error' : 'skills-hub-toast-success')

function showToast(text: string, type: 'success' | 'error' = 'success'): void {
  toast.value = { text, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 3000)
}

function applySkillsPayload(payload: SkillsHubPayload): void {
  installedSkills.value = (payload.installed ?? []).map(({ name, description, path, enabled }) => ({ name, description, path, enabled }))
}

async function fetchSkills(): Promise<void> {
  isLoading.value = true
  error.value = ''
  try {
    const resp = await fetch('/codex-api/skills-hub')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as SkillsHubPayload
    applySkillsPayload(data)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load skills'
  } finally {
    isLoading.value = false
  }
}

function openDetail(skill: LocalSkill): void {
  detailSkill.value = skill
  isDetailOpen.value = true
}

async function handleToggleEnabled(skill: LocalSkill, enabled: boolean): Promise<void> {
  try {
    const resp = await fetch('/codex-api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'skills/config/write', params: { path: skill.path, enabled } }),
    })
    if (!resp.ok) throw new Error('Failed to update skill')
    showToast(`${skill.name} skill ${enabled ? 'enabled' : 'disabled'}`)
    emit('skills-changed')
    await fetchSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Failed to update skill', 'error')
  }
}

function handleTrySkill(skill: LocalSkill): void {
  if (skill.enabled === false) return
  if (props.tryInFlightKey) return
  emit('try-item', {
    kind: 'skill',
    name: skill.name,
    displayName: skill.name,
    skillPath: skill.path,
  })
  isDetailOpen.value = false
}

function skillTryKey(skill: LocalSkill): string {
  return `skill:${skill.name}:${skill.path ?? ''}`
}

onMounted(() => {
  void fetchSkills()
})
</script>

<style scoped>
@reference "tailwindcss";

.skills-hub {
  @apply flex flex-col gap-3 sm:gap-4 p-3 sm:p-6 max-w-4xl mx-auto w-full overflow-y-auto h-full;
}

.skills-hub-header {
  @apply flex flex-col gap-1;
}

.skills-hub-title {
  @apply text-xl sm:text-2xl font-semibold text-zinc-900 m-0;
}

.skills-hub-subtitle {
  @apply text-sm text-zinc-500 m-0;
}

.skills-hub-toast {
  @apply rounded-lg px-3 py-2 text-sm font-medium;
}

.skills-hub-toast-success {
  @apply border border-emerald-200 bg-emerald-50 text-emerald-700;
}

.skills-hub-toast-error {
  @apply border border-rose-200 bg-rose-50 text-rose-700;
}

.skills-hub-section {
  @apply flex flex-col gap-2;
}

.skills-hub-section-toggle {
  @apply flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-medium text-zinc-600 transition hover:text-zinc-900 cursor-pointer;
}

.skills-hub-section-title {
  @apply text-sm font-medium;
}

.skills-hub-section-chevron {
  @apply w-3.5 h-3.5 transition-transform;
}

.skills-hub-section-chevron.is-open {
  @apply rotate-90;
}

.skills-hub-grid {
  @apply grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3;
}

.skills-hub-loading {
  @apply text-sm text-zinc-400 py-8 text-center;
}

.skills-hub-error {
  @apply flex items-start justify-between gap-3 text-sm text-rose-600 p-4 text-left rounded-lg border border-rose-200 bg-rose-50;
}

.skills-hub-empty {
  @apply text-sm text-zinc-400 py-8 text-center;
}
</style>
