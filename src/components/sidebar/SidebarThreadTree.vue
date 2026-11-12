<template>
  <section class="thread-tree-root" :class="{ 'chats-first': showChatsFirst }">
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
        <span class="thread-tree-header">{{ t('Pinned') }}</span>
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
            @leave="onThreadRowLeave(thread.id, $event)"
            @contextmenu="onThreadRowContextMenu($event, thread.id)"
            @delete="onInlineDeleteClick(thread.id)"
            @toggle-menu="toggleThreadMenu(thread.id)"
            @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
          />
        </li>
      </ul>
    </section>

    <section class="projects-section">
      <SidebarMenuRow
        as="button"
        class="thread-tree-header-row section-toggle-row"
        type="button"
        :aria-expanded="isProjectsSectionExpanded"
        @click="toggleProjectsSection"
      >
        <template #left>
          <IconTablerChevronRight v-if="!isProjectsSectionExpanded" class="thread-icon" />
          <IconTablerChevronDown v-else class="thread-icon" />
        </template>
        <span class="thread-tree-header">{{ t('Projects') }}</span>
        <template #right>
          <div ref="organizeMenuWrapRef" class="organize-menu-wrap">
            <button
              class="organize-menu-trigger"
              type="button"
              :aria-expanded="isOrganizeMenuOpen"
              :aria-label="t('Organize threads')"
              :title="t('Organize threads')"
              @click.stop="toggleOrganizeMenu"
            >
              <IconTablerDots class="thread-icon" />
            </button>

            <div v-if="isOrganizeMenuOpen" class="organize-menu-panel" @click.stop>
              <p class="organize-menu-title">{{ t('Organize') }}</p>
              <button
                class="organize-menu-item"
                :data-active="threadViewMode === 'project'"
                type="button"
                @click="setThreadViewMode('project')"
              >
                <span>{{ t('By project') }}</span>
                <span v-if="threadViewMode === 'project'">✓</span>
              </button>
              <button
                class="organize-menu-item"
                :data-active="threadViewMode === 'chronological'"
                type="button"
                @click="setThreadViewMode('chronological')"
              >
                <span>{{ t('Chronological list') }}</span>
                <span v-if="threadViewMode === 'chronological'">✓</span>
              </button>
              <button
                class="organize-menu-item"
                :data-active="showChatsFirst"
                type="button"
                @click="toggleShowChatsFirst"
              >
                <span>{{ t('Chats first') }}</span>
                <span v-if="showChatsFirst">✓</span>
              </button>
              <div class="organize-menu-separator" />
              <p class="organize-menu-title">{{ t('Sort by') }}</p>
              <button
                class="organize-menu-item"
                :data-active="chatSortMode === 'created'"
                type="button"
                @click="setChatSortMode('created')"
              >
                <span>{{ t('Created') }}</span>
                <span v-if="chatSortMode === 'created'">✓</span>
              </button>
              <button
                class="organize-menu-item"
                :data-active="chatSortMode === 'updated'"
                type="button"
                @click="setChatSortMode('updated')"
              >
                <span>{{ t('Updated') }}</span>
                <span v-if="chatSortMode === 'updated'">✓</span>
              </button>
            </div>
          </div>
        </template>
      </SidebarMenuRow>

      <template v-if="isProjectsSectionExpanded">

      <p v-if="isSearchActive && filteredGroups.length === 0" class="thread-tree-no-results">{{ t('No matching threads') }}</p>

      <p v-else-if="isLoading && groups.length === 0" class="thread-tree-loading">{{ t('Loading threads...') }}</p>

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
          @leave="onThreadRowLeave(thread.id, $event)"
          @contextmenu="onThreadRowContextMenu($event, thread.id)"
          @delete="onInlineDeleteClick(thread.id)"
          @toggle-menu="toggleThreadMenu(thread.id)"
          @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
        />
      </li>
    </ul>

    <div v-else ref="groupsContainerRef" class="thread-tree-groups" :style="groupsContainerStyle">
      <article
        v-for="group in filteredGroups"
        :key="group.projectName"
        :ref="(el) => setProjectGroupRef(group.projectName, el)"
        class="project-group"
        :data-project-name="group.projectName"
        :data-expanded="!isCollapsed(group.projectName)"
        :style="projectGroupStyle(group.projectName)"
      >
          <SidebarMenuRow
            as="div"
            class="project-header-row"
            :data-active="group.projectName === activeProjectName"
            role="button"
            tabindex="0"
            @click="toggleProjectCollapse(group.projectName)"
            @contextmenu.prevent="openProjectContextMenu(group.projectName)"
            @keydown.enter.prevent="toggleProjectCollapse(group.projectName)"
            @keydown.space.prevent="toggleProjectCollapse(group.projectName)"
          >
            <template #left>
              <span class="project-icon-stack">
                <span class="project-icon-folder">
                  <IconTablerFolder v-if="isCollapsed(group.projectName)" class="thread-icon" />
                  <IconTablerFolderOpen v-else class="thread-icon" />
                </span>
                <span class="project-icon-chevron">
                  <IconTablerChevronRight v-if="isCollapsed(group.projectName)" class="thread-icon" />
                  <IconTablerChevronDown v-else class="thread-icon" />
                </span>
              </span>
            </template>
            <span
              class="project-main-button"
            >
              <span class="project-title" :title="getProjectTooltipTitle(group.projectName)">
                {{ getProjectVisibleName(group) }}
              </span>
            </span>
            <template #right>
              <div class="project-hover-controls">
                <div :ref="(el) => setProjectMenuWrapRef(group.projectName, el)" class="project-menu-wrap">
                  <button
                    class="project-menu-trigger"
                    type="button"
                    title="project_menu"
                    @click.stop="toggleProjectMenu(group.projectName)"
                  >
                    <IconTablerDots class="thread-icon" />
                  </button>

                  <div
                    v-if="isProjectMenuOpen(group.projectName)"
                    class="project-menu-panel"
                    :data-open-direction="projectMenuDirectionById[group.projectName] ?? 'down'"
                    @click.stop
                  >
                    <template>
                      <button class="project-menu-item" type="button" @click="onBrowseProjectFiles(group.projectName)">
                        Browse files
                      </button>

                      <button
                        class="project-menu-item project-menu-item-danger"
                        type="button"
                        @click="onRemoveProject(group.projectName)"
                      >
                        Remove
                      </button>
                    </template>

                  </div>
                </div>

                <button
                  class="thread-start-button"
                  type="button"
                  :aria-label="getNewThreadButtonAriaLabel(group.projectName)"
                  :title="getNewThreadButtonAriaLabel(group.projectName)"
                  @click.stop="onStartNewThread(group.projectName)"
                >
                  <IconTablerFilePencil class="thread-icon" />
                </button>
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
                @leave="onThreadRowLeave(thread.id, $event)"
                @contextmenu="onThreadRowContextMenu($event, thread.id)"
                @delete="onInlineDeleteClick(thread.id)"
                @toggle-menu="toggleThreadMenu(thread.id)"
                @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
              />
            </li>
          </ul>

          <SidebarMenuRow v-else as="p" class="project-empty-row">
            <template #left>
              <span class="project-empty-spacer" />
            </template>
            <span class="project-empty">{{ isSearchActive ? t('No matching threads') : t('No threads') }}</span>
          </SidebarMenuRow>

          <SidebarMenuRow v-if="hasHiddenThreads(group)" class="thread-show-more-row">
            <template #left>
              <span class="thread-show-more-spacer" />
            </template>
            <button class="thread-show-more-button" type="button" @click="toggleProjectExpansion(group.projectName)">
              {{ isExpanded(group.projectName) ? 'Show less' : 'Show more' }}
            </button>
          </SidebarMenuRow>
      </article>
    </div>
      </template>
    </section>

    <section class="chats-section">
      <SidebarMenuRow
        as="button"
        class="section-toggle-row"
        type="button"
        :aria-expanded="isChatsSectionExpanded"
        @click="toggleChatsSection"
      >
        <template #left>
          <IconTablerChevronRight v-if="!isChatsSectionExpanded" class="thread-icon" />
          <IconTablerChevronDown v-else class="thread-icon" />
        </template>
        <span class="thread-tree-header">{{ t('Chats') }}</span>
        <template #right>
          <div class="chats-section-actions">
            <button
              class="chats-section-action"
              type="button"
              :aria-label="t('New chat')"
              :title="t('New chat')"
              @click.stop="$emit('start-new-chat')"
            >
              <IconTablerFilePencil class="thread-icon" />
            </button>
          </div>
        </template>
      </SidebarMenuRow>

      <p v-if="isChatsSectionExpanded && chatThreads.length === 0" class="thread-tree-no-results">{{ t('No chats') }}</p>
      <ul v-else-if="isChatsSectionExpanded" class="thread-list thread-list-global">
        <li
          v-for="thread in visibleChatThreads"
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
            @leave="onThreadRowLeave(thread.id, $event)"
            @contextmenu="onThreadRowContextMenu($event, thread.id)"
            @delete="onInlineDeleteClick(thread.id)"
            @toggle-menu="toggleThreadMenu(thread.id)"
            @menu-anchor="setThreadMenuWrapRef(thread.id, $event)"
          />
        </li>
      </ul>

      <SidebarMenuRow v-if="isChatsSectionExpanded && hasHiddenChatThreads" class="thread-show-more-row">
        <template #left>
          <span class="thread-show-more-spacer" />
        </template>
        <button class="thread-show-more-button" type="button" @click="toggleChatsListExpansion">
          {{ isChatsListExpanded ? 'Show less' : 'Show more' }}
        </button>
      </SidebarMenuRow>
    </section>

    <Teleport to="body">
      <div
        v-if="openThreadMenuThread"
        ref="openThreadMenuPanelRef"
        class="thread-menu-panel thread-menu-panel-fixed"
        :style="openThreadMenuStyle"
        :data-open-direction="getThreadMenuDirection(openThreadMenuThread.id)"
        @click.stop
      >
        <button class="thread-menu-item" type="button" @click="onOpenThreadInNewTab(openThreadMenuThread.id)">
          Open in new tab
        </button>
        <button class="thread-menu-item" type="button" @click="onBrowseThreadFiles(openThreadMenuThread.id)">
          Browse files
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
        <button class="thread-menu-item" type="button" @click="onForkThread(openThreadMenuThread.id)">
          Create chat fork
        </button>
        <button class="thread-menu-item" type="button" @click="onTogglePinFromMenu(openThreadMenuThread.id)">
          {{ isPinned(openThreadMenuThread.id) ? 'Unpin thread' : 'Pin thread' }}
        </button>
        <button class="thread-menu-item" type="button" @click="openRenameThreadDialog(openThreadMenuThread.id, openThreadMenuThread.title)">
          {{ t('Rename thread') }}
        </button>
        <button class="thread-menu-item thread-menu-item-danger" type="button" @click="openDeleteThreadDialog(openThreadMenuThread.id, openThreadMenuThread.title)">
          {{ t('Delete thread') }}
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="renameThreadDialogVisible" class="rename-thread-overlay" @click.self="closeRenameThreadDialog">
        <div class="rename-thread-panel" role="dialog" aria-modal="true" aria-label="Thread title">
          <h3 class="rename-thread-title">{{ t('Rename thread') }}</h3>
          <p class="rename-thread-subtitle">Make it short and recognizable.</p>
          <input
            ref="renameThreadInputRef"
            v-model="renameThreadDraft"
            class="rename-thread-input"
            type="text"
            placeholder="Add title..."
            @keydown.enter.prevent="submitRenameThread"
            @keydown.esc.prevent="closeRenameThreadDialog"
          />
          <div class="rename-thread-actions">
            <button class="rename-thread-button" type="button" @click="closeRenameThreadDialog">{{ t('Cancel') }}</button>
            <button class="rename-thread-button rename-thread-button-primary" type="button" @click="submitRenameThread">{{ t('Save') }}</button>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import {
  getPinnedThreadState,
  getThreadSummary,
  persistPinnedThreadIds,
} from '../../api/codexGateway'
import type { UiProjectGroup, UiThread } from '../../types/codex'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerFolderOpen from '../icons/IconTablerFolderOpen.vue'
import IconTablerTrash from '../icons/IconTablerTrash.vue'
import { useUiLanguage } from '../../composables/useUiLanguage'
import { getPathLeafName, getPathParent, isProjectlessChatPath } from '../../pathUtils.js'
import SidebarMenuRow from './SidebarMenuRow.vue'
import SidebarThreadRow from './SidebarThreadRow.vue'
import { reconcilePinnedThreadIds } from './pinnedThreadUtils'

