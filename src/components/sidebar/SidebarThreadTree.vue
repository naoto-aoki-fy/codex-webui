<template>
  <section class="thread-tree-root">
    <p v-if="pinStateError" class="thread-tree-action-error" role="alert">{{ pinStateError }}</p>
    <section v-if="pinnedThreads.length > 0" class="pinned-section">
      <SidebarMenuRow
        as="button"
        class="section-toggle-row"
        type="button"
        :aria-expanded="isPinnedSectionExpanded"
        @click="togglePinnedSection"
      >
        <template #left>
          <IconTablerChevronRight v-if="!isPinnedSectionExpanded" class="thread-icon" />
          <IconTablerChevronDown v-else class="thread-icon" />
        </template>
        <span class="thread-tree-header">{{ ('Pinned') }}</span>
      </SidebarMenuRow>

      <ul v-if="isPinnedSectionExpanded" class="thread-list">
        <li
          v-for="thread in pinnedThreads"
          :key="thread.id"
          class="thread-row-item"
          :data-menu-open="isThreadMenuOpen(thread.id) ? 'true' : 'false'"
        >
          <SidebarThreadRow
            :thread="thread"
            :active="thread.id === selectedThreadId"
            :pinned="isPinned(thread.id)"
            :menu-open="isThreadMenuOpen(thread.id)"
            :delete-confirming="isInlineDeleteConfirming(thread.id)"
            :relative-time="formatRelativeThread(thread)"
            @select="onSelect(thread.id)"
            @delete="onInlineDeleteClick(thread.id)"
            @toggle-menu="toggleThreadMenu(thread.id, $event)"
            @dismiss-menu="dismissThreadMenu"
            @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
          />
        </li>
      </ul>
    </section>

    <section class="projects-section">
      <SidebarMenuRow class="thread-tree-header-row">
        <span class="thread-tree-header" role="heading" aria-level="2">{{ isChronologicalView ? 'Threads' : isFolderView ? 'Folders' : 'Projects' }}</span>
        <template #right>
          <div ref="organizeMenuWrapRef" class="organize-menu-wrap">
            <button
              class="organize-menu-trigger"
              type="button"
              :aria-expanded="isOrganizeMenuOpen"
              :aria-label="('Organize threads')"
              :title="('Organize threads')"
              @click.stop="toggleOrganizeMenu"
            >
              <IconTablerDots class="thread-icon" />
            </button>

            <div v-if="isOrganizeMenuOpen" class="organize-menu-panel" @click.stop>
              <p class="organize-menu-title">{{ ('Organize') }}</p>
              <button
                class="organize-menu-item"
                :data-active="threadViewMode === 'project'"
                type="button"
                @click="setThreadViewMode('project')"
              >
                <span>{{ ('By project') }}</span>
                <span v-if="threadViewMode === 'project'">✓</span>
              </button>
              <button
                class="organize-menu-item"
                :data-active="isFolderView"
                type="button"
                @click="setThreadViewMode('folder')"
              >
                <span>By Folder</span>
                <span v-if="isFolderView">✓</span>
              </button>
              <button
                class="organize-menu-item"
                :data-active="threadViewMode === 'chronological'"
                type="button"
                @click="setThreadViewMode('chronological')"
              >
                <span>{{ ('Chronological list') }}</span>
                <span v-if="threadViewMode === 'chronological'">✓</span>
              </button>
              <p class="organize-menu-title">{{ ('Sort by') }}</p>
              <button class="organize-menu-item" type="button" :data-active="chatSortMode === 'updated'" @click="chatSortMode = 'updated'">
                <span>{{ ('Updated') }}</span><span v-if="chatSortMode === 'updated'">✓</span>
              </button>
              <button class="organize-menu-item" type="button" :data-active="chatSortMode === 'created'" @click="chatSortMode = 'created'">
                <span>{{ ('Created') }}</span><span v-if="chatSortMode === 'created'">✓</span>
              </button>
            </div>
          </div>
        </template>
      </SidebarMenuRow>

      <p v-if="isSearchActive && filteredGroups.length === 0" class="thread-tree-no-results">{{ ('No matching threads') }}</p>

      <p v-else-if="isLoading && groups.length === 0" class="thread-tree-loading">{{ ('Loading threads...') }}</p>

      <ul v-else-if="isChronologicalView" class="thread-list thread-list-global">
      <li
        v-for="thread in globalThreads"
        :key="thread.id"
        class="thread-row-item"
        :data-menu-open="isThreadMenuOpen(thread.id) ? 'true' : 'false'"
      >
        <SidebarThreadRow
          :thread="thread"
          :active="thread.id === selectedThreadId"
          :pinned="isPinned(thread.id)"
          :menu-open="isThreadMenuOpen(thread.id)"
          :delete-confirming="isInlineDeleteConfirming(thread.id)"
          :relative-time="formatRelativeThread(thread)"
          @select="onSelect(thread.id)"
          @delete="onInlineDeleteClick(thread.id)"
          @toggle-menu="toggleThreadMenu(thread.id, $event)"
          @dismiss-menu="dismissThreadMenu"
          @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
        />
      </li>
    </ul>

    <div v-else ref="groupsContainerRef" class="thread-tree-groups" :style="groupsContainerStyle">
      <article
        v-for="group in filteredGroups"
        :key="group.key"
        :ref="(el) => setProjectGroupRef(group.key, el)"
        class="project-group"
        :data-project-name="group.kind === 'project' ? group.projectId : undefined"
        :data-folder-path="group.kind === 'folder' ? group.cwd : undefined"
        :data-expanded="!isCollapsed(group.key)"
        :style="projectGroupStyle(group.key)"
      >
          <SidebarMenuRow
            class="project-header-row"
            :href="groupDestinationByKey.get(group.key)!.href"
            :expanded="!isCollapsed(group.key)"
            :data-active="group.key === activeGroupKey"
            :data-menu-open="isProjectMenuOpen(group.key)"
            @activate="toggleGroupCollapse(group)"
          >
            <template #left>
              <span class="project-icon-stack">
                <span class="project-icon-folder">
                  <IconTablerFolder v-if="isCollapsed(group.key)" class="thread-icon" />
                  <IconTablerFolderOpen v-else class="thread-icon" />
                </span>
                <span class="project-icon-chevron">
                  <IconTablerChevronRight v-if="isCollapsed(group.key)" class="thread-icon" />
                  <IconTablerChevronDown v-else class="thread-icon" />
                </span>
              </span>
            </template>
            <span class="project-main-label">
              <span
                class="project-title"
                :class="{ 'folder-title-disambiguated': group.kind === 'folder' && ambiguousFolderNames.has(group.name) }"
                :title="getGroupTooltip(group)"
              >
                {{ getGroupTitle(group) }}
              </span>
            </span>
            <template #actions>
              <div class="project-hover-controls">
                <div
                  :ref="(el) => setProjectMenuWrapRef(group.key, el)"
                  class="project-menu-wrap"
                  @keydown.esc="isProjectMenuOpen(group.key) && dismissProjectMenu()"
                >
                  <button
                    class="project-menu-trigger"
                    type="button"
                    :title="group.kind === 'project' ? 'project_menu' : 'Folder actions'"
                    :aria-label="group.kind === 'project' ? 'Project actions' : 'Folder actions'"
                    :aria-expanded="isProjectMenuOpen(group.key)"
                    @click="toggleProjectMenu(group.key)"
                  >
                    <IconTablerDots class="thread-icon" />
                  </button>

                  <div
                    v-if="isProjectMenuOpen(group.key)"
                    class="project-menu-panel"
                    :data-open-direction="projectMenuDirectionById[group.key] ?? 'down'"
                    @click.stop
                  >
                    <button class="project-menu-item" type="button" @click="onOpenGroupInNewTab(groupDestinationByKey.get(group.key)!.href)">
                      Open in new tab
                    </button>
                    <button v-if="canRemoveProject(group)" class="project-menu-item" type="button" @click="onRenameProject(group)">
                      Rename
                    </button>
                    <button v-if="canMoveProject(group, -1)" class="project-menu-item" type="button" @click="onMoveProject(group, -1)">
                      Move up
                    </button>
                    <button v-if="canMoveProject(group, 1)" class="project-menu-item" type="button" @click="onMoveProject(group, 1)">
                      Move down
                    </button>
                    <button
                      v-if="canRemoveProject(group)"
                      class="project-menu-item project-menu-item-danger"
                      type="button"
                      @click="onRemoveProject(group)"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <SidebarLink
                  class="thread-start-button"
                  :href="groupDestinationByKey.get(group.key)!.href"
                  :aria-label="getNewThreadButtonAriaLabel(group)"
                  :title="getNewThreadButtonAriaLabel(group)"
                  @activate="emit('start-new-thread', groupDestinationByKey.get(group.key)!.target)"
                >
                  <IconTablerFilePencil class="thread-icon" />
                </SidebarLink>
              </div>
            </template>
          </SidebarMenuRow>

          <ul v-if="hasThreads(group)" class="thread-list">
            <li
              v-for="thread in visibleThreads(group)"
              :key="thread.id"
              class="thread-row-item"
              :data-menu-open="isThreadMenuOpen(thread.id) ? 'true' : 'false'"
            >
              <SidebarThreadRow
                :thread="thread"
                :active="thread.id === selectedThreadId"
                :pinned="isPinned(thread.id)"
                :menu-open="isThreadMenuOpen(thread.id)"
                :delete-confirming="isInlineDeleteConfirming(thread.id)"
                :relative-time="formatRelativeThread(thread)"
                @select="onSelect(thread.id)"
                @delete="onInlineDeleteClick(thread.id)"
                @toggle-menu="toggleThreadMenu(thread.id, $event)"
                @dismiss-menu="dismissThreadMenu"
                @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
              />
            </li>
          </ul>

          <SidebarMenuRow v-else as="p" class="project-empty-row">
            <template #left>
              <span class="project-empty-spacer" />
            </template>
            <span class="project-empty">{{ isSearchActive ? ('No matching threads') : ('No threads') }}</span>
          </SidebarMenuRow>

          <SidebarMenuRow v-if="hasHiddenThreads(group)" class="thread-show-more-row">
            <template #left>
              <span class="thread-show-more-spacer" />
            </template>
            <button class="thread-show-more-button" type="button" @click="toggleGroupExpansion(group.key)">
              {{ isExpanded(group.key) ? 'Show less' : 'Show more' }}
            </button>
          </SidebarMenuRow>
      </article>
    </div>
    </section>

    <Teleport to="body">
      <div
        v-if="openThreadMenuThread"
        ref="openThreadMenuPanelRef"
        class="thread-menu-panel thread-menu-panel-fixed"
        :style="openThreadMenuStyle"
        :data-open-direction="getThreadMenuDirection(openThreadMenuThread.id)"
        @click.stop
        @keydown.esc.stop.prevent="dismissThreadMenu"
      >
        <button class="thread-menu-item" type="button" @click="onOpenThreadInNewTab(openThreadMenuThread.id)">
          Open in new tab
        </button>
        <button class="thread-menu-item" type="button" @click="onCopyThreadPath(openThreadMenuThread.id)">
          Copy path
        </button>
        <button
          class="thread-menu-item"
          type="button"
          :disabled="openThreadMenuThread.id !== selectedThreadId"
          :title="openThreadMenuThread.id === selectedThreadId ? 'Copy chat' : 'Open this chat before copying'"
          @click="onCopyThreadChat(openThreadMenuThread.id)"
        >
          Copy chat
        </button>
        <ForkSplitButton label="Fork conversation" variant="sidebar" :disabled="isForkDisabled"
          @fork="onForkThread(openThreadMenuThread.id, $event)" />
        <button class="thread-menu-item" type="button" @click="onTogglePinFromMenu(openThreadMenuThread.id)">
          {{ isPinned(openThreadMenuThread.id) ? 'Unpin thread' : 'Pin thread' }}
        </button>
        <button class="thread-menu-item" type="button" @click="openRenameThreadDialog(openThreadMenuThread.id, openThreadMenuThread.title)">
          {{ ('Rename thread') }}
        </button>
        <button class="thread-menu-item thread-menu-item-danger" type="button" @click="openDeleteThreadDialog(openThreadMenuThread.id, openThreadMenuThread.title)">
          {{ ('Delete thread') }}
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="renameThreadDialogVisible" class="rename-thread-overlay" @click.self="closeRenameThreadDialog">
        <div class="rename-thread-panel" role="dialog" aria-modal="true" :aria-label="renameProjectId ? 'Project name' : 'Thread title'">
          <h3 class="rename-thread-title">{{ renameProjectId ? 'Rename project' : 'Rename thread' }}</h3>
          <p class="rename-thread-subtitle">Make it short and recognizable.</p>
          <input
            ref="renameThreadInputRef"
            v-model="renameThreadDraft"
            class="rename-thread-input"
            type="text"
            :placeholder="renameProjectId ? 'Add name...' : 'Add title...'"
            @keydown.enter.prevent="submitRenameThread"
            @keydown.esc.prevent="closeRenameThreadDialog"
          />
          <div class="rename-thread-actions">
            <button class="rename-thread-button" type="button" @click="closeRenameThreadDialog">{{ ('Cancel') }}</button>
            <button class="rename-thread-button rename-thread-button-primary" type="button" @click="submitRenameThread">{{ ('Save') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="deleteThreadDialogVisible" class="rename-thread-overlay" @click.self="closeDeleteThreadDialog">
        <div class="rename-thread-panel" role="dialog" aria-modal="true" aria-label="Delete thread">
          <h3 class="rename-thread-title">Delete thread?</h3>
          <p class="rename-thread-subtitle">
            This will archive the thread "{{ deleteThreadTitle }}". You can find it later in archived threads.
          </p>
          <div class="rename-thread-actions">
            <button class="rename-thread-button" type="button" @click="closeDeleteThreadDialog">Cancel</button>
            <button class="rename-thread-button rename-thread-button-danger" type="button" @click="submitDeleteThread">
              Delete
            </button>
          </div>
        </div>
      </div>
    </Teleport>

  </section>
</template>

<script setup lang="ts">
import { readPreferenceRecord, readPreferenceRecords, savePreferenceRecords } from '../../utils/browserPreferenceRecords'
import { readUiPreference, writeUiPreference } from '../../utils/browserUiStorage'
import type { SidebarProps } from './sidebarContracts'
import { newThreadRoute, sidebarHref, type NewThreadTarget } from '../../router/sidebarRoutes'
import { createSidebarMenus } from './sidebarMenus'
import { createSidebarThreads } from './sidebarThreads'
import { projectGroupKey, type SidebarGroup } from './sidebarGroups'

import ForkSplitButton from '../content/ForkSplitButton.vue'
import type { ForkMethod } from '../../types/codex'
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'

import type { UiThread } from '../../types/codex'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerFolderOpen from '../icons/IconTablerFolderOpen.vue'

import SidebarMenuRow from './SidebarMenuRow.vue'
import SidebarThreadRow from './SidebarThreadRow.vue'
import SidebarLink from './SidebarLink.vue'

const router = useRouter()

const props = defineProps<SidebarProps>()

const emit = defineEmits<{
  select: [threadId: string]
  archive: [threadId: string]
  'start-new-thread': [target: NewThreadTarget]
  'rename-thread': [payload: { threadId: string; title: string }]
  'remove-project': [projectId: string]
  'rename-project': [payload: { projectId: string; name: string }]
  'move-project': [payload: { projectId: string; direction: -1 | 1 }]
  'copy-thread-chat': [threadId: string]
  'fork-thread': [payload: { threadId: string; method: ForkMethod }]
}>()

const PROJECT_GROUP_EXPANDED_GAP_PX = 6
const SECTION_EXPANSION_BASE = 'codex-web-local.sidebar-section-expansion.v2'
const PINNED_EXPANSION_STORAGE_KEY = `${SECTION_EXPANSION_BASE}.pinned`
const THREAD_VIEW_MODE_STORAGE_KEY = 'codex-web-local.thread-view-mode.v1'
const CHAT_SORT_MODE_STORAGE_KEY = 'codex-web-local.chat-sort-mode.v1'
const threads = createSidebarThreads({
  get CHAT_SORT_MODE_STORAGE_KEY() { return CHAT_SORT_MODE_STORAGE_KEY; },
  get props() { return props; },
  get THREAD_VIEW_MODE_STORAGE_KEY() { return THREAD_VIEW_MODE_STORAGE_KEY; },
  get isPinned() { return isPinned; },
  get isCollapsed() { return isCollapsed; }
})
const {
  chatSortMode,
  threadViewMode,
  isFolderView,
  activeGroupKey,
  isSearchActive,
  filteredGroups,
  isChronologicalView,
  globalThreads,
  pinStateError,
  pinnedThreads,
  isExpanded,
  toggleGroupExpansion,
  visibleThreads,
  hasHiddenThreads,
  hasThreads,
} = threads

const isPinnedSectionExpanded = ref(loadPinnedSectionExpansion())

const menus = createSidebarMenus({
  get threads() { return threads; },
  get emit() { return emit; },
  get props() { return props; },
  get router() { return router; }
})
const {
  projectMenuDirectionById,
  openThreadMenuStyle,
  renameThreadDialogVisible,
  renameProjectId,
  renameThreadDraft,
  renameThreadInputRef,
  deleteThreadDialogVisible,
  deleteThreadTitle,
  organizeMenuWrapRef,
  openThreadMenuPanelRef,
  isOrganizeMenuOpen,
  openThreadMenuThread,
  onTogglePinFromMenu,
  onSelect,
  onCopyThreadChat,
  onForkThread,
  getNewThreadTarget,
  onOpenGroupInNewTab,
  onCopyThreadPath,
  isThreadMenuOpen,
  toggleThreadMenu,
  dismissThreadMenu,
  onOpenThreadInNewTab,
  openRenameThreadDialog,
  closeRenameThreadDialog,
  submitRenameThread,
  openDeleteThreadDialog,
  closeDeleteThreadDialog,
  submitDeleteThread,
  isInlineDeleteConfirming,
  onInlineDeleteClick,
  canRemoveProject,
  isProjectMenuOpen,
  toggleOrganizeMenu,
  setThreadViewMode,
  toggleProjectMenu,
  dismissProjectMenu,
  onRemoveProject,
  onRenameProject,
  canMoveProject,
  onMoveProject,
  setProjectMenuWrapRef,
  setThreadMenuWrapRef,
  getThreadMenuDirection,
} = menus

type GroupDestination = { target: NewThreadTarget; href: string }
const groupDestinationByKey = computed<Map<string, GroupDestination>>((previous) => {
  const destinations = new Map<string, GroupDestination>()
  for (const group of threads.sidebarGroups.value) {
    const target = getNewThreadTarget(group)
    const last = previous?.get(group.key)
    // Read state and other row updates can replace the group without changing its destination.
    destinations.set(
      group.key,
      last && last.target.cwd === target.cwd && last.target.projectId === target.projectId
        ? last
        : { target, href: sidebarHref(router, newThreadRoute(target)) },
    )
  }
  return destinations
})

const groupsContainerRef = ref<HTMLElement | null>(null)
const measuredHeightByProject = ref<Record<string, number>>({})
const projectGroupElementByName = new Map<string, HTMLElement>()

const projectNameByElement = new WeakMap<HTMLElement, string>()

watch(threads.chatSortMode, value => {
  if (typeof window !== 'undefined') writeUiPreference(CHAT_SORT_MODE_STORAGE_KEY, value)
})

const projectGroupResizeObserver =
  typeof window !== 'undefined'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement
          const projectName = projectNameByElement.get(element)
          if (!projectName) continue
          updateMeasuredProjectHeight(projectName, element)
        }
      })
    : null
