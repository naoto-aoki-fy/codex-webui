<template>
  <DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" @close-sidebar="setSidebarCollapsed(true)">
    <template #sidebar>
      <section class="sidebar-root">
        <div
          ref="sidebarScrollableRef"
          class="sidebar-scrollable"
          @scroll="onSidebarScroll"
        >
          <SidebarThreadControls
            v-if="!isSidebarCollapsed"
            class="sidebar-thread-controls-host"
            :is-sidebar-collapsed="isSidebarCollapsed"
            :show-new-thread-button="true"
            @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
            @start-new-thread="onStartNewThreadFromToolbar"
          >
            <button
              class="sidebar-search-toggle"
              type="button"
              :aria-pressed="isSidebarSearchVisible"
              :aria-label="('Search threads')"
              :title="('Search threads')"
              @click="toggleSidebarSearch"
            >
              <IconTablerSearch class="sidebar-search-toggle-icon" />
            </button>
            <button
              class="sidebar-search-toggle"
              :class="{ 'is-active': isSkillsRoute }"
              type="button"
              :aria-label="('Skills')"
              :title="('Skills')"
              :aria-current="isSkillsRoute ? 'page' : undefined"
              @click="router.push({ name: 'skills' }); isMobile && setSidebarCollapsed(true)"
            >
              <IconTablerBolt class="sidebar-search-toggle-icon" />
            </button>
          </SidebarThreadControls>

          <div v-if="!isSidebarCollapsed && isSidebarSearchVisible" class="sidebar-search-bar">
            <IconTablerSearch class="sidebar-search-bar-icon" />
            <input
              ref="sidebarSearchInputRef"
              v-model="sidebarSearchQuery"
              class="sidebar-search-input"
              type="text"
              :placeholder="('Filter threads...')"
              @keydown="onSidebarSearchKeydown"
            />
            <button
              v-if="sidebarSearchQuery.length > 0"
              class="sidebar-search-clear"
              type="button"
              :aria-label="('Clear search')"
              @click="clearSidebarSearch"
            >
              <IconTablerX class="sidebar-search-clear-icon" />
            </button>
          </div>

          <p v-if="threadSearchError" role="alert">{{ threadSearchError }}</p>
          <SidebarThreadTree :groups="sidebarSearchGroups" :project-display-name-by-id="projectDisplayNameById"
            :removable-project-ids="removableProjectIds"
            :active-project-name="activeProjectName"
            v-if="!isSidebarCollapsed"
            :selected-thread-id="selectedThreadId" :is-loading="isLoadingThreads"
            :is-fork-disabled="isForkOperationPending"
            :is-exporting="isExporting"
            :is-thread-list-fully-loaded="isThreadListFullyLoaded"
            :search-query="sidebarSearchQuery"
            :search-matched-thread-ids="serverMatchedThreadIds"
            @select="onSelectThread"
            @archive="onArchiveThread" @start-new-thread="onStartNewThread"
            @rename-thread="onRenameThread"
            @fork-thread="onForkThread"
            @remove-project="onRemoveProject"
            @copy-thread-chat="onCopyThreadChat" @export-thread="onExportThread" />
          <p v-if="exportStatus" class="feature-panel" role="status">{{ exportStatus }}</p>
          <ArchivedThreads v-if="!isSidebarCollapsed" :epoch="operationEpoch" :restore="restoreThreadById" />
        </div>

        <div
          v-if="!isSidebarCollapsed"
          ref="settingsAreaRef"
          class="sidebar-settings-area"
          @click="onSettingsAreaClick"
        >
          <Transition name="settings-panel">
            <div
              v-if="isSettingsOpen"
              ref="settingsPanelRef"
              class="sidebar-settings-panel"
              @click.stop
            >
              <AccountSettingsPanel
                :auth-available="codexAuthAvailable"
                :refreshing="isRefreshingCodexAuth"
                :change-blocked="isCodexAuthChangeBlocked"
                :error="accountActionError"
                @refresh="onRefreshCodexAuth"
                @logout="onLogoutCodex"
              />

              <GeneralPreferencesSettings
                :send-with-enter="sendWithEnter"
                :dark-mode="darkMode"
                :chat-width-label="chatWidthLabel"
                :help="SETTINGS_HELP"
                @toggle-send-with-enter="toggleSendWithEnter"
                @cycle-dark-mode="cycleDarkMode"
                @cycle-chat-width="cycleChatWidth"
              />
              <div
                v-if="showThreadContextBadge"
                class="sidebar-settings-row sidebar-settings-context-row"
                :data-state="threadContextBadgeState"
                :title="threadContextTooltip"
              >
                <span class="sidebar-settings-label">{{ ('Context') }}</span>
                <span class="sidebar-settings-context-value" :data-state="threadContextBadgeState">
                  {{ threadContextPrimaryText }}
                  <span class="sidebar-settings-context-meta">{{ threadContextSecondaryText }}</span>
                </span>
              </div>
              <div class="sidebar-settings-rate-limits">
                <RateLimitStatus :snapshots="accountRateLimitSnapshots" />
              </div>
            </div>
          </Transition>
          <button
            ref="settingsButtonRef"
            class="sidebar-settings-button"
            type="button"
            @click.stop="isSettingsOpen = !isSettingsOpen"
          >
            <IconTablerSettings class="sidebar-settings-icon" />
            <span>{{ ('Settings') }}</span>
          </button>
        </div>
      </section>
    </template>

    <template #content>
      <section
        class="content-root"
        :class="{
          'is-virtual-keyboard-open': isVirtualKeyboardOpen,
        }"
        :style="contentStyle"
      >
        <span v-if="isVirtualKeyboardOpen" class="content-keyboard-spacer" aria-hidden="true" />
        <ContentHeader :title="contentTitle" :project-name="contentProjectName" :accent="isSkillsRoute">
          <template #leading>
            <SidebarThreadControls
              v-if="isSidebarCollapsed || isMobile"
              class="sidebar-thread-controls-header-host"
              :is-sidebar-collapsed="isSidebarCollapsed"
              :show-new-thread-button="true"
              @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
              @start-new-thread="onStartNewThreadFromToolbar"
            />
            <span v-if="isSkillsRoute" class="skills-route-header-icon" aria-hidden="true">
              <IconTablerBolt />
            </span>
          </template>
        </ContentHeader>
        <p v-if="nativeForkFailure" class="composer-runtime-error" role="alert">{{ nativeForkFailure }}</p>

        <div v-if="transportState === 'disconnected' || selectedRecoveryState || selectedUnknownOutcome || selectedLostApproval" class="connection-recovery-status" role="status">
          <span v-if="transportState === 'disconnected'">{{ ('App-server disconnected. Reconnecting…') }}</span>
          <span v-if="selectedRecoveryState">{{ ('Thread subscription') }}: {{ (selectedRecoveryState) }}</span>
          <button v-if="selectedRecoveryState === 'failed'" type="button" @click="retrySelectedSubscription">{{ ('Retry subscription') }}</button>
          <span v-if="selectedLostApproval">{{ ('The previous approval expired with the connection. Inspect the thread on the server host; only newly delivered approvals can be answered.') }}</span>
          <span v-if="selectedUnknownOutcome">{{ ('Submission outcome unknown. Inspect refreshed history before resending; missing history does not prove failure.') }}</span>
          <button v-if="selectedUnknownOutcome || selectedLostApproval" type="button" @click="reconcileSelectedHistory">{{ ('Refresh history') }}</button>
        </div>
        <section class="content-body">
          <template v-if="isSkillsRoute">
            <SkillsMcpHub
              @skills-changed="onSkillsChanged"
            />
          </template>
          <template v-else-if="isHomeRoute">
            <div class="content-grid content-grid-home">
              <div class="new-thread-empty">
                <p class="new-thread-hero">{{ ("Let's build") }}</p>
                <ComposerDropdown class="new-thread-folder-dropdown" :model-value="newThreadProjectId || newThreadCwd"
                  :options="newThreadFolderOptions" :placeholder="('Choose folder')"
                  :enable-search="true"
                  :search-placeholder="('Quick search project')"
                  :disabled="false" @update:model-value="onSelectNewThreadFolder" />
                <p v-if="newThreadCwd" class="new-thread-folder-selected" :title="newThreadCwd">
                  {{ ('Selected folder') }}: {{ newThreadCwd }}
                </p>
                <div class="new-thread-folder-actions">
                  <button class="new-thread-folder-action new-thread-folder-action-primary" type="button" @click="onOpenExistingFolder">
                    {{ ('Select folder') }}
                  </button>

                </div>
                <FolderPickerModal
                  v-if="isExistingFolderPickerOpen"
                  ref="folderPickerModalRef"
                  v-model:existing-folder-path-draft="existingFolderPathDraft"
                  v-model:show-hidden-folders="showHiddenFolders"
                  v-model:existing-folder-filter="existingFolderFilter"
                  :resolved-existing-folder-path="resolvedExistingFolderPath"
                  :is-existing-folder-loading="isExistingFolderLoading"
                  :is-opening-existing-folder="isOpeningExistingFolder"
                  :existing-folder-browse-path="existingFolderBrowsePath"
                  :existing-folder-error="existingFolderError"
                  :existing-folder-filtered-entries="existingFolderFilteredEntries"
                  @close="onCloseExistingFolderPanel"
                  @retry="onRetryExistingFolderBrowse"
                  @confirm="onConfirmExistingFolder"
                  @toggle-hidden="onToggleHiddenFolders"
                  @browse="onBrowseExistingFolder"
                />

              </div>

              <div class="composer-container" :class="{ 'is-disabled': !newThreadCwd.trim() }"
                :inert="!newThreadCwd.trim()" :aria-disabled="!newThreadCwd.trim()">
                <ThreadComposer ref="homeThreadComposerRef" :active-thread-id="composerThreadContextId"
                  :cwd="composerCwd"
                  :disabled="!newThreadCwd.trim()"
                  :collaboration-modes="availableCollaborationModes"
                  :selected-collaboration-mode="selectedCollaborationMode"
                  :models="availableModelIds" :model-provider="parseModelSelection(composerSelectedModelId).provider" :selected-model="composerSelectedModelId"
                  :selected-reasoning-effort="composerReasoningEffort"
                  :reasoning-effort-options="composerReasoningOptions"
                  :selected-speed-mode="selectedSpeedMode"
                  :is-updating-speed-mode="isUpdatingSpeedMode"
                  :skills="installedSkills"
                  :is-turn-in-progress="false"
                  :is-stop-pending="false"
                  :is-interrupting-turn="false" :send-with-enter="sendWithEnter"
                  @submit="onSubmitThreadMessage"
                  @update:selected-collaboration-mode="onSelectCollaborationMode"
                  @update:selected-model="onSelectModel"
                  @update:selected-reasoning-effort="onSelectReasoningEffort"
                  @update:selected-speed-mode="onSelectSpeedMode" />
              </div>
            </div>
          </template>
          <template v-else>
            <div class="content-grid">
              <div class="content-thread">
                <ThreadConversation ref="threadConversationRef" :messages="filteredMessages" :is-loading="isLoadingMessages"
                  :active-thread-id="composerThreadContextId" :cwd="composerCwd"
                  :live-overlay="liveOverlay"
                  :is-revert-disabled="isRollingBack || isSelectedThreadInProgress"
                  :is-fork-disabled="isForkOperationPending"
            :is-exporting="isExporting"
                  :pending-requests="selectedThreadServerRequests"
                  :has-more-persisted-above="hasMoreOlderMessages"
                  :is-loading-persisted-above="isLoadingOlderMessages"
                  :load-earlier-messages="loadOlderMessages"
                  @fork-thread="onForkThreadFromMessage"
                  @rollback="onRollback"
                  @implement-plan="onImplementPlan" />
              </div>

              <div class="composer-container">
                <ThreadGoalPanel
                  ref="threadGoalPanelRef"
                  :thread-id="selectedThreadId"
                  :in-progress="isSelectedThreadInProgress"
                />
                <ThreadPendingRequestPanel
                  v-if="selectedThreadPendingRequest"
                  :request="selectedThreadPendingRequest"
                  :request-count="selectedThreadServerRequests.length"
                  @respond-server-request="onRespondServerRequest"
                />
                <p v-if="modelSelectionNotice" class="composer-model-notice" role="status">{{ (modelSelectionNotice) }}</p>
                <ThreadComposer
                  v-if="!selectedThreadPendingRequest"
                  ref="threadComposerRef"
                  :disabled="isSelectedThreadImportIncomplete"
                  :active-thread-id="composerThreadContextId"
                  :cwd="composerCwd"
                  :collaboration-modes="availableCollaborationModes"
                  :selected-collaboration-mode="selectedCollaborationMode"
                  :models="availableModelIds" :model-provider="parseModelSelection(composerSelectedModelId).provider"
                  :selected-model="composerSelectedModelId"
                  :selected-reasoning-effort="composerReasoningEffort"
                  :reasoning-effort-options="composerReasoningOptions"
                  :selected-speed-mode="selectedSpeedMode"
                  :is-updating-speed-mode="isUpdatingSpeedMode"
                  :skills="installedSkills"
                  :is-turn-in-progress="isSelectedThreadInProgress"
                  :is-stop-pending="isSelectedThreadInterruptPending"
                  :is-interrupting-turn="isInterruptingTurn"
                  :send-with-enter="sendWithEnter"
                  @update:selected-collaboration-mode="onSelectCollaborationMode"
                  @submit="onSubmitThreadMessage" @update:selected-model="onSelectModel"
                  @update:selected-reasoning-effort="onSelectReasoningEffort"
                  @update:selected-speed-mode="onSelectSpeedMode"
                  @edit-goal="threadGoalPanelRef?.edit()"
                  @interrupt="onInterruptTurn" />
              </div>
            </div>
          </template>
        </section>
      </section>
    </template>
  </DesktopLayout>
  <div v-if="transferPicker" class="transfer-picker-backdrop" role="presentation">
    <section class="transfer-picker" role="dialog" aria-modal="true" aria-label="Transfer conversation">
      <h2>Portable Fork</h2>
      <p>Select the destination provider. Its default model will be used; you can change the model afterward.</p>
      <p v-if="transferPicker.loading">Reading the complete source history…</p>
      <ComposerDropdown v-else v-model="transferProvider" :options="transferProviderOptions" placeholder="Provider" enable-search open-direction="down" :disabled="transferPicker.pending" />
      <p v-if="transferPicker.failure" role="alert">{{ transferPicker.failure }}</p>
      <button type="button" :disabled="transferPicker.pending" @click="cancelTransferPicker">Cancel</button>
      <button type="button" :disabled="!canConfirmFork" @click="confirmTransferPicker">{{ transferPicker.pending ? 'Importing history…' : 'Create conversation' }}</button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { createAppRouteCoordinator } from './appRouteCoordinator'
