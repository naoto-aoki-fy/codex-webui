<template>
  <a
    class="sidebar-link"
    :href="href"
    @click="onClick"
    @keydown.space.exact.prevent="onSpace"
  >
    <slot />
  </a>
</template>

<script setup lang="ts">
defineProps<{ href: string }>()
const emit = defineEmits<{ activate: [] }>()

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('activate')
}

function onSpace(event: KeyboardEvent): void {
  if (!event.repeat) emit('activate')
}
</script>
