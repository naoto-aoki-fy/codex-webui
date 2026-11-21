<template>
  <component :is="as" class="sidebar-menu-row" :data-linked="href !== undefined">
    <component
      :is="href !== undefined ? SidebarLink : 'span'"
      class="sidebar-menu-row-body"
      :href="href"
      :aria-current="current ? 'page' : undefined"
      :aria-expanded="expanded"
      @activate="emit('activate')"
    >
      <span v-if="$slots.left" class="sidebar-menu-row-left">
        <slot name="left" />
      </span>
      <span class="sidebar-menu-row-main">
        <slot />
      </span>
      <span v-if="$slots.right" class="sidebar-menu-row-right">
        <slot name="right" />
      </span>
    </component>

    <span v-if="$slots['left-action']" class="sidebar-menu-row-left-action">
      <slot name="left-action" />
    </span>
    <div v-if="$slots.actions" class="sidebar-menu-row-actions">
      <slot name="actions" />
    </div>
  </component>
</template>

<script setup lang="ts">
import SidebarLink from './SidebarLink.vue'

withDefaults(defineProps<{
  as?: string
  href?: string
  current?: boolean
  expanded?: boolean
}>(), { as: 'div', expanded: undefined })

const emit = defineEmits<{ activate: [] }>()
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-menu-row {
  @apply w-full min-w-0 rounded-lg px-3 py-1 text-left transition flex items-center gap-2;
}

.sidebar-menu-row-body {
  display: contents;
}

.sidebar-menu-row[data-linked='true'] {
  @apply relative p-0;
}

.sidebar-menu-row[data-linked='true'] > .sidebar-menu-row-body {
  @apply flex items-center gap-2 w-full min-w-0 rounded-lg px-3 py-1;
  padding-right: var(--sidebar-row-link-right-padding, 0.75rem);
}

.sidebar-menu-row-left {
  @apply h-4 shrink-0 flex items-center justify-center text-zinc-500;
  width: var(--sidebar-row-link-left-width, 1rem);
}

.sidebar-menu-row-main {
  @apply min-w-0 flex-1;
}

.sidebar-menu-row-right {
  @apply ml-2 shrink-0 flex items-center justify-end;
}

.sidebar-menu-row-left-action,
.sidebar-menu-row-actions {
  @apply absolute top-1/2 -translate-y-1/2 pointer-events-none;
}

.sidebar-menu-row-left-action {
  @apply left-3;
}

.sidebar-menu-row-actions {
  @apply right-3;
}
</style>