import { createAppTransferDialog } from './appTransferDialog'

import { useNativeProjectOptions } from './composables/useNativeProjectOptions'

import { parseModelSelection } from './api/modelCapabilities'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNewThreadCwdRoute } from './composables/useNewThreadCwdRoute'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import GeneralPreferencesSettings from './components/sidebar/GeneralPreferencesSettings.vue'
import ArchivedThreads from './components/sidebar/ArchivedThreads.vue'
import AccountSettingsPanel from './components/sidebar/AccountSettingsPanel.vue'
import SidebarThreadTree from './components/sidebar/SidebarThreadTree.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import FolderPickerModal from './components/content/FolderPickerModal.vue'
import ThreadGoalPanel from './components/content/ThreadGoalPanel.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import ThreadPendingRequestPanel from './components/content/ThreadPendingRequestPanel.vue'
import RateLimitStatus from './components/content/RateLimitStatus.vue'
import ComposerDropdown from './components/content/ComposerDropdown.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import IconTablerBolt from './components/icons/IconTablerBolt.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerSettings from './components/icons/IconTablerSettings.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import { createConversationExport } from './composables/conversationExport'
import { useDesktopState } from './composables/useDesktopState'
import { useFolderPicker } from './composables/useFolderPicker'
import { useMobile } from './composables/useMobile'
import { logoutCodex, getHomeDirectory, getWorkspaceRootsState, openProjectRootSelection, searchThreads } from './api/codexGateway'
import type { ReasoningEffort, SpeedMode, UiServerRequest, UiServerRequestReply, UiThreadTokenUsage } from './types/codex'
import type { ThreadComposerExposed } from './components/content/ThreadComposer.vue'
import { getCodexAuthenticationStatus } from './api/codexGateway'
import { getPathParent, normalizePathForUi } from './pathUtils.js'
import { copyTextToClipboard } from './utils/clipboard'