const projectCollapseBase = 'codex-web-local.collapsed-projects.v2'
const folderCollapseBase = 'codex-web-local.collapsed-folders.v2'

function loadCollapsedGroups(): Record<string, boolean> {
  const projects = readPreferenceRecords(projectCollapseBase)
  const folders = readPreferenceRecords(folderCollapseBase)
  return Object.fromEntries([
    ...Object.entries(projects).map(([id, value]) => [projectGroupKey(id), value === '1']),
    ...Object.entries(folders).filter(([key]) => key.startsWith('folder:')).map(([key, value]) => [key, value === '1']),
  ])
}

const collapsedGroups = ref(loadCollapsedGroups())

function loadPinnedSectionExpansion(): boolean {
  return readPreferenceRecord(SECTION_EXPANSION_BASE, 'pinned') !== '0'
}

function onSidebarStorage(event: StorageEvent): void {
  if (event.key?.startsWith(`${projectCollapseBase}.`) || event.key?.startsWith(`${folderCollapseBase}.`)) {
    collapsedGroups.value = loadCollapsedGroups()
  }
  if (event.key === PINNED_EXPANSION_STORAGE_KEY) isPinnedSectionExpanded.value = loadPinnedSectionExpansion()
  if (event.key === CHAT_SORT_MODE_STORAGE_KEY) threads.chatSortMode.value = readUiPreference(CHAT_SORT_MODE_STORAGE_KEY) === 'created' ? 'created' : 'updated'
  if (event.key === THREAD_VIEW_MODE_STORAGE_KEY) threads.threadViewMode.value = threads.loadThreadViewMode()
}
onMounted(() => typeof window !== 'undefined' && window.addEventListener('storage', onSidebarStorage))
onUnmounted(() => typeof window !== 'undefined' && window.removeEventListener('storage', onSidebarStorage))