const router = useRouter()

const props = defineProps<{
  groups: UiProjectGroup[]
  projectDisplayNameById: Record<string, string>
  projectGitRepoByName: Record<string, boolean>
  selectedThreadId: string
  activeProjectName: string | null
  isLoading: boolean
  isThreadListFullyLoaded: boolean
  searchQuery: string
  searchMatchedThreadIds: string[] | null
}>()

const { t } = useUiLanguage()

const emit = defineEmits<{
  select: [threadId: string]
  archive: [threadId: string]
  'start-new-thread': [projectName: string]
  'browse-thread-files': [threadId: string]
  'browse-project-files': [projectName: string]
  'request-project-git-status': [projectName: string]
  'rename-thread': [payload: { threadId: string; title: string }]
  'remove-project': [projectName: string]
  'copy-thread-chat': [threadId: string]
  'fork-thread': [threadId: string]
  'start-new-chat': []
}>()

type MenuDirection = 'up' | 'down'
type ChatSortMode = 'created' | 'updated'
const PROJECT_GROUP_EXPANDED_GAP_PX = 6
const SECTION_EXPANSION_STORAGE_KEY = 'codex-web-local.sidebar-section-expansion.v1'
const CHATS_FIRST_STORAGE_KEY = 'codex-web-local.sidebar-chats-first.v1'
const CHAT_SORT_MODE_STORAGE_KEY = 'codex-web-local.sidebar-chat-sort-mode.v1'
const expandedProjects = ref<Record<string, boolean>>({})
const collapsedProjects = ref<Record<string, boolean>>({})
const isPinnedSectionExpanded = ref(true)
const isProjectsSectionExpanded = ref(true)
const isChatsSectionExpanded = ref(true)
const isChatsListExpanded = ref(false)
const showChatsFirst = ref(loadBooleanStorage(CHATS_FIRST_STORAGE_KEY, false))
const chatSortMode = ref<ChatSortMode>(loadChatSortMode())
let hasLoadedPinnedThreadState = false
const pinnedThreadIds = ref<string[]>([])
const hydratedPinnedThreadById = ref<Record<string, UiThread>>({})
const inlineDeleteConfirmThreadId = ref('')
const optimisticallyArchivedThreadIds = ref<string[]>([])
const openProjectMenuId = ref('')
const openThreadMenuId = ref('')
const projectMenuDirectionById = ref<Record<string, MenuDirection>>({})
const threadMenuDirectionById = ref<Record<string, MenuDirection>>({})
const openThreadMenuStyle = ref<Record<string, string>>({})
const renameThreadDialogVisible = ref(false)
const renameThreadDialogThreadId = ref('')
const renameThreadDraft = ref('')
const renameThreadInputRef = ref<HTMLInputElement | null>(null)
const deleteThreadDialogVisible = ref(false)
const deleteThreadDialogThreadId = ref('')
const deleteThreadTitle = ref('')
const groupsContainerRef = ref<HTMLElement | null>(null)
const measuredHeightByProject = ref<Record<string, number>>({})
const projectGroupElementByName = new Map<string, HTMLElement>()
const projectMenuWrapElementByName = new Map<string, HTMLElement>()
const threadMenuWrapElementById = new Map<string, HTMLElement>()
const projectNameByElement = new WeakMap<HTMLElement, string>()
const organizeMenuWrapRef = ref<HTMLElement | null>(null)
const openThreadMenuPanelRef = ref<HTMLElement | null>(null)
const isOrganizeMenuOpen = ref(false)
const THREAD_VIEW_MODE_STORAGE_KEY = 'codex-web-local.thread-view-mode.v1'
const threadViewMode = ref<'project' | 'chronological'>(loadThreadViewMode())
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
const COLLAPSED_STORAGE_KEY = 'codex-web-local.collapsed-projects.v1'