const ThreadConversation = defineAsyncComponent(() => import('./components/content/ThreadConversation.vue'))
const SkillsMcpHub = defineAsyncComponent(() => import('./components/content/SkillsMcpHub.vue'))

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'codex-web-local.sidebar-collapsed.v1'
const SETTINGS_HELP = {
  sendWithEnter: ('When enabled, press Enter to send. When disabled, use Command+Enter to send.'),
  appearance: ('Switch between system theme, light mode, and dark mode.'),
  chatWidth: ('Choose how wide the conversation column and composer can grow on desktop screens.'),
} as const

type ChatWidthMode = 'standard' | 'wide' | 'extra-wide'

type ChatWidthPreset = {
  label: string
  columnMax: string
  cardMax: string
}

const CHAT_WIDTH_PRESETS: Record<ChatWidthMode, ChatWidthPreset> = {
  standard: {
    label: 'Standard',
    columnMax: '45rem',
    cardMax: '76ch',
  },
  wide: {
    label: 'Wide',
    columnMax: '72rem',
    cardMax: '88ch',
  },
  'extra-wide': {
    label: 'Extra wide',
    columnMax: '96rem',
    cardMax: '96ch',
  },
}

const {
  projectGroups,
  projectDisplayNameById, workspaceRootsState,
  selectedThread,
  selectedThreadTokenUsage,
  selectedThreadServerRequests,
  selectedLiveOverlay,
  selectedThreadId,
  availableCollaborationModes,
  availableModelIds,
  selectedCollaborationMode,
  selectedModelId,
  selectedSpeedMode,
  installedSkills,
  accountRateLimitSnapshots,
  messages,
  hasMoreOlderMessages,
  isLoadingThreads,
  isThreadListFullyLoaded,
  isLoadingMessages,
  isLoadingOlderMessages,
  isSendingMessage,
  isInterruptingTurn,
  isSelectedThreadInterruptPending,
  isUpdatingSpeedMode,
  transportState, selectedRecoveryState, selectedUnknownOutcome, selectedLostApproval,
  retrySelectedSubscription, reconcileSelectedHistory,
  error: desktopError,
  modelSelectionNotice,
  refreshAll,
  refreshWorkspaceRoots,
  refreshSkills,
  selectThread,
  ensureThreadMessagesLoaded,
  loadOlderMessages,
  archiveThreadById,
  restoreThreadById,
  operationEpoch,
  forkThreadById,
  forkNativeThreadById,
  renameThreadById,
  forkThreadFromTurn,
  sendMessageToSelectedThread,
  sendMessageToNewThread,
  interruptSelectedThreadTurn,
  setSelectedCollaborationMode,
  readModelIdForThread,
  readReasoningEffortForThread,
  readReasoningOptionsForThread,
  setSelectedModelIdForThread,

  setSelectedReasoningEffort,
  updateSelectedSpeedMode,
  respondToPendingServerRequest,
  removeProject,
  startPolling,
  stopPolling,
  primeSelectedThread,
  executeThreadRevert,
  isRollingBack,
} = useDesktopState()

const route = useRoute()
const router = useRouter()
const { isMobile } = useMobile()
const homeThreadComposerRef = ref<ThreadComposerExposed | null>(null)
const threadGoalPanelRef = ref<InstanceType<typeof ThreadGoalPanel> | null>(null)
const threadComposerRef = ref<ThreadComposerExposed | null>(null)
const threadConversationRef = ref<{ jumpToLatest: () => void } | null>(null)
const routing = createAppRouteCoordinator({
  get route() { return route; },
  get selectedThreadId() { return selectedThreadId; },
  get selectThread() { return selectThread; },
  get routeThreadId() { return routeThreadId; },
  get ensureThreadMessagesLoaded() { return ensureThreadMessagesLoaded; },
  get newThreadCwd() { return newThreadCwd; },
  get desktopError() { return desktopError; },
  get sendMessageToNewThread() { return sendMessageToNewThread; },
  get newThreadProjectId() { return newThreadProjectId; },
  get router() { return router; },
  get scheduleMobileConversationJumpToLatest() { return scheduleMobileConversationJumpToLatest; }
})
const {
  isRouteSyncInProgress,
  syncThreadSelectionWithRoute,
  submitFirstMessageForNewThread,
} = routing

const hasInitialized = ref(false)
const newThreadCwd = ref('')
const newThreadProjectId = computed(() => typeof route.query.projectId === 'string' ? route.query.projectId : '')
useNewThreadCwdRoute(router, newThreadCwd)
const workspaceRootOptionsState = ref<import('./api/codexGateway').WorkspaceRootsState>({
  order: [],
})
watch(workspaceRootsState, state => { if (state) workspaceRootOptionsState.value = state })
const isSidebarCollapsed = ref(loadSidebarCollapsed())
const sidebarSearchQuery = ref('')
const isSidebarSearchVisible = ref(false)
const sidebarScrollableRef = ref<HTMLElement | null>(null)
const sidebarSearchInputRef = ref<HTMLInputElement | null>(null)
const settingsAreaRef = ref<HTMLElement | null>(null)
const settingsPanelRef = ref<HTMLElement | null>(null)
const settingsButtonRef = ref<HTMLElement | null>(null)
const serverMatchedThreadIds = ref<string[] | null>(null)
const serverSearchGroups = ref<typeof projectGroups.value>([])
const threadSearchError = ref('')
const sidebarSearchGroups = computed(() => {
  if (!sidebarSearchQuery.value.trim()) return projectGroups.value
  const groups = projectGroups.value.map(group => ({ ...group, threads: [...group.threads] }))
  const ids = new Set(groups.flatMap(group => group.threads.map(thread => thread.id)))
  for (const group of serverSearchGroups.value) {
    const missing = group.threads.filter(thread => !ids.has(thread.id))
    missing.forEach(thread => ids.add(thread.id))
    const existing = groups.find(row => row.projectName === group.projectName)
    if (existing) existing.threads.push(...missing)
    else groups.push({ ...group, threads: missing })
  }
  return groups
})
let threadSearchTimer: ReturnType<typeof setTimeout> | null = null
let sidebarScrollTop = 0
let sidebarScrollRestoreRequestId = 0
let isRestoringSidebarScroll = false
const homeDirectory = ref('')
const isSettingsOpen = ref(false)
const accountActionError = ref('')
const codexAuthAvailable = ref<boolean | null>(null)
const isRefreshingCodexAuth = ref(false)
const SEND_WITH_ENTER_KEY = 'codex-web-local.send-with-enter.v1'
const DARK_MODE_KEY = 'codex-web-local.dark-mode.v1'