watch(threads.threadViewMode, (value) => {
  if (typeof window === 'undefined') return
  writeUiPreference(THREAD_VIEW_MODE_STORAGE_KEY, value)
})

watch([threads.pinnedThreadIds, threads.threadById, () => props.isLoading], () => {
  if (!threads.hasLoadedPinnedThreadState) return
  void threads.hydrateMissingPinnedThreads()
})

onUnmounted(threads.unsubscribeSections)
onMounted(threads.refreshPinnedThreadState)

function togglePinnedSection(): void {
  isPinnedSectionExpanded.value = !isPinnedSectionExpanded.value
  writeUiPreference(PINNED_EXPANSION_STORAGE_KEY, JSON.stringify(isPinnedSectionExpanded.value ? '1' : '0'))
}

const layoutProjectOrder = computed(() => threads.filteredGroups.value.map(group => group.key))

const layoutTopByProject = computed<Record<string, number>>(() => {
  const topByProject: Record<string, number> = {}
  let currentTop = 0

  for (const projectName of layoutProjectOrder.value) {
    topByProject[projectName] = currentTop
    currentTop += getProjectOuterHeight(projectName)
  }

  return topByProject
})

const groupsContainerStyle = computed<Record<string, string>>(() => {
  let totalHeight = 0
  for (const projectName of layoutProjectOrder.value) {
    totalHeight += getProjectOuterHeight(projectName)
  }

  return {
    height: `${Math.max(0, totalHeight)}px`,
  }
})