function loadCollapsedState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function loadThreadViewMode(): 'project' | 'chronological' {
  if (typeof window === 'undefined') return 'project'

  const raw = window.localStorage.getItem(THREAD_VIEW_MODE_STORAGE_KEY)
  return raw === 'chronological' ? 'chronological' : 'project'
}

function loadBooleanStorage(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

function loadChatSortMode(): ChatSortMode {
  if (typeof window === 'undefined') return 'updated'
  return window.localStorage.getItem(CHAT_SORT_MODE_STORAGE_KEY) === 'created' ? 'created' : 'updated'
}

collapsedProjects.value = loadCollapsedState()

function loadSectionExpansionState(): void {
  if (typeof window === 'undefined') return

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SECTION_EXPANSION_STORAGE_KEY) || '{}') as {
      pinned?: unknown
      projects?: unknown
      chats?: unknown
    }
    if (typeof parsed.pinned === 'boolean') isPinnedSectionExpanded.value = parsed.pinned
    if (typeof parsed.projects === 'boolean') isProjectsSectionExpanded.value = parsed.projects
    if (typeof parsed.chats === 'boolean') isChatsSectionExpanded.value = parsed.chats
  } catch {
    // Keep default expanded state when saved state is invalid.
  }
}

function persistSectionExpansionState(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    SECTION_EXPANSION_STORAGE_KEY,
    JSON.stringify({
      pinned: isPinnedSectionExpanded.value,
      projects: isProjectsSectionExpanded.value,
      chats: isChatsSectionExpanded.value,
    }),
  )
}

loadSectionExpansionState()

watch(
  collapsedProjects,
  (value) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(value))
  },
  { deep: true },
)