const CHAT_WIDTH_KEY = 'codex-web-local.chat-width.v1'
const sendWithEnter = ref(loadBoolPref(SEND_WITH_ENTER_KEY, true))
const darkMode = ref<'system' | 'light' | 'dark'>(loadDarkModePref())
const chatWidth = ref<ChatWidthMode>(loadChatWidthPref())
const folderPickerModalRef = ref<InstanceType<typeof FolderPickerModal> | null>(null)
const {
  isExistingFolderPickerOpen,
  existingFolderPathDraft,
  existingFolderBrowsePath,
  existingFolderError,
  isExistingFolderLoading,
  isOpeningExistingFolder,
  showHiddenFolders,
  existingFolderFilter,
  resolvedExistingFolderPath,
  existingFolderFilteredEntries,
  onOpenExistingFolder,
  onCloseExistingFolderPanel,
  onBrowseExistingFolder,
  onToggleHiddenFolders,
  onRetryExistingFolderBrowse,
} = useFolderPicker({
  resolveStartPath: async () => newThreadCwd.value.trim() || await resolveProjectBaseDirectory(),
  focusPathInput: () => folderPickerModalRef.value?.focusPathInput(),
})
let workspaceRootsResumeTimer: ReturnType<typeof setTimeout> | null = null
let workspaceRootsResumeInProgress = false
let lastWorkspaceRootsResumeAt = 0
const visualViewportHeight = ref(typeof window !== 'undefined' ? window.visualViewport?.height ?? window.innerHeight : 0)
const visualViewportOffsetTop = ref(typeof window !== 'undefined' ? window.visualViewport?.offsetTop ?? 0 : 0)
const layoutViewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 0)

const routeThreadId = computed(() => {
  const rawThreadId = route.params.threadId
  return typeof rawThreadId === 'string' ? rawThreadId : ''
})

const isHomeRoute = computed(() => route.name === 'home')
const isSkillsRoute = computed(() => route.name === 'skills')
const activeProjectName = computed<string | null>(() => {
  if (isSkillsRoute.value) return null
  if (!isHomeRoute.value) {
    const thread = selectedThread.value
    return thread?.projectName ?? null
  }

  return newThreadProjectId.value || null
})
const contentTitle = computed(() => {
  if (isSkillsRoute.value) return ('Skills')
  if (isHomeRoute.value) return ('Start new thread')
  return selectedThread.value?.title ?? ('Choose a thread')
})
const contentProjectName = computed(() => {
  if (isHomeRoute.value || isSkillsRoute.value) return ''
  const projectName = selectedThread.value?.projectName?.trim() ?? ''
  return projectName ? (projectDisplayNameById.value[projectName] ?? projectName) : ''
})
const pageTitle = computed(() => {
  const threadTitle = selectedThread.value?.title?.trim() ?? ''
  if (!threadTitle) return 'Codex WebUI'
  return contentProjectName.value ? `${contentProjectName.value} - ${threadTitle}` : threadTitle
})
const filteredMessages = computed(() =>
  messages.value.filter((message) => {
    const type = normalizeMessageType(message.messageType, message.role)
    if (type === 'worked') return true
    if (type === 'turnActivity.live' || type === 'turnError.live' || type === 'agentReasoning.live') return false
    return true
  }),
)
const liveOverlay = computed(() => selectedLiveOverlay.value)
const composerThreadContextId = computed(() => (isHomeRoute.value ? '__new-thread__' : selectedThreadId.value))
const composerReasoningEffort = computed(() => readReasoningEffortForThread(composerThreadContextId.value))
const composerReasoningOptions = computed(() => readReasoningOptionsForThread(composerThreadContextId.value))
const composerSelectedModelId = computed(() => readModelIdForThread(composerThreadContextId.value))
const selectedThreadPendingRequest = computed<UiServerRequest | null>(() => {
  const rows = selectedThreadServerRequests.value
  return rows.length > 0 ? rows[rows.length - 1] : null
})
const composerCwd = computed(() => {
  if (isHomeRoute.value) return newThreadCwd.value.trim()
  return selectedThread.value?.cwd?.trim() ?? ''
})
const isVirtualKeyboardOpen = computed(() => {
  if (!isMobile.value) return false
  if (visualViewportHeight.value <= 0 || layoutViewportHeight.value <= 0) return false
  return layoutViewportHeight.value - visualViewportHeight.value > 120
})
const isSelectedThreadInProgress = computed(() => !isHomeRoute.value && selectedThread.value?.inProgress === true)
const showThreadContextBadge = computed(() => !isHomeRoute.value && !isSkillsRoute.value && selectedThreadId.value.trim().length > 0)
const isCodexAuthChangeBlocked = computed(() =>
  isSendingMessage.value ||
  isInterruptingTurn.value ||
  isSelectedThreadInProgress.value ||
  selectedThreadServerRequests.value.length > 0,
)

function formatCompactTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100000 ? 0 : 1,
  }).format(Math.max(0, Math.trunc(value)))
}

function buildThreadContextTooltip(usage: UiThreadTokenUsage | null): string {
  if (!usage) {
    return ('Waiting for Codex thread/tokenUsage/updated events for this thread.')
  }

  const lines = [
    `${('Current context usage')}: ${usage.currentContextTokens.toLocaleString()} ${('tokens')}`,
    `${('Cumulative thread usage')}: ${usage.total.totalTokens.toLocaleString()} ${('tokens')}`,
  ]

  if (typeof usage.modelContextWindow === 'number') {
    lines.unshift(`${('Model context window')}: ${usage.modelContextWindow.toLocaleString()} ${('tokens')}`)
    lines.push(`${('Remaining context')}: ${(usage.remainingContextTokens ?? 0).toLocaleString()} ${('tokens')}`)
  } else {
    lines.push(('Model context window is unavailable in the latest usage event.'))
  }

  return lines.join('\n')
}

const threadContextBadgeState = computed(() => {
  const remainingPercent = selectedThreadTokenUsage.value?.remainingContextPercent
  if (remainingPercent === null || typeof remainingPercent !== 'number') return 'pending'
  if (remainingPercent <= 10) return 'danger'
  if (remainingPercent <= 25) return 'warning'
  return 'ok'
})

const threadContextPrimaryText = computed(() => {
  const usage = selectedThreadTokenUsage.value
  if (!usage) return ('Awaiting data')
  if (typeof usage.remainingContextTokens === 'number') {
    return `${formatCompactTokenCount(usage.remainingContextTokens)} ${('left')}`
  }
  return `${formatCompactTokenCount(usage.currentContextTokens)} ${('used')}`
})

const threadContextSecondaryText = computed(() => {
  const usage = selectedThreadTokenUsage.value
  if (!usage) return ('Updates after the next token usage event')
  if (typeof usage.modelContextWindow === 'number') {
    return `${formatCompactTokenCount(usage.currentContextTokens)} ${('used')} / ${formatCompactTokenCount(usage.modelContextWindow)}`
  }
  return ('Window size unavailable')
})

const threadContextTooltip = computed(() => buildThreadContextTooltip(selectedThreadTokenUsage.value))