function formatRelative(timestamp: number): string {
  if (Number.isNaN(timestamp)) return 'n/a'

  const diffMs = Math.abs(Date.now() - timestamp)
  if (diffMs < 60000) return 'now'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatRelativeThread(thread: UiThread): string {
  const timestamp = threads.threadTimestampById.value.get(thread.id)
  if (typeof timestamp === 'number') {
    return formatRelative(timestamp)
  }
  return formatRelative(new Date(thread.updatedAtIso || thread.createdAtIso).getTime())
}

function isPinned(threadId: string): boolean {
  return threads.pinnedThreadIdSet.value.has(threadId)
}

function getProjectDisplayName(projectName: string): string {
  return props.projectDisplayNameById[projectName] ?? projectName
}

const ambiguousFolderNames = computed(() => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const group of threads.sidebarGroups.value) {
    if (group.kind !== 'folder') continue
    if (seen.has(group.name)) duplicates.add(group.name)
    seen.add(group.name)
  }
  return duplicates
})

function getGroupTitle(group: SidebarGroup): string {
  if (group.kind === 'project') return getProjectDisplayName(group.projectId)
  return ambiguousFolderNames.value.has(group.name) && group.cwd ? group.cwd : group.name
}

function getGroupTooltip(group: SidebarGroup): string {
  return group.kind === 'folder' ? group.cwd || group.name : getProjectDisplayName(group.projectId)
}

