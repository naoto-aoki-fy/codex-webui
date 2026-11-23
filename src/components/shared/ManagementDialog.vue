<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import IconTablerX from '../icons/IconTablerX.vue'
const props = defineProps<{ open: boolean; title: string; description?: string }>()
const emit = defineEmits<{ close: []; opened: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let returnFocus: HTMLElement | null = null
function restoreFocus() {
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}
watch(() => props.open, async open => {
  if (open && typeof document !== 'undefined') {
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      const composer = active.closest('.thread-composer-attach, .composer-apps-popover')?.closest('form')
      returnFocus = composer?.querySelector<HTMLElement>('.thread-composer-attach-trigger')
        ?? active.closest('details')?.querySelector<HTMLElement>('summary') ?? active
    }
  }
  await nextTick()
  if (!dialog.value || props.open !== open) return
  if (open && !dialog.value.open) {
    dialog.value.showModal()
    emit('opened')
  } else if (!open && dialog.value.open) {
    dialog.value.close()
    restoreFocus()
  }
}, { immediate: true, flush: 'pre' })
function containFocus(event: KeyboardEvent) {
  const panel = dialog.value
  if (!panel) return
  const targets = [...panel.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, summary, [tabindex]')]
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.checkVisibility())
  const first = targets[0], last = targets[targets.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function backdrop(event: MouseEvent) {
  if (!dialog.value || event.target !== dialog.value) return
  const box = dialog.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) emit('close')
}
onBeforeUnmount(() => { dialog.value?.close(); restoreFocus() })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="management-dialog" :aria-label="title" @cancel.prevent="emit('close')" @click="backdrop" @keydown.esc.stop @keydown.tab="containFocus">
      <header class="management-dialog-header">
        <div><h2>{{ title }}</h2><p v-if="description">{{ description }}</p></div>
        <button type="button" class="management-dialog-close" autofocus aria-label="Close dialog" @click="emit('close')"><IconTablerX /></button>
      </header>
      <div class="management-dialog-body"><slot /></div>
    </dialog>
  </Teleport>
</template>
