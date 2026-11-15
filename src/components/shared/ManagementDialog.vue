<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import IconTablerX from '../icons/IconTablerX.vue'
const props = defineProps<{ open: boolean; title: string; description?: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let returnFocus: HTMLElement | null = null
function restoreFocus() {
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}
watch(() => props.open, async open => {
  await nextTick()
  if (!dialog.value || props.open !== open) return
  if (open && !dialog.value.open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value.showModal()
  } else if (!open && dialog.value.open) {
    dialog.value.close()
    restoreFocus()
  }
}, { immediate: true, flush: 'post' })
function backdrop(event: MouseEvent) {
  if (!dialog.value || event.target !== dialog.value) return
  const box = dialog.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) emit('close')
}
onBeforeUnmount(() => { dialog.value?.close(); restoreFocus() })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="management-dialog" :aria-label="title" @cancel.prevent="emit('close')" @click="backdrop" @keydown.esc.stop>
      <header class="management-dialog-header">
        <div><h2>{{ title }}</h2><p v-if="description">{{ description }}</p></div>
        <button type="button" class="management-dialog-close" autofocus aria-label="Close dialog" @click="emit('close')"><IconTablerX /></button>
      </header>
      <div class="management-dialog-body"><slot /></div>
    </dialog>
  </Teleport>
</template>