const { newThreadFolderOptions, removableProjectIds, resolveWorkspaceRootCwd } = useNativeProjectOptions(workspaceRootOptionsState)
const darkModeMediaQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const chatWidthLabel = computed(() => (CHAT_WIDTH_PRESETS[chatWidth.value].label))
const contentStyle = computed(() => {
  const preset = CHAT_WIDTH_PRESETS[chatWidth.value]
  const keyboardInset = Math.max(
    0,
    layoutViewportHeight.value - visualViewportHeight.value - visualViewportOffsetTop.value,
  )
  return {
    '--chat-column-max': preset.columnMax,
    '--chat-card-max': preset.cardMax,
    '--visual-viewport-height': visualViewportHeight.value > 0 ? `${visualViewportHeight.value}px` : '100dvh',
    '--visual-viewport-offset-top': `${Math.max(0, visualViewportOffsetTop.value)}px`,
    '--virtual-keyboard-inset': `${keyboardInset}px`,
  }
})
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  window.addEventListener('keydown', onWindowKeyDown)
  document.addEventListener('visibilitychange', onDocumentVisibilityChange)
  window.addEventListener('pageshow', onWindowPageShow)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('resize', updateVisualViewportState)
  window.visualViewport?.addEventListener('resize', updateVisualViewportState)
  window.visualViewport?.addEventListener('scroll', updateVisualViewportState)
  updateVisualViewportState()
  applyDarkMode()
  darkModeMediaQuery?.addEventListener('change', applyDarkMode)
  void initialize()
  void loadHomeDirectory()
  void loadWorkspaceRootOptionsState()
  void loadCodexAuthStatus()
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('keydown', onWindowKeyDown)
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  window.removeEventListener('pageshow', onWindowPageShow)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('resize', updateVisualViewportState)
  window.visualViewport?.removeEventListener('resize', updateVisualViewportState)
  window.visualViewport?.removeEventListener('scroll', updateVisualViewportState)
  darkModeMediaQuery?.removeEventListener('change', applyDarkMode)
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
  if (workspaceRootsResumeTimer !== null) clearTimeout(workspaceRootsResumeTimer)
  stopPolling()
})

function updateVisualViewportState(): void {
  if (typeof window === 'undefined') return
  layoutViewportHeight.value = Math.max(layoutViewportHeight.value, window.innerHeight)
  visualViewportHeight.value = window.visualViewport?.height ?? window.innerHeight
  visualViewportOffsetTop.value = window.visualViewport?.offsetTop ?? 0
}

watch(sidebarSearchQuery, (value) => {
  const query = value.trim()
  serverSearchGroups.value = []
  threadSearchError.value = ''
  serverMatchedThreadIds.value = null
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
  if (!query) {
    serverMatchedThreadIds.value = null
    return
  }

  threadSearchTimer = setTimeout(() => {
    void searchThreads(query)
      .then((result) => {
        if (sidebarSearchQuery.value.trim() !== query) return
        serverSearchGroups.value = result.groups
        serverMatchedThreadIds.value = result.threadIds
      })
      .catch((error: unknown) => {
        if (sidebarSearchQuery.value.trim() !== query) return
        threadSearchError.value = `Conversation content search unavailable. Use a Codex server supporting thread/search with experimentalApi enabled. ${error instanceof Error ? error.message : String(error)}`
        serverMatchedThreadIds.value = null
      })
  }, 220)
})

function onSkillsChanged(): void {
  void refreshSkills({ force: true })
}

function toggleSidebarSearch(): void {
  isSidebarSearchVisible.value = !isSidebarSearchVisible.value
  if (isSidebarSearchVisible.value) {
    nextTick(() => sidebarSearchInputRef.value?.focus())
  } else {
    sidebarSearchQuery.value = ''
  }
}

function clearSidebarSearch(): void {
  sidebarSearchQuery.value = ''
  sidebarSearchInputRef.value?.focus()
}

function getSidebarScrollableElement(): HTMLElement | null {
  if (sidebarScrollableRef.value) return sidebarScrollableRef.value
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('.mobile-drawer .sidebar-scrollable, .sidebar-scrollable')
}

function onSidebarScroll(event?: Event): void {
  if (isSidebarCollapsed.value) return
  if (isRestoringSidebarScroll) return
  const target = event?.currentTarget
  const container = target instanceof HTMLElement ? target : getSidebarScrollableElement()
  sidebarScrollTop = container?.scrollTop ?? sidebarScrollTop
}

function restoreSidebarScrollPosition(): void {
  const requestId = ++sidebarScrollRestoreRequestId
  const targetScrollTop = sidebarScrollTop
  const maxRestoreAttempts = 90
  isRestoringSidebarScroll = true
  const finishRestore = () => {
    if (requestId === sidebarScrollRestoreRequestId) {
      sidebarScrollTop = targetScrollTop
      isRestoringSidebarScroll = false
    }
  }
  const restore = (attempt: number) => {
    if (requestId !== sidebarScrollRestoreRequestId) return
    if (isSidebarCollapsed.value) {
      finishRestore()
      return
    }

    const container = getSidebarScrollableElement()
    if (container) {
      container.scrollTop = targetScrollTop
      if (Math.abs(container.scrollTop - targetScrollTop) <= 1 || attempt >= maxRestoreAttempts) {
        finishRestore()
        return
      }
    }

    if (attempt >= maxRestoreAttempts || typeof window === 'undefined') {
      finishRestore()
      return
    }
    window.requestAnimationFrame(() => restore(attempt + 1))
  }

  void nextTick(() => restore(0))
}

function onSidebarSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    isSidebarSearchVisible.value = false
    sidebarSearchQuery.value = ''
  }
}

function onSelectThread(threadId: string): void {
  if (!threadId) return
  if (route.name === 'thread' && routeThreadId.value === threadId) return
  void router.push({ name: 'thread', params: { threadId } })
  if (isMobile.value) setSidebarCollapsed(true)
}

const { busy: isExporting, status: exportStatus, run: exportConversation } = createConversationExport({ epoch: () => operationEpoch.value })
function onExportThread(threadId: string) {
  if (threadId !== selectedThreadId.value || !selectedThread.value) return
  void exportConversation(threadId, selectedThread.value.title)
}

async function onCopyThreadChat(threadId: string): Promise<void> {
  if (!threadId) return
  if (selectedThreadId.value !== threadId) return
  await copySelectedThreadChat()
}

function onArchiveThread(threadId: string): void {
  void archiveThreadById(threadId)
}

const transfers = createAppTransferDialog({
  get messages() { return messages; },
  get selectedThreadId() { return selectedThreadId; },
  get forkThreadById() { return forkThreadById; },
  get forkThreadFromTurn() { return forkThreadFromTurn; },
  get desktopError() { return desktopError; },
  get router() { return router; },
  get isMobile() { return isMobile; },
  get setSidebarCollapsed() { return setSidebarCollapsed; },
  get forkNativeThreadById() { return forkNativeThreadById; }
})
const {
  transferPicker,
  nativeForkFailure,
  isForkOperationPending,
  canConfirmFork,
  transferProvider,
  isSelectedThreadImportIncomplete,
  transferProviderOptions,
  openTransferPicker,
  cancelTransferPicker,
  confirmTransferPicker,
  onForkThread,
  onForkThreadFromMessage,
} = transfers

function resolvePreferredLocalCwd(projectId: string, fallbackCwd = ''): string {
  return resolveWorkspaceRootCwd(projectId) || fallbackCwd.trim()
}

function onStartNewThread(projectName: string): void {
  const projectGroup = projectGroups.value.find((group) => group.projectName === projectName)
  const projectCwd = resolvePreferredLocalCwd(projectName, projectGroup?.threads[0]?.cwd?.trim() ?? '')
  if (projectCwd || workspaceRootOptionsState.value.nativeProjects) {
    newThreadCwd.value = projectCwd
  }
  if (isMobile.value) setSidebarCollapsed(true)
  void router.push({ name: 'home', query: { ...(newThreadCwd.value ? { cwd: newThreadCwd.value } : {}), projectId: projectName } })
}

function resolveSelectedThreadProjectCwd(): string {
  const thread = selectedThread.value
  if (!thread) return ''
  const projectName = thread.projectName?.trim() ?? ''
  if (!projectName) return thread.cwd?.trim() ?? ''
  return resolvePreferredLocalCwd(projectName, thread.cwd?.trim() ?? '')
}

function onStartNewThreadFromToolbar(): void {
  const resolvedCwd = resolveSelectedThreadProjectCwd()
  if (resolvedCwd) {
    newThreadCwd.value = resolvedCwd
  }
  if (isMobile.value) setSidebarCollapsed(true)
  void router.push({ name: 'home', query: newThreadCwd.value ? { cwd: newThreadCwd.value, ...(selectedThread.value?.projectId ? { projectId: selectedThread.value.projectId } : {}) } : {} })
}

