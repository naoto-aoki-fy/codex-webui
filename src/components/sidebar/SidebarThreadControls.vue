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

    <div ref="newThreadControls" class="sidebar-new-thread-controls">
      <a
        class="sidebar-thread-controls-button"
        :href="newThreadHref"
        aria-label="Start new thread"
        title="Start new thread"
        @click="startNewThread"
        @contextmenu="onContextMenu"
      >
        <IconTablerFilePencil class="sidebar-thread-controls-icon" />
      </a>
      <button
        class="sidebar-thread-controls-button sidebar-new-thread-menu-trigger"
        type="button"
        aria-label="Start new thread options"
        title="Start new thread options"
        aria-haspopup="menu"
        :aria-expanded="menuTrigger !== null"
        :aria-controls="menuTrigger ? menuId : undefined"
        @click="toggleMenu"
        @keydown.down.prevent="openMenu"
        @keydown.up.prevent="openMenu"
        @contextmenu="onContextMenu"
      >
        <IconTablerChevronDown class="sidebar-new-thread-menu-icon" />
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="menuTrigger"
        :id="menuId"
        ref="menuPanel"
        class="thread-menu-panel thread-menu-panel-fixed"
        :style="menuPosition"
        role="menu"
        aria-label="Start new thread options"
      >
        <a
          ref="menuItem"
          class="thread-menu-item"
          role="menuitem"
          tabindex="-1"
          :href="newThreadHref"
          target="_blank"
          rel="noopener"
          @click="closeMenu(true)"
          @keydown="onMenuItemKeyDown"
        >Open in new tab</a>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, shallowRef, useId, watch } from 'vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerLayoutSidebarFilled from '../icons/IconTablerLayoutSidebarFilled.vue'

defineProps<{
  isSidebarCollapsed: boolean
  newThreadHref: string
}>()

const emit = defineEmits<{
  'toggle-sidebar': []
  'start-new-thread': []
}>()

const menuId = useId()
const newThreadControls = ref<HTMLElement | null>(null)
const menuPanel = ref<HTMLElement | null>(null)
const menuItem = ref<HTMLAnchorElement | null>(null)
const menuTrigger = shallowRef<HTMLElement | null>(null)
const menuPosition = ref({ left: '0px', top: '0px' })

function startNewThread(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  closeMenu()
  emit('start-new-thread')
}

async function openMenu(event: Event): Promise<void> {
  const trigger = event.currentTarget as HTMLElement
  menuTrigger.value = trigger
  await nextTick()
  if (menuTrigger.value !== trigger || !newThreadControls.value || !menuPanel.value) return

  const anchor = newThreadControls.value.getBoundingClientRect()
  const { width, height } = menuPanel.value.getBoundingClientRect()
  const gap = 4
  const left = Math.min(anchor.left, document.documentElement.clientWidth - width - gap)
  const top = anchor.bottom + gap + height <= window.innerHeight
    ? anchor.bottom + gap
    : anchor.top - height - gap
  menuPosition.value = { left: `${Math.max(gap, left)}px`, top: `${Math.max(gap, top)}px` }
  menuItem.value?.focus({ preventScroll: true })
}

function toggleMenu(event: MouseEvent): void {
  if (menuTrigger.value) closeMenu(true)
  else void openMenu(event)
}

function onContextMenu(event: MouseEvent): void {
  if (event.shiftKey && event.button === 2) {
    closeMenu()
    return
  }
  event.preventDefault()
  void openMenu(event)
}

function closeMenu(restoreFocus = false): void {
  const trigger = menuTrigger.value
  menuTrigger.value = null
  if (restoreFocus) trigger?.focus({ preventScroll: true })
}

function onMenuItemKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Tab') closeMenu(true)
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.preventDefault()
  if (event.key === ' ') {
    event.preventDefault()
    menuItem.value?.click()
  }
}

watch(menuTrigger, (trigger, _, onCleanup) => {
  if (!trigger) return

  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node)) return
    if (newThreadControls.value?.contains(event.target) || menuPanel.value?.contains(event.target)) return
    closeMenu()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeMenu(true)
  }
  const onViewportChange = () => closeMenu()
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  onCleanup(() => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('scroll', onViewportChange, true)
  })
})
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

.sidebar-new-thread-controls {
  @apply inline-flex items-center;
}

.sidebar-new-thread-menu-trigger {
  @apply w-5;
}

.sidebar-new-thread-menu-icon {
  @apply size-3;
}
</style>