function getNewThreadButtonAriaLabel(group: SidebarGroup): string {
  return `start new thread ${getGroupTitle(group)}`
}

function isCollapsed(groupKey: string): boolean {
  return collapsedGroups.value[groupKey] === true
}

function toggleGroupCollapse(group: SidebarGroup): void {
  const collapsed = !isCollapsed(group.key)
  const base = group.kind === 'project' ? projectCollapseBase : folderCollapseBase
  const id = group.kind === 'project' ? group.projectId : group.key
  collapsedGroups.value = { ...collapsedGroups.value, [group.key]: collapsed }
  savePreferenceRecords(base, { [id]: collapsed ? '1' : '0' }, { [id]: collapsed ? '0' : '1' })
}

function getProjectOuterHeight(projectName: string): number {
  const measuredHeight = measuredHeightByProject.value[projectName] ?? 0
  const baseHeight = measuredHeight
  const gap = isCollapsed(projectName) ? 0 : PROJECT_GROUP_EXPANDED_GAP_PX
  return Math.max(0, baseHeight + gap)
}

function updateMeasuredProjectHeight(projectName: string, element: HTMLElement): void {
  const nextHeight = element.getBoundingClientRect().height
  if (!Number.isFinite(nextHeight) || nextHeight <= 0) return

  const previousHeight = measuredHeightByProject.value[projectName]
  if (previousHeight !== undefined && Math.abs(previousHeight - nextHeight) < 0.5) {
    return
  }

  measuredHeightByProject.value = {
    ...measuredHeightByProject.value,
    [projectName]: nextHeight,
  }
}

function setProjectGroupRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
  const previousElement = projectGroupElementByName.get(projectName)
  if (previousElement && previousElement !== element && projectGroupResizeObserver) {
    projectGroupResizeObserver.unobserve(previousElement)
  }

  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    projectGroupElementByName.set(projectName, htmlElement)
    projectNameByElement.set(htmlElement, projectName)
    updateMeasuredProjectHeight(projectName, htmlElement)
    projectGroupResizeObserver?.observe(htmlElement)
    return
  }

  if (previousElement) {
    projectGroupResizeObserver?.unobserve(previousElement)
  }

  projectGroupElementByName.delete(projectName)
}

function projectGroupStyle(projectName: string): Record<string, string> | undefined {
  const targetTop = layoutTopByProject.value[projectName] ?? 0
  const openThreadMenuProjectName = menus.openThreadMenuId.value
    ? (threads.threadGroupKeyById.value.get(menus.openThreadMenuId.value) ?? '')
    : ''
  const shouldElevateForMenu =
    menus.openProjectMenuId.value === projectName || openThreadMenuProjectName === projectName

  return {
      position: 'absolute',
      top: '0',
      left: '0',
      right: '0',
      zIndex: shouldElevateForMenu ? '40' : '1',
      transform: `translate3d(0, ${targetTop}px, 0)`,
      willChange: 'transform',
      transition: 'transform 180ms ease',
  }
}