function onRenameThread(payload: { threadId: string; title: string }): void {
  void renameThreadById(payload.threadId, payload.title)
}

async function onRemoveProject(projectName: string): Promise<void> {
  await removeProject(projectName)
  await loadWorkspaceRootOptionsState()
}

function onRespondServerRequest(payload: UiServerRequestReply): void {
  void handleServerRequestResponse(payload)
}

async function handleServerRequestResponse(payload: UiServerRequestReply): Promise<void> {
  const responded = await respondToPendingServerRequest(payload)
  const followUpMessageText = payload.followUpMessageText?.trim() ?? ''
  if (!responded || !followUpMessageText || isHomeRoute.value) return

  try {
    await sendMessageToSelectedThread(followUpMessageText, [], [], [])
  } catch {
    // sendMessageToSelectedThread already surfaces the error through shared state.
  }
}

function setSidebarCollapsed(nextValue: boolean): void {
  if (isSidebarCollapsed.value === nextValue) return
  if (nextValue) {
    const currentScrollTop = getSidebarScrollableElement()?.scrollTop
    if (typeof currentScrollTop === 'number' && (currentScrollTop > 0 || sidebarScrollTop === 0)) {
      sidebarScrollTop = currentScrollTop
    }
  }
  isSidebarCollapsed.value = nextValue
  saveSidebarCollapsed(nextValue)
  if (!nextValue) {
    restoreSidebarScrollPosition()
  }
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && isSettingsOpen.value) {
    isSettingsOpen.value = false
    return
  }
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'b') {
    event.preventDefault()
    setSidebarCollapsed(!isSidebarCollapsed.value)
    return
  }
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (!isSettingsOpen.value) return
  if (settingsPanelRef.value?.contains(target)) return
  if (settingsButtonRef.value?.contains(target)) return
  isSettingsOpen.value = false
}

function onSettingsAreaClick(event: MouseEvent): void {
  if (!isSettingsOpen.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (settingsPanelRef.value?.contains(target)) return
  if (settingsButtonRef.value?.contains(target)) return
  isSettingsOpen.value = false
}

function onDocumentVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    lastWorkspaceRootsResumeAt = 0
    if (workspaceRootsResumeTimer !== null) clearTimeout(workspaceRootsResumeTimer)
    workspaceRootsResumeTimer = null
    return
  }
  scheduleWorkspaceRootsResume()
}

function onWindowPageShow(event: PageTransitionEvent): void {
  if (event.persisted) scheduleWorkspaceRootsResume()
}

function onWindowFocus(): void {
  scheduleWorkspaceRootsResume()
}

function scheduleWorkspaceRootsResume(): void {
  if (!hasInitialized.value || document.visibilityState !== 'visible') return
  if (workspaceRootsResumeInProgress || workspaceRootsResumeTimer !== null) return
  if (Date.now() - lastWorkspaceRootsResumeAt < 400) return
  workspaceRootsResumeTimer = setTimeout(() => {
    workspaceRootsResumeTimer = null
    if (document.visibilityState !== 'visible') return
    lastWorkspaceRootsResumeAt = Date.now()
    workspaceRootsResumeInProgress = true
    void refreshWorkspaceRoots().then((state) => {
      if (state) {
        workspaceRootOptionsState.value = state
      }
    }).finally(() => { workspaceRootsResumeInProgress = false })
  }, 100)
}

function onSubmitThreadMessage(
  payload: { text: string; imageUrls: string[]; fileAttachments: Array<{ label: string; path: string; fsPath: string }>; skills: Array<{ name: string; path: string }> },
  settle: (accepted: boolean) => void,
): void {
  scheduleMobileConversationJumpToLatest()
  const submission = isHomeRoute.value
    ? routing.submitFirstMessageForNewThread(payload.text, payload.imageUrls, payload.skills, payload.fileAttachments)
    : sendMessageToSelectedThread(payload.text, payload.imageUrls, payload.skills, payload.fileAttachments).then(() => true)
  void submission.then(accepted => settle(accepted), failure => {
    desktopError.value = failure instanceof Error ? failure.message : String(failure)
    settle(false)
  })
}

function scheduleMobileConversationJumpToLatest(): void {
  if (!isMobile.value || isHomeRoute.value) return

  const jumpToLatest = () => {
    threadConversationRef.value?.jumpToLatest()
  }

  jumpToLatest()
  void nextTick(() => {
    jumpToLatest()
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      jumpToLatest()
      window.requestAnimationFrame(jumpToLatest)
    })
  })
}

function onSelectNewThreadFolder(value: string): void {
  const project = workspaceRootOptionsState.value.nativeProjects?.find(p => p.id === value)
  newThreadCwd.value = project ? project.roots[0]?.path || '' : value.trim()
  const query: Record<string, any> = { ...route.query, cwd: newThreadCwd.value }
  if (project) query.projectId = project.id
  else delete query.projectId
  void router.replace({ name: 'home', query })
}

async function onConfirmExistingFolder(path = resolvedExistingFolderPath.value): Promise<void> {
  const targetPath = normalizePathForUi(path).trim()
  if (!targetPath) return

  existingFolderError.value = ''
  isOpeningExistingFolder.value = true
  try {
    const selection = await openProjectRootSelection(targetPath)
    const normalizedPath = selection.path
    if (!normalizedPath) {
      existingFolderError.value = 'Failed to open the selected folder.'
      return
    }

    newThreadCwd.value = normalizedPath
    await router.replace({ name: 'home', query: { cwd: normalizedPath, ...(selection.projectId ? { projectId: selection.projectId } : {}) } })
    await loadWorkspaceRootOptionsState()
    await refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })
    onCloseExistingFolderPanel()
  } catch (error) {
    existingFolderError.value = error instanceof Error ? error.message : 'Failed to open the selected folder.'
  } finally {
    isOpeningExistingFolder.value = false
  }
}

async function applyLaunchProjectPathFromUrl(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const launchProjectPath = new URLSearchParams(window.location.search).get('openProjectPath')?.trim() ?? ''
  if (!launchProjectPath) return false
  try {
    const selection = await openProjectRootSelection(launchProjectPath)
    const normalizedPath = selection.path
    if (!normalizedPath) return false
    await router.replace({ name: 'home', query: { cwd: normalizedPath, ...(selection.projectId ? { projectId: selection.projectId } : {}) } })
    await loadWorkspaceRootOptionsState()
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('openProjectPath')
    window.history.replaceState({}, '', nextUrl.toString())
    return true
  } catch {
    // If launch path is invalid, keep normal startup behavior.
    return false
  }
}

async function resolveProjectBaseDirectory(): Promise<string> {
  const baseDir = getProjectBaseDirectory()
  if (baseDir) return baseDir
  try {
    const loadedHomeDirectory = await getHomeDirectory()
    if (loadedHomeDirectory) {
      homeDirectory.value = loadedHomeDirectory
      return loadedHomeDirectory
    }
  } catch {
    // Fallback handled by empty return.
  }
  return ''
}

function getProjectBaseDirectory(): string {
  const selected = newThreadCwd.value.trim()
  if (selected) return getPathParent(selected)
  const first = newThreadFolderOptions.value[0]?.value?.trim() ?? ''
  if (first) return getPathParent(first)
  return homeDirectory.value.trim()
}

async function loadHomeDirectory(): Promise<void> {
  try {
    homeDirectory.value = await getHomeDirectory()
  } catch {
    homeDirectory.value = ''
  }
}

async function loadWorkspaceRootOptionsState(): Promise<void> {
  try {
    const state = await getWorkspaceRootsState()
    workspaceRootOptionsState.value = state
  } catch (cause) {
    desktopError.value = cause instanceof Error ? cause.message : 'Failed to load projects'
  }
}