watch(threadViewMode, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THREAD_VIEW_MODE_STORAGE_KEY, value)
})

watch(showChatsFirst, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CHATS_FIRST_STORAGE_KEY, String(value))
})

watch(chatSortMode, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CHAT_SORT_MODE_STORAGE_KEY, value)
})

watch([isPinnedSectionExpanded, isProjectsSectionExpanded, isChatsSectionExpanded], persistSectionExpansionState)

const normalizedSearchQuery = computed(() => props.searchQuery.trim().toLowerCase())

const isSearchActive = computed(() => normalizedSearchQuery.value.length > 0)
const matchedThreadIdSet = computed(() => {
  if (!props.searchMatchedThreadIds) return null
  return new Set(props.searchMatchedThreadIds)
})
const pinnedThreadIdSet = computed(() => new Set(pinnedThreadIds.value))
const optimisticallyArchivedThreadIdSet = computed(() => new Set(optimisticallyArchivedThreadIds.value))

function threadMatchesSearch(thread: UiThread): boolean {
  if (optimisticallyArchivedThreadIdSet.value.has(thread.id)) return false
  if (!isSearchActive.value) return true
  if (matchedThreadIdSet.value?.has(thread.id)) {
    return true
  }
  const q = normalizedSearchQuery.value
  return thread.title.toLowerCase().includes(q) || thread.preview.toLowerCase().includes(q)
}

const filteredGroups = computed<UiProjectGroup[]>(() => {
  return props.groups.flatMap((group) => {
    const threads = group.threads.filter((thread) => !isProjectlessChatPath(thread.cwd) && threadMatchesSearch(thread))
    if (threads.length > 0) return [{ ...group, threads }]
    if (isSearchActive.value && group.projectName === props.activeProjectName) {
      return [{ ...group, threads }]
    }
    return !isSearchActive.value && group.threads.length === 0 ? [{ ...group, threads }] : []
  })
})

const isChronologicalView = computed(() => threadViewMode.value === 'chronological')

const globalThreads = computed<UiThread[]>(() => {
  const rows: UiThread[] = []

  for (const group of props.groups) {
    for (const thread of group.threads) {
      if (pinnedThreadIdSet.value.has(thread.id)) continue
      if (!threadMatchesSearch(thread)) continue
      rows.push(thread)
    }
  }

  return rows.sort((first, second) => {
    const firstTimestamp = new Date(first.updatedAtIso || first.createdAtIso).getTime()
    const secondTimestamp = new Date(second.updatedAtIso || second.createdAtIso).getTime()
    return secondTimestamp - firstTimestamp
  })
})

const chatThreads = computed(() => {
  const rows = globalThreads.value.filter((thread) => isProjectlessChatPath(thread.cwd))
  const timestampKey = chatSortMode.value === 'created' ? 'createdAtIso' : 'updatedAtIso'
  return rows
    .sort((first, second) => {
      const firstTimestamp = new Date(first[timestampKey] || first.updatedAtIso || first.createdAtIso).getTime()
      const secondTimestamp = new Date(second[timestampKey] || second.updatedAtIso || second.createdAtIso).getTime()
      return secondTimestamp - firstTimestamp
    })
})

const visibleChatThreads = computed(() => {
  if (isSearchActive.value) return chatThreads.value
  return isChatsListExpanded.value ? chatThreads.value : chatThreads.value.slice(0, 10)
})

const hasHiddenChatThreads = computed(() => {
  if (isSearchActive.value) return false
  return chatThreads.value.length > 10
})

const threadById = computed(() => {
  const map = new Map<string, UiThread>()

  for (const group of props.groups) {
    for (const thread of group.threads) {
      if (optimisticallyArchivedThreadIdSet.value.has(thread.id)) continue
      map.set(thread.id, thread)
    }
  }

  return map
})

watch(
  pinnedThreadIds,
  (threadIds) => {
    if (!hasLoadedPinnedThreadState) return
    void persistPinnedThreadIds(threadIds)
  },
)

watch([threadById, () => props.isThreadListFullyLoaded], ([threadsById]) => {
  const filtered = reconcilePinnedThreadIds(pinnedThreadIds.value, new Set(threadsById.keys()), {
    canPruneMissing: props.isThreadListFullyLoaded,
  })
  if (filtered.length === pinnedThreadIds.value.length) return
  const filteredIdSet = new Set(filtered)
  const nextHydratedPinnedThreads = Object.fromEntries(
    Object.entries(hydratedPinnedThreadById.value).filter(([threadId]) => filteredIdSet.has(threadId)),
  )
  hydratedPinnedThreadById.value = nextHydratedPinnedThreads
  pinnedThreadIds.value = filtered
})

let pinnedThreadHydrationVersion = 0

async function hydrateMissingPinnedThreads(): Promise<void> {
  if (props.isLoading) return
  const missingThreadIds = pinnedThreadIds.value.filter((threadId) => !threadById.value.has(threadId) && !hydratedPinnedThreadById.value[threadId])
  if (missingThreadIds.length === 0) return

  const version = (pinnedThreadHydrationVersion += 1)
  const loadedThreads = await Promise.all(
    missingThreadIds.map(async (threadId) => {
      try {
        return await getThreadSummary(threadId)
      } catch {
        return null
      }
    }),
  )
  if (version !== pinnedThreadHydrationVersion) return

  const next = { ...hydratedPinnedThreadById.value }
  for (const thread of loadedThreads) {
    if (thread) next[thread.id] = thread
  }
  hydratedPinnedThreadById.value = next
}

watch([pinnedThreadIds, threadById, () => props.isLoading], () => {
  if (!hasLoadedPinnedThreadState) return
  void hydrateMissingPinnedThreads()
})

onMounted(async () => {
  const { threadIds } = await getPinnedThreadState()
  const normalized = Array.isArray(threadIds)
    ? threadIds
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item, index, rows) => item.length > 0 && rows.indexOf(item) === index)
    : []

  if (normalized.length > 0) {
    pinnedThreadIds.value = normalized
  }
  hasLoadedPinnedThreadState = true
  void hydrateMissingPinnedThreads()
})

