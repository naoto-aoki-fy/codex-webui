<template>
  <div class="sidebar-thread-controls">
    <button
      class="sidebar-thread-controls-button"
      type="button"
      :aria-label="isSidebarCollapsed ? ('Expand sidebar') : ('Collapse sidebar')"
      :title="isSidebarCollapsed ? ('Expand sidebar') : ('Collapse sidebar')"
      @click="$emit('toggle-sidebar')"
    >
      <IconTablerLayoutSidebarFilled v-if="isSidebarCollapsed" class="sidebar-thread-controls-icon" />
      <IconTablerLayoutSidebar v-else class="sidebar-thread-controls-icon" />
    </button>

    <slot />

    <SidebarLink
      class="sidebar-thread-controls-button"
      :href="newThreadHref"
      :aria-label="('Start new thread')"
      :title="('Start new thread')"
      @activate="$emit('start-new-thread')"
    >
      <IconTablerFilePencil class="sidebar-thread-controls-icon" />
    </SidebarLink>
  </div>
</template>

<script setup lang="ts">
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'
import SidebarLink from './SidebarLink.vue'

defineProps<{
  isSidebarCollapsed: boolean
  newThreadHref: string
}>()

defineEmits<{
  'toggle-sidebar': []
  'start-new-thread': []
}>()

</script>

<style scoped>
@reference "tailwindcss";

.sidebar-thread-controls {
  @apply flex flex-row flex-nowrap items-center gap-2;
}

.sidebar-thread-controls-button {
  @apply h-6.75 w-6.75 rounded-md border border-transparent bg-transparent text-zinc-600 flex items-center justify-center transition hover:border-zinc-200 hover:bg-zinc-50;
}

.sidebar-thread-controls-icon {
  @apply w-4 h-4;
}
</style>