watch(
  () => threads.sidebarGroups.value.map(group => group.key),
  (projectNames) => {

    const projectNameSet = new Set(projectNames)
    const nextMeasuredHeights = Object.fromEntries(
      Object.entries(measuredHeightByProject.value).filter(([projectName]) => projectNameSet.has(projectName)),
    ) as Record<string, number>

    if (Object.keys(nextMeasuredHeights).length !== Object.keys(measuredHeightByProject.value).length) {
      measuredHeightByProject.value = nextMeasuredHeights
    }
  },
)

watch(menus.hasOpenDismissableMenu, (isOpen) => {
  if (isOpen) {
    menus.bindProjectMenuDismissListeners()
    return
  }

  menus.unbindProjectMenuDismissListeners()
})

watch(menus.openThreadMenuId, (threadId) => {
  if (!threadId) {
    menus.unbindThreadMenuPositionListeners()
    return
  }

  menus.bindThreadMenuPositionListeners()
  nextTick(() => {
    menus.updateOpenThreadMenuPlacement(threadId)
  })
})

onBeforeUnmount(() => {
  for (const element of projectGroupElementByName.values()) {
    projectGroupResizeObserver?.unobserve(element)
  }
  projectGroupElementByName.clear()
  menus.projectMenuWrapElementByName.clear()
  menus.unbindThreadMenuPositionListeners()
  menus.unbindProjectMenuDismissListeners()
})
</script>

<style scoped>
@reference "tailwindcss";

.thread-tree-root {
  @apply flex flex-col;
}

.pinned-section {
  @apply order-1 mb-1;
}

.projects-section {
  @apply order-2;
}

.section-toggle-row {
  @apply hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400;
}

.thread-tree-header {
  @apply text-sm font-normal text-zinc-500 select-none;
}

.organize-menu-wrap {
  @apply relative;
}

.organize-menu-trigger {
  @apply h-5 w-5 rounded text-zinc-500 flex items-center justify-center transition hover:bg-zinc-200 hover:text-zinc-700;
}

.organize-menu-panel {
  @apply absolute right-0 top-full mt-1 z-30 min-w-44 rounded-xl border border-zinc-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm;
}

.organize-menu-title {
  @apply px-2 py-1 text-xs text-zinc-500;
}

.organize-menu-item {
  @apply w-full rounded-lg px-2 py-1.5 text-sm text-zinc-700 flex items-center justify-between hover:bg-zinc-100;
}

.organize-menu-item[data-active='true'] {
  @apply bg-zinc-100 text-zinc-900;
}

.thread-start-button {
  @apply h-5 w-5 rounded text-zinc-500 flex items-center justify-center transition hover:bg-zinc-200 hover:text-zinc-700 pointer-events-auto;
}

.thread-tree-loading {
  @apply px-3 py-2 text-sm text-zinc-500;
}

.thread-tree-no-results {
  @apply px-3 py-2 text-sm text-zinc-400;
}

.thread-tree-action-error {
  @apply mx-2 my-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700;
}

.thread-tree-groups {
  @apply pr-0.5 relative;
}

.project-group {
  @apply m-0 transition-shadow;
}

.project-header-row {
  @apply hover:bg-zinc-200;
  --sidebar-row-link-right-padding: 3.5rem;
}