const threadProjectNameById = computed(() => {
  const map = new Map<string, string>()
  for (const group of props.groups) {
    for (const thread of group.threads) {
      map.set(thread.id, group.projectName)
    }
  }
  return map
})
const unpinnedThreadsByProjectName = computed(() => {
  const map = new Map<string, UiThread[]>()
  for (const group of filteredGroups.value) {
    const rows = group.threads.filter((thread) => !pinnedThreadIdSet.value.has(thread.id) && !optimisticallyArchivedThreadIdSet.value.has(thread.id))
    map.set(group.projectName, rows)
  }
  return map
})
const threadTimestampById = computed(() => {
  const map = new Map<string, number>()
  for (const group of props.groups) {
    for (const thread of group.threads) {
      const timestamp = new Date(thread.updatedAtIso || thread.createdAtIso).getTime()
      map.set(thread.id, timestamp)
    }
  }
  return map
})

const openThreadMenuThread = computed(() => {
  const threadId = openThreadMenuId.value
  return threadId ? (threadById.value.get(threadId) ?? null) : null
})

const pinnedThreads = computed(() =>
  pinnedThreadIds.value
    .map((threadId) => threadById.value.get(threadId) ?? hydratedPinnedThreadById.value[threadId] ?? null)
    .filter((thread): thread is UiThread => thread !== null)
    .filter(threadMatchesSearch),
)

function togglePinnedSection(): void {
  isPinnedSectionExpanded.value = !isPinnedSectionExpanded.value
}

function toggleProjectsSection(): void {
  isProjectsSectionExpanded.value = !isProjectsSectionExpanded.value
}

function toggleChatsSection(): void {
  isChatsSectionExpanded.value = !isChatsSectionExpanded.value
}

const layoutProjectOrder = computed(() => (isSearchActive.value ? filteredGroups.value : props.groups).map(group => group.projectName))

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
  const timestamp = threadTimestampById.value.get(thread.id)
  if (typeof timestamp === 'number') {
    return formatRelative(timestamp)
  }
  return formatRelative(new Date(thread.updatedAtIso || thread.createdAtIso).getTime())
}

function isPinned(threadId: string): boolean {
  return pinnedThreadIdSet.value.has(threadId)
}

function togglePin(threadId: string): void {
  if (isPinned(threadId)) {
    pinnedThreadIds.value = pinnedThreadIds.value.filter((id) => id !== threadId)
    return
  }

  pinnedThreadIds.value = [threadId, ...pinnedThreadIds.value]
}

function onTogglePinFromMenu(threadId: string): void {
  togglePin(threadId)
  closeThreadMenu()
}

function onSelect(threadId: string): void {
  inlineDeleteConfirmThreadId.value = ''
  emit('select', threadId)
}

function onCopyThreadChat(threadId: string): void {
  if (threadId !== props.selectedThreadId) return
  emit('copy-thread-chat', threadId)
  closeThreadMenu()
}

function onForkThread(threadId: string): void {
  emit('fork-thread', threadId)
  closeThreadMenu()
}

function getNewThreadButtonAriaLabel(projectName: string): string {
  return `start new thread ${getProjectDisplayName(projectName)}`
}

function onStartNewThread(projectName: string): void {
  emit('start-new-thread', projectName)
}

function onBrowseThreadFiles(threadId: string): void {
  emit('browse-thread-files', threadId)
  closeThreadMenu()
}

async function onCopyThreadPath(threadId: string): Promise<void> {
  const path = threadById.value.get(threadId)?.cwd?.trim() ?? ''
  closeThreadMenu()
  if (!path || typeof navigator === 'undefined' || !navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(path)
  } catch {
    // Clipboard writes can be blocked by browser permissions; the menu action is best-effort.
  }
}

function onThreadRowLeave(threadId: string, event?: MouseEvent): void {
  if (openThreadMenuId.value !== threadId) return
  if (event) {
    const relatedTarget = event.relatedTarget
    const panelElement = openThreadMenuPanelRef.value
    if (relatedTarget instanceof Node && panelElement && panelElement.contains(relatedTarget)) return
  }
  closeThreadMenu()
}

function isThreadMenuOpen(threadId: string): boolean {
  return openThreadMenuId.value === threadId
}

function closeThreadMenu(): void {
  openThreadMenuId.value = ''
  openThreadMenuStyle.value = {}
}

function toggleThreadMenu(threadId: string): void {
  inlineDeleteConfirmThreadId.value = ''
  if (openThreadMenuId.value === threadId) {
    closeThreadMenu()
    return
  }

  closeProjectMenu()
  isOrganizeMenuOpen.value = false
  openThreadMenuId.value = threadId
  nextTick(() => {
    updateOpenThreadMenuPlacement(threadId)
  })
}

function onThreadRowContextMenu(event: MouseEvent, threadId: string): void {
  event.preventDefault()
  inlineDeleteConfirmThreadId.value = ''
  openThreadMenuId.value = threadId
}

function onOpenThreadInNewTab(threadId: string): void {
  const { href } = router.resolve({ name: 'thread', params: { threadId } })
  window.open(href, '_blank', 'noopener,noreferrer')
  closeThreadMenu()
}

function openRenameThreadDialog(threadId: string, currentTitle: string): void {
  renameThreadDialogThreadId.value = threadId
  renameThreadDraft.value = currentTitle
  renameThreadDialogVisible.value = true
  closeThreadMenu()
  nextTick(() => {
    renameThreadInputRef.value?.focus()
    renameThreadInputRef.value?.select()
  })
}

function closeRenameThreadDialog(): void {
  renameThreadDialogVisible.value = false
  renameThreadDialogThreadId.value = ''
  renameThreadDraft.value = ''
}

function submitRenameThread(): void {
  const threadId = renameThreadDialogThreadId.value
  const title = renameThreadDraft.value.trim()
  if (!threadId || !title) return
  emit('rename-thread', { threadId, title })
  closeRenameThreadDialog()
}