function onSelectModel(modelId: string): void {
  setSelectedModelIdForThread(composerThreadContextId.value, modelId)
}

function onSelectReasoningEffort(effort: ReasoningEffort | ''): void {
  setSelectedReasoningEffort(effort, composerThreadContextId.value)
}

function onSelectSpeedMode(mode: SpeedMode): void {
  void updateSelectedSpeedMode(mode)
}

function onInterruptTurn(): void {
  void interruptSelectedThreadTurn()
}

async function onRollback(payload: { threadId: string; turnId: string; operation: 'revert' | 'fork-and-revert' }): Promise<void> {
  const sourceRoute = route.fullPath
  const ownsRoute = routeThreadId.value === payload.threadId && selectedThreadId.value === payload.threadId
  const text = filteredMessages.value.find(message => message.role === 'user' && message.turnId === payload.turnId)?.text
  const destination = await executeThreadRevert(payload.threadId, payload.turnId, payload.operation)
  if (destination && ownsRoute && (route.fullPath === sourceRoute || (route.name === 'thread' && routeThreadId.value === destination))) {
    await router.replace({ name: 'thread', params: { threadId: destination } })
    await nextTick()
    if (selectedThreadId.value === destination && text) threadComposerRef.value?.appendTextToDraft(text)
  }
}

function onImplementPlan(payload: { turnId: string }): void {
  if (isHomeRoute.value || !selectedThreadId.value) return
  setSelectedCollaborationMode('default')
  scheduleMobileConversationJumpToLatest()
  void sendMessageToSelectedThread('Implement', [], [], [], 'default')
}

async function copySelectedThreadChat(): Promise<void> {
  if (isHomeRoute.value || isSkillsRoute.value) return
  if (!selectedThread.value || filteredMessages.value.length === 0) return
  const markdown = buildThreadMarkdown()
  try {
    await copyTextToClipboard(markdown)
  } catch {
    // Clipboard writes can be blocked by browser permissions; keep the menu action best-effort.
  }
}