.project-header-row[data-active='true'] {
  @apply bg-zinc-200;
}

.project-header-row[data-menu-open='true'] {
  @apply z-20;
}

.project-main-label {
  @apply min-w-0 flex items-center min-h-5;
}

.project-icon-stack {
  @apply relative w-4 h-4 flex items-center justify-center text-zinc-500;
}

.project-icon-folder {
  @apply absolute inset-0 flex items-center justify-center opacity-100;
}

.project-icon-chevron {
  @apply absolute inset-0 items-center justify-center opacity-0 hidden;
}

.project-title {
  @apply min-w-0 flex-1 text-sm font-normal text-zinc-700 truncate select-none;
}

.folder-title-disambiguated {
  white-space: normal;
  overflow-wrap: anywhere;
}

.project-menu-wrap {
  @apply relative;
}

.project-hover-controls {
  @apply flex items-center gap-1;
}

.project-menu-trigger {
  @apply h-4 w-4 rounded p-0 text-zinc-600 flex items-center justify-center pointer-events-auto;
}

.project-menu-panel {
  @apply absolute right-0 top-full mt-1 z-20 min-w-36 rounded-md border border-zinc-200 bg-white p-1 shadow-md flex flex-col gap-0.5 pointer-events-auto;
}

.project-menu-panel[data-open-direction='up'] {
  top: auto;
  bottom: calc(100% + 0.25rem);
  margin-top: 0;
}

.project-menu-item {
  @apply rounded px-2 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-100;
}

.project-menu-item-danger {
  @apply text-rose-700 hover:bg-rose-50;
}

.project-empty-row {
  @apply cursor-default;
}

.project-empty-spacer {
  @apply block w-4 h-4;
}

.project-empty {
  @apply text-sm text-zinc-400;
}

.thread-list {
  @apply list-none m-0 p-0 flex flex-col gap-0.5;
}

.thread-list-global {
  @apply pr-0.5;
}

.project-group > .thread-list {
  @apply mt-0.5;
}

.thread-row-item {
  @apply m-0;
}

.thread-row-item[data-menu-open='true'] {
  @apply relative z-40;
}

.thread-menu-panel {
  @apply absolute right-0 top-full mt-1 z-20 min-w-36 rounded-md border border-zinc-200 bg-white p-1 shadow-md flex flex-col gap-0.5;
}

.thread-menu-panel-fixed {
  @apply fixed top-0 right-auto bottom-auto left-0 mt-0 z-50;
}

.thread-menu-panel:not(.thread-menu-panel-fixed)[data-open-direction='up'] {
  top: auto;
  bottom: calc(100% + 0.25rem);
  margin-top: 0;
}

.thread-menu-item {
  @apply rounded px-2 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-100;
}

.thread-menu-item:disabled {
  @apply cursor-not-allowed text-zinc-400 hover:bg-transparent;
}

.thread-menu-item-danger {
  @apply text-rose-700 hover:bg-rose-50;
}

.thread-icon {
  @apply w-4 h-4;
}

.thread-show-more-row {
  @apply mt-1;
}

.thread-show-more-spacer {
  @apply block w-4 h-4;
}

.thread-show-more-button {
  @apply block mx-auto rounded-lg px-2 py-0.5 text-sm font-normal text-zinc-600 transition hover:text-zinc-800 hover:bg-zinc-200;
}

.project-header-row:hover .project-icon-folder {
  @apply opacity-0;
}

.project-header-row:hover .project-icon-chevron {
  @apply flex opacity-100;
}

.rename-thread-overlay {
  @apply fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4;
}

.rename-thread-panel {
  @apply w-full max-w-sm rounded-xl bg-white p-4 shadow-xl
         max-h-[90vh] flex flex-col overflow-hidden;
}

.rename-thread-title {
  @apply m-0 text-base font-semibold text-zinc-900 shrink-0;
}

.rename-thread-subtitle {
  @apply mt-1 mb-3 text-sm text-zinc-500 overflow-y-auto flex-1 min-h-0 min-w-0 break-words;
}

.rename-thread-input {
  @apply w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 shrink-0;
}

.rename-thread-actions {
  @apply mt-3 flex items-center justify-end gap-2 shrink-0;
}

.rename-thread-button {
  @apply rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100;
}

.rename-thread-button-primary {
  @apply bg-zinc-900 text-white hover:bg-black;
}

.rename-thread-button-danger {
  @apply bg-rose-600 text-white hover:bg-rose-700;
}

</style>