function openDeleteThreadDialog(threadId: string, currentTitle: string): void {
  inlineDeleteConfirmThreadId.value = ''
  deleteThreadDialogThreadId.value = threadId
  deleteThreadTitle.value = currentTitle
  deleteThreadDialogVisible.value = true
  closeThreadMenu()
}

function closeDeleteThreadDialog(): void {
  deleteThreadDialogVisible.value = false
  deleteThreadDialogThreadId.value = ''
  deleteThreadTitle.value = ''
}

async function submitDeleteThread(): Promise<void> {
  const threadId = deleteThreadDialogThreadId.value
  if (!threadId) return
  deleteThreadById(threadId)
  closeDeleteThreadDialog()
}

function isInlineDeleteConfirming(threadId: string): boolean {
  return inlineDeleteConfirmThreadId.value === threadId
}

function onInlineDeleteClick(threadId: string): void {
  if (inlineDeleteConfirmThreadId.value !== threadId) {
    inlineDeleteConfirmThreadId.value = threadId
    closeThreadMenu()
    return
  }

  deleteThreadById(threadId)
  inlineDeleteConfirmThreadId.value = ''
}

function deleteThreadById(threadId: string): void {
  if (!optimisticallyArchivedThreadIdSet.value.has(threadId)) {
    optimisticallyArchivedThreadIds.value = [threadId, ...optimisticallyArchivedThreadIds.value]
  }
  inlineDeleteConfirmThreadId.value = ''
  closeThreadMenu()
  pinnedThreadIds.value = pinnedThreadIds.value.filter((id) => id !== threadId)
  emit('archive', threadId)
}

function getProjectDisplayName(projectName: string): string {
  return props.projectDisplayNameById[projectName] ?? projectName
}

function isPathLikeProjectName(value: string): boolean {
  return value.includes('/') || value.includes('\\')
}

function getProjectTooltipTitle(projectName: string): string {
  return isPathLikeProjectName(projectName) ? projectName : getProjectDisplayName(projectName)
}

function isDuplicatePathLeafName(value: string): boolean {
  const leafName = getPathLeafName(value)
  if (!leafName) return false
  let matchingCount = 0
  for (const group of props.groups) {
    if (!isPathLikeProjectName(group.projectName)) continue
    if (getPathLeafName(group.projectName) !== leafName) continue
    matchingCount += 1
    if (matchingCount > 1) return true
  }
  return false
}

function getProjectVisibleName(group: UiProjectGroup): string {
  const customDisplayName = props.projectDisplayNameById[group.projectName]
  const displayName = getProjectDisplayName(group.projectName)
  const projectName = group.projectName
  if (customDisplayName && !isPathLikeProjectName(projectName) && projectName !== displayName) {
    if (displayName.includes(projectName) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(projectName)) return displayName
    return `${displayName} ${projectName}`
  }
  if (customDisplayName && isPathLikeProjectName(projectName)) {
    const leafName = getPathLeafName(projectName)
    const parentLeafName = getPathLeafName(getPathParent(projectName))
    const contextName = isDuplicatePathLeafName(projectName) ? parentLeafName : leafName
    return contextName && contextName !== displayName ? `${displayName} ${contextName}` : displayName
  }
  if (!displayName.includes('/') && !displayName.includes('\\')) return displayName
  const leafName = getPathLeafName(displayName) || displayName
  const parentLeafName = getPathLeafName(getPathParent(displayName))
  if (parentLeafName.startsWith('.') && parentLeafName !== leafName) return `${leafName} ${parentLeafName}`
  if (group.threads.length > 0 || !isDuplicatePathLeafName(projectName)) return leafName
  return parentLeafName ? `${leafName} ${parentLeafName}` : leafName
}

function isProjectMenuOpen(projectName: string): boolean {
  return openProjectMenuId.value === projectName
}

function closeProjectMenu(): void {
  openProjectMenuId.value = ''
}

function toggleOrganizeMenu(): void {
  const nextValue = !isOrganizeMenuOpen.value
  if (nextValue) {
    closeProjectMenu()
    closeThreadMenu()
  }
  isOrganizeMenuOpen.value = nextValue
}

function setThreadViewMode(mode: 'project' | 'chronological'): void {
  threadViewMode.value = mode
  isOrganizeMenuOpen.value = false
}

function toggleShowChatsFirst(): void {
  showChatsFirst.value = !showChatsFirst.value
}

function setChatSortMode(mode: ChatSortMode): void {
  chatSortMode.value = mode
}

function requestProjectGitStatusAndUpdateMenuDirection(projectName: string): void {
  emit('request-project-git-status', projectName)
  nextTick(() => {
    updateProjectMenuDirection(projectName)
  })
}

function toggleProjectMenu(projectName: string): void {
  if (openProjectMenuId.value === projectName) {
    closeProjectMenu()
    return
  }

  closeThreadMenu()
  isOrganizeMenuOpen.value = false
  openProjectMenuId.value = projectName
  requestProjectGitStatusAndUpdateMenuDirection(projectName)
}

function openProjectContextMenu(projectName: string): void {
  closeThreadMenu()
  isOrganizeMenuOpen.value = false
  openProjectMenuId.value = projectName
  requestProjectGitStatusAndUpdateMenuDirection(projectName)
}

function onBrowseProjectFiles(projectName: string): void {
  emit('browse-project-files', projectName)
  closeProjectMenu()
}

function onRemoveProject(projectName: string): void {
  emit('remove-project', projectName)
  closeProjectMenu()
}

function isExpanded(projectName: string): boolean {
  return expandedProjects.value[projectName] === true
}

function isCollapsed(projectName: string): boolean {
  return collapsedProjects.value[projectName] === true
}

function toggleProjectExpansion(projectName: string): void {
  expandedProjects.value = {
    ...expandedProjects.value,
    [projectName]: !isExpanded(projectName),
  }
}

function toggleChatsListExpansion(): void {
  isChatsListExpanded.value = !isChatsListExpanded.value
}

function toggleProjectCollapse(projectName: string): void {

  collapsedProjects.value = {
    ...collapsedProjects.value,
    [projectName]: !isCollapsed(projectName),
  }
}