function buildThreadMarkdown(): string {
  const lines: string[] = []
  const threadTitle = selectedThread.value?.title?.trim() || 'Untitled thread'
  lines.push(`# ${escapeMarkdownText(threadTitle)}`)
  lines.push('')
  lines.push(`- Exported: ${new Date().toISOString()}`)
  lines.push(`- Thread ID: ${selectedThread.value?.id ?? ''}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const message of filteredMessages.value) {
    const roleLabel = message.role ? message.role.toUpperCase() : 'MESSAGE'
    lines.push(`## ${roleLabel}`)
    lines.push('')

    const normalizedText = message.text.trim()
    if (normalizedText) {
      lines.push(normalizedText)
      lines.push('')
    }

    if (message.commandExecution) {
      lines.push('```text')
      lines.push(`command: ${message.commandExecution.command}`)
      lines.push(`status: ${message.commandExecution.status}`)
      if (message.commandExecution.cwd) {
        lines.push(`cwd: ${message.commandExecution.cwd}`)
      }
      if (message.commandExecution.exitCode !== null) {
        lines.push(`exitCode: ${message.commandExecution.exitCode}`)
      }
      lines.push(message.commandExecution.aggregatedOutput || '(no output)')
      lines.push('```')
      lines.push('')
    }

    if (message.fileAttachments && message.fileAttachments.length > 0) {
      lines.push('Attachments:')
      for (const attachment of message.fileAttachments) {
        lines.push(`- ${attachment.path}`)
      }
      lines.push('')
    }

    if (message.images && message.images.length > 0) {
      lines.push('Images:')
      for (const imageUrl of message.images) {
        lines.push(`- ${imageUrl}`)
      }
      lines.push('')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1')
}

function loadBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = window.localStorage.getItem(key)
  if (v === null) return fallback
  return v === '1'
}

function loadDarkModePref(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(DARK_MODE_KEY)
  if (v === 'light' || v === 'dark') return v
  return 'system'
}

function loadChatWidthPref(): ChatWidthMode {
  if (typeof window === 'undefined') return 'standard'
  const value = window.localStorage.getItem(CHAT_WIDTH_KEY)
  return value === 'standard' || value === 'wide' || value === 'extra-wide' ? value : 'standard'
}

function toggleSendWithEnter(): void {
  sendWithEnter.value = !sendWithEnter.value
  window.localStorage.setItem(SEND_WITH_ENTER_KEY, sendWithEnter.value ? '1' : '0')
}

function cycleDarkMode(): void {
  const order: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark']
  const idx = order.indexOf(darkMode.value)
  darkMode.value = order[(idx + 1) % order.length]
  window.localStorage.setItem(DARK_MODE_KEY, darkMode.value)
  applyDarkMode()
}

function cycleChatWidth(): void {
  const order: ChatWidthMode[] = ['standard', 'wide', 'extra-wide']
  const idx = order.indexOf(chatWidth.value)
  chatWidth.value = order[(idx + 1) % order.length]
  window.localStorage.setItem(CHAT_WIDTH_KEY, chatWidth.value)
}

async function loadCodexAuthStatus(): Promise<void> {
  try {
    const status = await getCodexAuthenticationStatus()
    if (typeof status === 'boolean') codexAuthAvailable.value = status
  } catch (error) {
    accountActionError.value = error instanceof Error ? error.message : 'Unable to read Codex authentication status.'
  }
}

function applyDarkMode(): void {
  const root = document.documentElement
  if (darkMode.value === 'dark') {
    root.classList.add('dark')
  } else if (darkMode.value === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? '1' : '0')
}

function normalizeMessageType(rawType: string | undefined, role: string): string {
  const normalized = (rawType ?? '').trim()
  if (normalized.length > 0) {
    return normalized
  }
  return role.trim() || 'message'
}

function onSelectCollaborationMode(mode: 'default' | 'plan'): void {
  setSelectedCollaborationMode(mode)
}

async function initialize(): Promise<void> {
  await router.isReady()

  if (route.name === 'thread' && routeThreadId.value) {
    primeSelectedThread(routeThreadId.value)
  } else if (route.name === 'home' || route.name === 'skills') {
    primeSelectedThread('', { persist: false })
  }

  await refreshAll({
    includeSelectedThreadMessages: route.name === 'thread',
  })
  await applyLaunchProjectPathFromUrl()
  hasInitialized.value = true
  await routing.syncThreadSelectionWithRoute()
  startPolling()
}

watch(
  () =>
    [
      route.name,
      routeThreadId.value,
      isLoadingThreads.value,
    ] as const,
  async () => {
    if (!hasInitialized.value) return
    await routing.syncThreadSelectionWithRoute()
  },
)

watch(
  () => selectedThreadId.value,
  async (threadId) => {
    if (!hasInitialized.value) return
    if (routing.isRouteSyncInProgress.value) return
    if (isHomeRoute.value || isSkillsRoute.value) return

    if (!threadId) {
      if (route.name !== 'home') {
        await router.replace({ name: 'home', query: newThreadCwd.value ? { cwd: newThreadCwd.value } : {} })
      }
      return
    }

    if (route.name === 'thread' && routeThreadId.value === threadId) return
    await router.replace({ name: 'thread', params: { threadId } })
  },
)

watch(
  pageTitle,
  (value) => {
    if (typeof document === 'undefined') return
    document.title = value
  },
  { immediate: true },
)

watch(isMobile, (mobile) => {
  if (mobile && !isSidebarCollapsed.value) {
    setSidebarCollapsed(true)
  }
}, { immediate: true })

async function onRefreshCodexAuth(): Promise<void> {
  if (isRefreshingCodexAuth.value) return
  isRefreshingCodexAuth.value = true
  accountActionError.value = ''
  try {
    await loadCodexAuthStatus()
    await refreshAll({ includeSelectedThreadMessages: false })
  } catch (error) {
    accountActionError.value = error instanceof Error ? error.message : 'Failed to refresh authentication'
  } finally {
    isRefreshingCodexAuth.value = false
  }
}
async function onLogoutCodex(): Promise<void> {
  if (isCodexAuthChangeBlocked.value || isRefreshingCodexAuth.value) return
  isRefreshingCodexAuth.value = true
  accountActionError.value = ''
  try {
    await logoutCodex()
    codexAuthAvailable.value = false
    await loadCodexAuthStatus()
    await refreshAll({ includeSelectedThreadMessages: false })
  } catch (error) {
    accountActionError.value = error instanceof Error ? error.message : 'Failed to log out'
  } finally {
    isRefreshingCodexAuth.value = false
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-root {
  @apply h-full flex flex-col select-none;
}

.sidebar-root input,
.sidebar-root textarea {
  @apply select-text;
}

.sidebar-scrollable {
  @apply flex-1 min-h-0 overflow-y-auto py-4 px-2 flex flex-col gap-2;
}

.composer-model-notice {
  @apply mx-auto mb-2 max-w-3xl px-4 text-xs text-zinc-600;
}

.content-root {
  @apply h-full min-h-0 min-w-0 w-full flex flex-col overflow-y-hidden overflow-x-hidden bg-white;
}

.content-root.is-virtual-keyboard-open {
  height: var(--visual-viewport-height);
  max-height: var(--visual-viewport-height);
  transform: translateY(var(--visual-viewport-offset-top));
}

.sidebar-thread-controls-host {
  @apply mt-1 -translate-y-px px-2 pb-1;
}

.sidebar-search-toggle {
  @apply h-6.75 w-6.75 rounded-md border border-transparent bg-transparent text-zinc-600 flex items-center justify-center transition hover:border-zinc-200 hover:bg-zinc-50;
}

.sidebar-search-toggle[aria-pressed='true'],
.sidebar-search-toggle.is-active {
  @apply border-zinc-300 bg-zinc-100 text-zinc-700;
}

.sidebar-search-toggle-icon {
  @apply w-4 h-4;
}

.sidebar-search-bar {
  @apply flex items-center gap-1.5 mx-2 px-2 py-1 rounded-md border border-zinc-200 bg-white transition-colors focus-within:border-zinc-400;
}

.sidebar-search-bar-icon {
  @apply w-3.5 h-3.5 text-zinc-400 shrink-0;
}

.sidebar-search-input {
  @apply flex-1 min-w-0 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 outline-none border-none p-0;
}

.sidebar-search-clear {
  @apply w-4 h-4 rounded text-zinc-400 flex items-center justify-center transition hover:text-zinc-600;
}

.sidebar-search-clear-icon {
  @apply w-3.5 h-3.5;
}

.sidebar-skills-link {
  @apply mx-2 flex items-center gap-3 rounded-2xl border border-transparent bg-transparent px-3 py-2.5 text-left text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 cursor-pointer;
}

.sidebar-skills-link.is-active {
  @apply border-transparent bg-zinc-100 text-zinc-950;
}

.sidebar-skills-link-icon {
  @apply flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white;
}

.sidebar-skills-link-icon :deep(svg) {
  @apply h-5 w-5;
}

.sidebar-skills-link-copy {
  @apply flex min-w-0 flex-col;
}

.sidebar-skills-link-title {
  @apply truncate text-sm font-semibold leading-5 tracking-[-0.01em];
}

.sidebar-skills-link-subtitle {
  @apply truncate text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500;
}

.sidebar-thread-controls-header-host {
  @apply ml-1;
}

.skills-route-header-icon {
  @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-[0_16px_32px_-20px_rgba(5,150,105,0.9)];
}

.skills-route-header-icon :deep(svg) {
  @apply h-4.5 w-4.5;
}

:global(:root.dark) .sidebar-skills-link-title {
  @apply text-zinc-50;
}

:global(:root.dark) .sidebar-skills-link-subtitle {
  @apply text-zinc-400;
}

.content-body {
  @apply flex-1 min-h-0 min-w-0 w-full flex flex-col gap-2 sm:gap-3 pt-1 pb-2 sm:pb-4 overflow-x-hidden;
}

.content-root.is-virtual-keyboard-open .content-body {
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
}

.content-root.is-virtual-keyboard-open .content-grid {
  gap: 0.5rem;
}

.content-root.is-virtual-keyboard-open .content-thread {
  min-height: 0;
}

.content-root.is-virtual-keyboard-open .composer-container {
  gap: 0.375rem;
  padding-bottom: max(0.25rem, env(safe-area-inset-bottom));
}

.content-root.is-virtual-keyboard-open .content-keyboard-spacer {
  display: none;
}

.content-error {
  @apply m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700;
}

.content-grid {
  @apply flex-1 min-h-0 flex flex-col gap-3;
}

.content-grid-home {
  @apply overflow-y-auto;
}

.content-thread {
  @apply flex-1 min-h-0;
}

.composer-container {
  @apply w-full shrink-0 px-2 sm:px-6 flex flex-col gap-2;
}

.composer-container.is-disabled {
  opacity: 0.55;
}

.composer-runtime-error {
  @apply flex w-full items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 shadow-sm;
}

.new-thread-empty {
  @apply flex-1 min-h-0 flex flex-col items-center justify-center gap-0.5 px-3 sm:px-6;
}

.new-thread-hero {
  @apply m-0 text-2xl sm:text-[2.5rem] font-normal leading-[1.05] text-zinc-900;
}

.new-thread-folder-dropdown {
  @apply text-2xl sm:text-[2.5rem] text-zinc-500;
}

.new-thread-folder-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-auto p-0 text-2xl sm:text-[2.5rem] leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-value) {
  @apply leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-chevron) {
  @apply h-4 w-4 sm:h-5 sm:w-5 mt-0;
}

.new-thread-folder-selected {
  @apply mt-2 mb-0 max-w-3xl text-center text-xs text-zinc-500 break-all;
}

.new-thread-folder-actions {
  @apply mt-3 flex w-full max-w-3xl flex-wrap items-center justify-center gap-2;
}












.sidebar-settings-area {
  @apply shrink-0 bg-slate-100 pt-2 px-2 pb-2 border-t border-zinc-200;
}

.sidebar-settings-button {
  @apply flex items-center gap-2 w-full rounded-lg border-0 bg-transparent px-2 py-2 text-sm text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 cursor-pointer;
}

.sidebar-settings-icon {
  @apply w-4.5 h-4.5;
}

.sidebar-settings-panel {
  @apply mb-1 max-h-[min(70vh,36rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white;
}

.sidebar-settings-row {
  @apply flex items-center justify-between w-full px-3 py-2.5 text-sm text-zinc-700 border-0 bg-transparent transition hover:bg-zinc-50 cursor-pointer;
}

.sidebar-settings-panel :deep(.sidebar-settings-row + .sidebar-settings-row) {
  @apply border-t border-zinc-100;
}

.sidebar-settings-label {
  @apply text-left;
}

.sidebar-settings-value {
  @apply text-xs text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5;
}

.sidebar-settings-row--input {
  @apply flex flex-col gap-1 py-1.5;
}

.sidebar-settings-error {
  @apply text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 break-words;
}

.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: all 150ms ease;
}

.settings-panel-enter-from,
.settings-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.sidebar-settings-context-row {
  @apply cursor-default;
}

.sidebar-settings-context-value {
  @apply text-xs font-semibold text-zinc-700 text-right;
}

.sidebar-settings-context-value[data-state='ok'] {
  @apply text-emerald-700;
}

.sidebar-settings-context-value[data-state='warning'] {
  @apply text-amber-700;
}

.sidebar-settings-context-value[data-state='danger'] {
  @apply text-rose-700;
}

.sidebar-settings-context-meta {
  @apply block text-[11px] font-normal text-zinc-500;
}

.sidebar-settings-rate-limits {
  @apply border-t border-zinc-200 px-2 pt-2;
}

</style>
