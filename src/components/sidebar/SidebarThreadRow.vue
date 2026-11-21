<template>
  <SidebarMenuRow
    class="thread-row"
    :href="href"
    :current="active"
    :title="thread.title"
    :data-active="active"
    :data-pinned="pinned"
    :data-menu-open="menuOpen ? 'true' : 'false'"
    :data-delete-confirming="deleteConfirming"
    @activate="emit('select')"
  >
    <template #left>
      <span v-if="shouldShowThreadIndicator(thread)" class="thread-status-indicator" :data-state="getThreadState(thread)" />
    </template>
    <span class="thread-row-title-line">
      <span class="thread-row-title">{{ thread.title }}</span>
      <IconTablerGitFork v-if="thread.hasWorktree" class="thread-row-worktree-icon" :title="('Worktree thread')" />
      <span
        v-if="thread.pendingRequestState"
        class="thread-row-request-chip"
        :data-state="thread.pendingRequestState"
      >
        {{ threadRequestLabel(thread) }}
      </span>
    </span>
    <template #right>
      <span class="thread-row-time">{{ relativeTime }}</span>
    </template>
    <template #left-action>
      <button
        class="thread-delete-button"
        type="button"
        :data-confirming="deleteConfirming"
        :title="deleteConfirming ? 'Confirm delete' : 'Delete thread'"
        :aria-label="deleteConfirming ? 'Confirm delete' : 'Delete thread'"
        @click="emit('delete')"
      >
        <span v-if="deleteConfirming" class="thread-delete-confirm-label">Confirm</span>
        <IconTablerTrash v-else class="thread-icon" />
      </button>
    </template>
    <template #actions>
      <div :ref="(el) => emit('menu-anchor', el)" class="thread-menu-wrap">
        <button
          class="thread-menu-trigger"
          type="button"
          title="thread_menu"
          aria-label="Thread actions"
          :aria-expanded="menuOpen"
          @click="emit('toggle-menu', $event.detail === 0)"
          @keydown.esc="menuOpen && emit('dismiss-menu')"
        >
          <IconTablerDots class="thread-icon" />
        </button>
      </div>
    </template>
  </SidebarMenuRow>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { UiThread } from '../../types/codex'
import { sidebarHref, threadRoute } from '../../router/sidebarRoutes'
import SidebarMenuRow from './SidebarMenuRow.vue'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerGitFork from '../icons/IconTablerGitFork.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'

const props = defineProps<{
  thread: UiThread
  active: boolean
  pinned: boolean
  menuOpen: boolean
  deleteConfirming: boolean
  relativeTime: string
}>()

const router = useRouter()
const href = computed(() => sidebarHref(router, threadRoute(props.thread.id)))

const emit = defineEmits<{
  select: []
  delete: []
  'toggle-menu': [keyboard: boolean]
  'dismiss-menu': []
  'menu-anchor': [element: Element | ComponentPublicInstance | null]
}>()


function shouldShowThreadIndicator(thread: UiThread): boolean {
  return Boolean(thread.pendingRequestState) || thread.inProgress || thread.unread
}

function threadRequestLabel(thread: UiThread): string {
  return thread.pendingRequestState === 'approval' ? 'Awaiting approval' : 'Awaiting response'
}

function getThreadState(thread: UiThread): 'awaiting-approval' | 'awaiting-response' | 'working' | 'unread' | 'idle' {
  if (thread.pendingRequestState === 'approval') return 'awaiting-approval'
  if (thread.pendingRequestState === 'response') return 'awaiting-response'
  if (thread.inProgress) return 'working'
  if (thread.unread) return 'unread'
  return 'idle'
}
</script>

<style scoped>
@reference "tailwindcss";

.thread-row {
  @apply hover:bg-zinc-200;
  --sidebar-row-link-right-padding: 2.25rem;
}

.thread-row[data-menu-open='true'] {
  @apply relative z-30;
}

.thread-row[data-delete-confirming='true'] {
  --sidebar-row-link-left-width: 4rem;
}

.thread-delete-button {
  @apply h-4 min-w-4 rounded text-zinc-500 opacity-0 pointer-events-none transition flex items-center justify-center;
}

.thread-delete-button[data-confirming='true'] {
  @apply h-5 min-w-16 px-1.5 bg-rose-600 text-white opacity-100 pointer-events-auto shadow-sm;
}

.thread-delete-confirm-label {
  @apply text-[11px] font-medium leading-none;
}

.thread-row-title-line {
  @apply min-w-0 flex w-full items-center gap-1.5 min-h-5;
}

.thread-row-title {
  @apply min-w-0 block flex-1 text-sm leading-5 font-normal text-zinc-800 truncate whitespace-nowrap;
}

.thread-row-worktree-icon {
  @apply w-3 h-3 text-zinc-500 shrink-0;
}

.thread-row-request-chip {
  @apply inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none;
}

.thread-row-request-chip[data-state='approval'] {
  @apply border-emerald-500/20 bg-emerald-500/15 text-emerald-700;
}

.thread-row-request-chip[data-state='response'] {
  @apply border-sky-200 bg-sky-50 text-sky-700;
}

.thread-status-indicator {
  @apply w-2.5 h-2.5 rounded-full;
}

.thread-row-time {
  @apply block text-sm font-normal text-zinc-500;
}

.thread-menu-wrap {
  @apply relative;
}

.thread-menu-trigger {
  @apply h-4 w-4 rounded p-0 text-xs text-zinc-600 flex items-center justify-center pointer-events-auto;
}

.thread-row[data-active='true'] {
  @apply bg-zinc-200;
}

.thread-row:hover .thread-delete-button,
.thread-row:focus-within .thread-delete-button,
.thread-delete-button[data-confirming='true'] {
  @apply opacity-100 pointer-events-auto;
}

.thread-status-indicator[data-state='unread'] {
  width: 6.6667px;
  height: 6.6667px;
  @apply bg-blue-600;
}

.thread-status-indicator[data-state='working'] {
  @apply border-2 border-zinc-500 border-t-transparent bg-transparent animate-spin;
}

.thread-status-indicator[data-state='awaiting-approval'] {
  @apply bg-emerald-500;
}

.thread-status-indicator[data-state='awaiting-response'] {
  @apply bg-sky-500;
}

.thread-row:hover .thread-status-indicator[data-state='unread'],
.thread-row:hover .thread-status-indicator[data-state='working'],
.thread-row:hover .thread-status-indicator[data-state='awaiting-approval'],
.thread-row:hover .thread-status-indicator[data-state='awaiting-response'],
.thread-row:focus-within .thread-status-indicator[data-state='unread'],
.thread-row:focus-within .thread-status-indicator[data-state='working'],
.thread-row:focus-within .thread-status-indicator[data-state='awaiting-approval'],
.thread-row:focus-within .thread-status-indicator[data-state='awaiting-response'],
.thread-row[data-delete-confirming='true'] .thread-status-indicator {
  @apply opacity-0;
}

.thread-icon {
  @apply w-4 h-4;
}

@media (hover: none) {
  .thread-delete-button {
    @apply opacity-100 pointer-events-auto;
  }

  .thread-row .thread-status-indicator[data-state] {
    @apply absolute left-0.5 opacity-100;
  }
}
</style>