function getProjectOuterHeight(projectName: string): number {
  const measuredHeight = measuredHeightByProject.value[projectName] ?? 0
  const baseHeight = measuredHeight
  const gap = isCollapsed(projectName) ? 0 : PROJECT_GROUP_EXPANDED_GAP_PX
  return Math.max(0, baseHeight + gap)
}

function setProjectMenuWrapRef(projectName: string, element: Element | ComponentPublicInstance | null): void {
  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    projectMenuWrapElementByName.set(projectName, htmlElement)
    return
  }

  projectMenuWrapElementByName.delete(projectName)
}

function setThreadMenuWrapRef(threadId: string, element: Element | ComponentPublicInstance | null): void {
  const htmlElement =
    element instanceof HTMLElement
      ? element
      : element && '$el' in element && element.$el instanceof HTMLElement
        ? element.$el
        : null

  if (htmlElement) {
    threadMenuWrapElementById.set(threadId, htmlElement)
    return
  }

  threadMenuWrapElementById.delete(threadId)
}

function findMenuBoundaryRect(element: HTMLElement): DOMRect {
  let parent: HTMLElement | null = element.parentElement
  while (parent) {
    const styles = window.getComputedStyle(parent)
    const overflowY = styles.overflowY || styles.overflow
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'clip') {
      return parent.getBoundingClientRect()
    }
    parent = parent.parentElement
  }

  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

function resolveMenuDirection(menuWrapElement: HTMLElement, panelHeight: number): MenuDirection {
  const wrapRect = menuWrapElement.getBoundingClientRect()
  const boundaryRect = findMenuBoundaryRect(menuWrapElement)
  const panelGap = 6
  const spaceBelow = boundaryRect.bottom - wrapRect.bottom
  const spaceAbove = wrapRect.top - boundaryRect.top

  if (spaceBelow >= panelHeight + panelGap) return 'down'
  if (spaceAbove > spaceBelow) return 'up'
  return 'down'
}

function updateThreadMenuDirection(threadId: string, panelHeight: number): MenuDirection {
  const menuWrapElement = threadMenuWrapElementById.get(threadId)
  if (!menuWrapElement) return 'down'

  const direction = resolveMenuDirection(menuWrapElement, panelHeight)

  threadMenuDirectionById.value = {
    ...threadMenuDirectionById.value,
    [threadId]: direction,
  }
  return direction
}

function getThreadMenuDirection(threadId: string): MenuDirection {
  return threadMenuDirectionById.value[threadId] ?? 'down'
}

function updateProjectMenuDirection(projectName: string): void {
  const menuWrapElement = projectMenuWrapElementByName.get(projectName)
  if (!menuWrapElement) return
  const menuPanelElement = menuWrapElement.querySelector<HTMLElement>('.project-menu-panel')
  const panelHeight = menuPanelElement?.getBoundingClientRect().height ?? 0

  projectMenuDirectionById.value = {
    ...projectMenuDirectionById.value,
    [projectName]: resolveMenuDirection(menuWrapElement, panelHeight),
  }
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

function updateOpenThreadMenuPlacement(threadId: string): void {
  const menuWrapElement = threadMenuWrapElementById.get(threadId)
  if (!menuWrapElement) return

  const panelElement = openThreadMenuPanelRef.value
  const panelRect = panelElement?.getBoundingClientRect()
  const panelHeight = panelRect?.height || panelElement?.offsetHeight || 112
  const panelWidth = panelRect?.width || panelElement?.offsetWidth || 160
  const direction = updateThreadMenuDirection(threadId, panelHeight)
  const wrapRect = menuWrapElement.getBoundingClientRect()
  const viewportGap = 8
  const offset = 4
  const maxLeft = Math.max(viewportGap, window.innerWidth - panelWidth - viewportGap)
  const left = clamp(wrapRect.right - panelWidth, viewportGap, maxLeft)
  const top =
    direction === 'up'
      ? clamp(wrapRect.top - panelHeight - offset, viewportGap, Math.max(viewportGap, window.innerHeight - panelHeight - viewportGap))
      : clamp(wrapRect.bottom + offset, viewportGap, Math.max(viewportGap, window.innerHeight - panelHeight - viewportGap))

  openThreadMenuStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  }
}

function onThreadMenuViewportChange(): void {
  const threadId = openThreadMenuId.value
  if (!threadId) return
  updateOpenThreadMenuPlacement(threadId)
}

function bindThreadMenuPositionListeners(): void {
  window.addEventListener('resize', onThreadMenuViewportChange)
  document.addEventListener('scroll', onThreadMenuViewportChange, true)
}

function unbindThreadMenuPositionListeners(): void {
  window.removeEventListener('resize', onThreadMenuViewportChange)
  document.removeEventListener('scroll', onThreadMenuViewportChange, true)
}

function isEventInsideOpenProjectMenu(event: Event): boolean {
  const projectName = openProjectMenuId.value
  if (!projectName) return false

  const openMenuWrapElement = projectMenuWrapElementByName.get(projectName)
  if (!openMenuWrapElement) return false

  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (eventPath.includes(openMenuWrapElement)) return true

  const target = event.target
  return target instanceof Node ? openMenuWrapElement.contains(target) : false
}

function isEventInsideOpenThreadMenu(event: Event): boolean {
  const threadId = openThreadMenuId.value
  if (!threadId) return false

  const openMenuWrapElement = threadMenuWrapElementById.get(threadId)
  if (!openMenuWrapElement) return false

  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (eventPath.includes(openMenuWrapElement)) return true

  const panelElement = openThreadMenuPanelRef.value
  if (panelElement && eventPath.includes(panelElement)) return true

  const target = event.target
  if (!(target instanceof Node)) return false
  if (openMenuWrapElement.contains(target)) return true
  if (panelElement && panelElement.contains(target)) return true
  return false
}

function onProjectMenuPointerDown(event: PointerEvent): void {
  if (isOrganizeMenuOpen.value) {
    const organizeElement = organizeMenuWrapRef.value
    const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
    const isInsideOrganizeMenu =
      !!organizeElement &&
      (eventPath.includes(organizeElement) || (event.target instanceof Node && organizeElement.contains(event.target)))

    if (!isInsideOrganizeMenu) {
      isOrganizeMenuOpen.value = false
    }
  }

  if (!openProjectMenuId.value) return
  if (!isEventInsideOpenProjectMenu(event)) {
    closeProjectMenu()
  }

  if (!openThreadMenuId.value) return
  if (isEventInsideOpenThreadMenu(event)) return
  closeThreadMenu()
}

function onProjectMenuFocusIn(event: FocusEvent): void {
  if (openProjectMenuId.value && !isEventInsideOpenProjectMenu(event)) {
    closeProjectMenu()
  }
  if (openThreadMenuId.value && !isEventInsideOpenThreadMenu(event)) {
    closeThreadMenu()
  }
}

function onWindowBlurForProjectMenu(): void {
  if (isOrganizeMenuOpen.value) {
    isOrganizeMenuOpen.value = false
  }
  if (openProjectMenuId.value) {
    closeProjectMenu()
  }
  if (openThreadMenuId.value) {
    closeThreadMenu()
  }
}

function bindProjectMenuDismissListeners(): void {
  window.addEventListener('pointerdown', onProjectMenuPointerDown, { capture: true })
  window.addEventListener('focusin', onProjectMenuFocusIn, { capture: true })
  window.addEventListener('blur', onWindowBlurForProjectMenu)
}

function unbindProjectMenuDismissListeners(): void {
  window.removeEventListener('pointerdown', onProjectMenuPointerDown, { capture: true })
  window.removeEventListener('focusin', onProjectMenuFocusIn, { capture: true })
  window.removeEventListener('blur', onWindowBlurForProjectMenu)
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
  const openThreadMenuProjectName = openThreadMenuId.value
    ? (threadProjectNameById.value.get(openThreadMenuId.value) ?? '')
    : ''
  const shouldElevateForMenu =
    openProjectMenuId.value === projectName || openThreadMenuProjectName === projectName

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

function projectThreads(group: UiProjectGroup): UiThread[] {
  return unpinnedThreadsByProjectName.value.get(group.projectName) ?? []
}

function visibleThreads(group: UiProjectGroup): UiThread[] {
  if (isSearchActive.value) return projectThreads(group)
  if (isCollapsed(group.projectName)) return []

  const rows = projectThreads(group)
  return isExpanded(group.projectName) ? rows : rows.slice(0, 10)
}

function hasHiddenThreads(group: UiProjectGroup): boolean {
  if (isSearchActive.value) return false
  return !isCollapsed(group.projectName) && projectThreads(group).length > 10
}

function hasThreads(group: UiProjectGroup): boolean {
  return projectThreads(group).length > 0
}

watch(
  () => props.groups.map((group) => group.projectName),
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

watch(
  () => {
    const projectName = openProjectMenuId.value
    return projectName ? props.projectGitRepoByName[projectName] : undefined
  },
  () => {
    const projectName = openProjectMenuId.value
    if (!projectName) return
    nextTick(() => {
      if (openProjectMenuId.value === projectName) {
        updateProjectMenuDirection(projectName)
      }
    })
  },
)

const hasOpenDismissableMenu = computed(
  () => isOrganizeMenuOpen.value || openProjectMenuId.value !== '' || openThreadMenuId.value !== '',
)

watch(hasOpenDismissableMenu, (isOpen) => {
  if (isOpen) {
    bindProjectMenuDismissListeners()
    return
  }

  unbindProjectMenuDismissListeners()
})

watch(openThreadMenuId, (threadId) => {
  if (!threadId) {
    unbindThreadMenuPositionListeners()
    return
  }

  bindThreadMenuPositionListeners()
  nextTick(() => {
    updateOpenThreadMenuPlacement(threadId)
  })
})

onBeforeUnmount(() => {
  for (const element of projectGroupElementByName.values()) {
    projectGroupResizeObserver?.unobserve(element)
  }
  projectGroupElementByName.clear()
  projectMenuWrapElementByName.clear()
  unbindThreadMenuPositionListeners()
  unbindProjectMenuDismissListeners()
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

.chats-section {
  @apply order-3 mt-1;
}

.thread-tree-root.chats-first .chats-section {
  @apply order-2;
}

.thread-tree-root.chats-first .projects-section {
  @apply order-3;
}

.thread-tree-header-row {
  @apply cursor-pointer;
}

.section-toggle-row {
  @apply hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400;
}

.thread-tree-header {
  @apply text-sm font-normal text-zinc-500 select-none;
}

.chats-section-actions {
  @apply flex items-center gap-1;
}

.chats-section-action {
  @apply h-5 w-5 rounded text-zinc-500 flex items-center justify-center transition hover:bg-zinc-200 hover:text-zinc-700;
}

.chats-section-action[aria-pressed='true'] {
  @apply bg-zinc-200 text-zinc-800;
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

.organize-menu-separator {
  @apply my-1 h-px bg-zinc-200;
}

.organize-menu-item {
  @apply w-full rounded-lg px-2 py-1.5 text-sm text-zinc-700 flex items-center justify-between hover:bg-zinc-100;
}

.organize-menu-item[data-active='true'] {
  @apply bg-zinc-100 text-zinc-900;
}

.thread-start-button {
  @apply h-5 w-5 rounded text-zinc-500 flex items-center justify-center transition hover:bg-zinc-200 hover:text-zinc-700;
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
  @apply hover:bg-zinc-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400;
}

.project-header-row[data-active='true'] {
  @apply bg-zinc-200;
}

.project-main-button {
  @apply min-w-0 w-full text-left rounded px-0 py-0 flex items-center gap-1.5 min-h-5 cursor-pointer;
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

.project-menu-wrap {
  @apply relative;
}

.project-hover-controls {
  @apply flex items-center gap-1;
}

.project-menu-trigger {
  @apply h-4 w-4 rounded p-0 text-zinc-600 flex items-center justify-center;
}

.project-menu-panel {
  @apply absolute right-0 top-full mt-1 z-20 min-w-36 rounded-md border border-zinc-200 bg-white p-1 shadow-md flex flex-col gap-0.5;
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
