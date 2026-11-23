<template>
  <DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" :is-composer-expanded="isComposerExpanded" @close-sidebar="setSidebarCollapsed(true)">
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
            :new-thread-href="toolbarNewThreadHref"
            @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
            @start-new-thread="onStartNewThreadFromToolbar"
          >
            <button
              ref="sidebarSearchToggleRef"
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
              aria-label="Search sidebar"
              placeholder="Search..."
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
          <div v-if="!isSidebarCollapsed && isSidebarSearchVisible" class="sidebar-search-targets" role="group" aria-label="Search target">
            <button
              v-for="target in sidebarSearchTargets"
              :key="target.scope"
              class="sidebar-search-target"
              type="button"
              :aria-pressed="sidebarSearchScope === target.scope"
              @click="sidebarSearchScope = target.scope"
            >{{ target.label }}</button>
          </div>

          <SidebarThreadTree :groups="projectGroups" :projects="projects" :project-display-name-by-id="projectDisplayNameById"
            :removable-project-ids="nativeProjectIds"
            :resolve-new-thread-cwd="resolveProjectNewThreadCwd"
            :active-project-name="activeProjectName"
            :new-thread-cwd="isHomeRoute ? newThreadCwd : undefined"
            v-if="!isSidebarCollapsed"
            :selected-thread-id="selectedThreadId" :is-loading="isLoadingThreads"
            :is-fork-disabled="isForkOperationPending || isRollingBack"
            :search="sidebarSearch"
            @retry-search="retrySidebarSearch"
            @select="onSelectThread"
            @archive="onArchiveThread" @start-new-thread="onStartNewThread"
            @rename-thread="onRenameThread"
            @fork-thread="onForkThread"
            @remove-project="projectId => runProjectAction(() => removeProject(projectId))"
            @rename-project="({ projectId, name }) => runProjectAction(() => renameProject(projectId, name))"
            @move-project="({ projectId, direction }) => runProjectAction(() => moveProject(projectId, direction))"
            @copy-thread-chat="onCopyThreadChat" />
        </div>

        <div
          v-if="!isSidebarCollapsed"
          ref="settingsAreaRef"
          class="sidebar-settings-area"
        >
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
          'is-composer-expanded': isComposerExpanded,
        }"
        :style="contentStyle"
      >
        <span v-if="isVirtualKeyboardOpen" class="content-keyboard-spacer" aria-hidden="true" />
        <ContentHeader :title="contentTitle" :project-name="contentContextLabel" :accent="isSkillsRoute">
          <template #leading>
            <SidebarThreadControls
              v-if="isSidebarCollapsed || isMobile"
              class="sidebar-thread-controls-header-host"
              :is-sidebar-collapsed="isSidebarCollapsed"
              :new-thread-href="toolbarNewThreadHref"
              @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
              @start-new-thread="onStartNewThreadFromToolbar"
            />
            <span v-if="isSkillsRoute" class="skills-route-header-icon" aria-hidden="true">
              <IconTablerBolt />
            </span>
          </template>
          <template #actions>
            <details v-if="!isHomeRoute && !isSkillsRoute && selectedThreadId" ref="conversationMenuRef" class="conversation-header-menu">
              <summary aria-label="Conversation tools" title="Conversation tools"><IconTablerDots /></summary>
              <div class="conversation-header-menu-body">
                <button type="button" @click="openConversationTools">Conversation tools…</button>
                <button type="button" @click="openContext">Context</button>
                <button type="button" @click="closeConversationMenu();onCopyThreadChat(selectedThreadId)">Copy conversation</button>
                <button type="button" @click="closeConversationMenu();onArchiveThread(selectedThreadId)">Archive conversation</button>
              </div>
            </details>
          </template>
        </ContentHeader>
        <p v-if="nativeDeletion?.state.value==='completed'" class="feature-panel" role="status">{{ nativeDeletion.status.value }}</p>
        <p v-if="modelPreferencesLoading" class="composer-model-notice" role="status">Loading model preferences…</p>
        <p v-if="modelPreferencesError" class="composer-model-notice" role="alert">Model preferences could not be synchronized. {{ modelPreferencesError }} <button type="button" @click="refreshBackendModelPreferences">Retry</button></p>
        <p v-if="modelPreferenceNotice" class="composer-model-notice" role="status">{{ modelPreferenceNotice }}</p>
        <p v-if="nativeForkFailure" class="composer-runtime-error" role="alert">{{ nativeForkFailure }}</p>

        <div v-if="browserConnectionNotice" class="connection-recovery-status" :class="{ 'connection-recovery-success': browserConnectionNotice === 'reconnected' }" role="status" data-connection="browser">
          <strong>WebUI Backend: {{ browserConnectionNotice === 'reconnected' ? 'Reconnected' : 'Disconnected' }}</strong>
          <span v-if="browserConnectionNotice !== 'reconnected'">{{ browserConnectionNotice === 'reconnecting' ? 'Reconnecting…' : 'Waiting for connection…' }}</span>
        </div>
        <div v-if="appServerConnectionNotice" class="connection-recovery-status" :class="{ 'connection-recovery-success': appServerConnectionNotice === 'reconnected' }" role="status" data-connection="app-server">
          <strong>Codex App Server: {{ appServerConnectionNotice === 'reconnected' ? 'Reconnected' : 'Disconnected' }}</strong>
          <span v-if="appServerConnectionNotice !== 'reconnected'">Reconnecting…</span>
        </div>
        <div v-if="selectedRecoveryState || selectedUnknownOutcome || selectedLostApproval" class="connection-recovery-status" :class="{ 'connection-recovery-success': selectedRecoveryState === 'recovered' && !selectedUnknownOutcome && !selectedLostApproval }" role="status" data-connection="subscription">
          <strong v-if="selectedRecoveryState">Thread subscription: {{ ({ recovering: 'Recovering', recovered: 'Recovered', failed: 'Failed', disconnected: 'Disconnected' } as Record<string, string>)[selectedRecoveryState] || selectedRecoveryState }}</strong>
          <button v-if="selectedRecoveryState === 'failed'" type="button" @click="retrySelectedSubscription">{{ ('Retry subscription') }}</button>
          <span v-if="selectedLostApproval">{{ ('The previous approval expired with the connection. Inspect the thread on the server host; only newly delivered approvals can be answered.') }}</span>
          <span v-if="selectedUnknownOutcome">{{ ('Submission outcome unknown. Inspect refreshed history before resending; missing history does not prove failure.') }}</span>
          <button v-if="selectedUnknownOutcome || selectedLostApproval" type="button" @click="reconcileSelectedHistory">{{ ('Refresh history') }}</button>
        </div>
        <section class="content-body">
          <template v-if="isSkillsRoute">
            <div class="skills-management-entry"><button type="button" class="new-thread-folder-action" @click="openConnectorSettings">Manage Apps / Connectors in Settings</button></div>
            <SkillsHub @skills-changed="onSkillsChanged" />
          </template>
          <template v-else-if="isHomeRoute">
            <div class="content-grid content-grid-home">
              <div class="new-thread-empty">
                <p class="new-thread-hero">{{ ("Let's build") }}</p>
                <ComposerDropdown class="new-thread-folder-dropdown" :model-value="newThreadProjectId"
                  :options="newThreadFolderOptions" :placeholder="newThreadFolderName || 'Choose folder'"
                  :trigger-title="newThreadCwd || undefined"
                  :enable-search="true"
                  :search-placeholder="('Quick search project')"
                  :disabled="false" @update:model-value="onSelectNewThreadFolder" />
                <p v-if="newThreadCwd" class="new-thread-folder-selected" :title="newThreadCwd">
                  {{ ('Selected folder') }}: {{ newThreadFolderName || 'No working directory' }}
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
                <ThreadComposer @update:expanded="isComposerExpanded=$event" ref="homeThreadComposerRef" :active-thread-id="composerThreadContextId"
                  :cwd="composerCwd"
                  :submission-pending="pendingComposerSubmissions.has(composerThreadContextId)"
                  :connection-epoch="operationEpoch"
                  :selected-queue-mode="composerSendMode.queue.value"
                  @update:selected-queue-mode="composerSendMode.queue.value=$event"
                  :disabled="modelPreferencesLoading || !newThreadCwd.trim()"
                  :collaboration-modes="availableCollaborationModes"
                  :selected-collaboration-mode="composerCollaborationMode"
                  :models="availableModelIds" :model-provider="parseModelSelection(composerSelectedModelId).provider" :selected-model="composerSelectedModelId"
                  :selected-reasoning-effort="composerReasoningEffort"
                  :reasoning-effort-options="composerReasoningOptions"
                  :selected-speed-mode="selectedSpeedMode"
                  :is-updating-speed-mode="isUpdatingSpeedMode"
                  :skills="installedSkills"
                  :is-turn-in-progress="false"
                  :is-stop-pending="false"
                  :is-interrupting-turn="false" :send-with-enter="sendWithEnter"
                  @open-settings="openConnectorSettings"
                  @submit="onSubmitThreadMessage"
                  @update:selected-collaboration-mode="onSelectCollaborationMode"
                  @update:selected-model="onSelectModel"
                  @update:selected-reasoning-effort="onSelectReasoningEffort"
                  @update:selected-speed-mode="onSelectSpeedMode" />
              </div>
            </div>
          </template>
          <template v-else>
            <div class="content-grid" :class="{ 'has-pending-request': selectedThreadPendingRequest }">
              <div class="content-thread">
                <ThreadConversation ref="threadConversationRef" :messages="filteredMessages" :is-loading="isLoadingMessages"
                  :active-thread-id="composerThreadContextId" :cwd="composerCwd"
                  :live-overlay="liveOverlay"
                  :is-revert-disabled="isForkOperationPending || isRollingBack || isSelectedThreadInProgress || compaction.selectedBusy.value || review.selectedBusy.value"
                  :is-fork-disabled="isForkOperationPending || isRollingBack"
                  :pending-requests="selectedThreadLiveRequests"
                  :pending-question="selectedThreadPendingQuestion"
                  :question-draft="selectedThreadPendingQuestion ? readQuestionDraft(selectedThreadPendingQuestion) : undefined"
                  :question-responses="selectedQuestionResponses"
                  @dismiss-question-draft="dismissQuestionDraft"
                  @update-question-draft="onUpdateQuestionDraft"
                  :has-more-persisted-above="hasMoreOlderMessages"
                  :is-loading-persisted-above="isLoadingOlderMessages"
                  :load-earlier-messages="loadOlderMessages"
                  @fork-thread="onForkThreadFromMessage"
                  @rollback="onRollback"
                  @implement-plan="onImplementPlan"
                  @respond-server-request="onRespondServerRequest" />
              </div>

              <div class="composer-container">
                <ThreadGoalPanel
                  ref="threadGoalPanelRef"
                  :thread-id="selectedThreadId"
                  :goal="threadGoal"
                  :load-error="selectedThreadGoal.loadError.value"
                  :save-goal="selectedThreadGoal.save"
                />
                <div v-if="threadGoal && showGoalOutsideComposer" class="thread-composer-active-mode">
                  <ThreadGoalSummary :goal="threadGoal" @click="threadGoalPanelRef?.edit()" />
                </div>
                <ThreadPendingRequestPanel
                  v-if="selectedThreadPendingRequest && selectedThreadPendingRequest.method !== QUESTION_REQUEST"
                  :request="selectedThreadPendingRequest"
                  :request-count="selectedThreadLiveRequests.length"
                  @respond-server-request="onRespondServerRequest"
                />
                <p v-if="questionSaveWarning" class="composer-runtime-error" role="alert">{{ questionSaveWarning }}</p>
                <p v-if="modelSelectionNotice" class="composer-model-notice" role="status">{{ (modelSelectionNotice) }}</p>
                <ThreadComposer
                  @update:expanded="isComposerExpanded=$event"
                  v-show="!selectedThreadPendingRequest"
                  ref="threadComposerRef"
                  :has-pending-request="!!selectedThreadPendingRequest"
                  :disabled="nativeDeletion?.selectedBlocking.value || isSelectedThreadImportIncomplete || compaction.selectedBusy.value || review.selectedBusy.value || permissionChanges.blocking.value"
                  :active-thread-id="composerThreadContextId"
                  :submission-pending="pendingComposerSubmissions.has(composerThreadContextId)"
                  :queue-ready="nativeQueue.available.value"
                  :cwd="composerCwd"
                  :selected-queue-mode="composerSendMode.queue.value"
                  @update:selected-queue-mode="composerSendMode.queue.value=$event"
                  :connection-epoch="operationEpoch"
                  :collaboration-modes="availableCollaborationModes"
                  :selected-collaboration-mode="composerCollaborationMode"
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
                  @open-settings="openConnectorSettings"
                  @submit="onSubmitThreadMessage" @update:selected-model="onSelectModel"
                  @update:selected-reasoning-effort="onSelectReasoningEffort"
                  @update:selected-speed-mode="onSelectSpeedMode"
                  @edit-goal="threadGoalPanelRef?.edit()"
                  @interrupt="onInterruptTurn"
                >
                  <template v-if="threadGoal && !showGoalOutsideComposer && !isComposerExpanded" #goal>
                    <ThreadGoalSummary :goal="threadGoal" @click="threadGoalPanelRef?.edit()" />
                  </template>
                </ThreadComposer>
                <p v-if="composerSendMode.queue.value && (nativeQueue.readError.value || nativeQueue.uncertain.value || nativeQueue.recoveryError.value)" class="composer-runtime-error composer-queue-notice" role="alert">
                  {{ nativeQueue.readError.value || nativeQueue.uncertain.value || nativeQueue.recoveryError.value }}
                  <button type="button" @click="openNativeQueue">Inspect native prompt queue</button>
                </p>
              </div>
            </div>
          </template>
        </section>
      </section>
    </template>
  </DesktopLayout>
  <ManagementDialog :open="isConversationToolsOpen" title="Conversation tools" @close="isConversationToolsOpen=false">
                  <ConversationTools v-if="areConversationToolsLoaded" :thread-id="selectedThreadId"
                    @vue:mounted="revealNativeQueue"
                    :security="securityObservation.snapshots.value[selectedThreadId] ?? null"
                    :denied-actions="deniedActions.rows.value"
                    :queue="nativeQueue"
                    :permission-changes="permissionChanges"
                    :deletion="nativeDeletion" :ensure-deletion="ensureNativeDeletion" :has-draft="()=>threadComposerRef?.hasUnsavedDraft()??false"
                    :epoch="operationEpoch" :messages="messages" :compaction="compaction" :review="review"
                    :in-progress="isSelectedThreadInProgress || isRollingBack" :sending="isSendingMessage || permissionChanges.blocking.value" :incomplete="isSelectedThreadImportIncomplete"
                    :disconnected="transportState === 'disconnected'" :interrupting="isInterruptingTurn" />
  </ManagementDialog>
  <ManagementDialog :open="isContextOpen" title="Context" @close="isContextOpen=false">
    <section v-if="showThreadContextBadge" class="thread-context-details feature-panel" aria-label="Conversation context usage">
      <div class="thread-context-summary" :data-state="threadContextBadgeState" :title="threadContextTooltip">
        <span>Context</span>
        <span class="thread-context-value" :data-state="threadContextBadgeState">
          {{ threadContextPrimaryText }}
          <span class="thread-context-meta">{{ threadContextSecondaryText }}</span>
        </span>
      </div>
      <p class="thread-context-breakdown">{{ threadContextTooltip }}</p>
    </section>
  </ManagementDialog>
  <ManagementDialog :open="isSettingsOpen" title="Settings" @close="isSettingsOpen=false">
    <div class="settings-layout">
      <nav class="settings-categories" aria-label="Settings categories">
        <button v-for="category in settingsCategories" :key="category" type="button" :aria-current="settingsCategory===category ? 'page' : undefined" @click="settingsCategory=category">{{ category }}<span v-if="category === 'General' && recoverableDraftCount" class="draft-recovery-count">{{ recoverableDraftCount }} {{ recoverableDraftCount === 1 ? 'draft' : 'drafts' }}</span></button>
      </nav>
      <div class="settings-content">
        <section v-if="settingsLoaded" v-show="settingsCategory==='Codex account'" aria-label="Codex account">
              <AccountSettingsPanel :epoch="accountUsageEpoch"
                :auth="accountSettings"
                :change-blocked="nativeAccountChangeBlocked || transportState === 'disconnected'"
              />
        </section>
        <section v-show="settingsCategory==='General'" aria-label="General preferences">
              <GeneralPreferencesSettings
                :send-with-enter="sendWithEnter"
                :dark-mode="darkMode"
                :chat-width-label="chatWidthLabel"
                :help="SETTINGS_HELP"
                @toggle-send-with-enter="toggleSendWithEnter"
                @cycle-dark-mode="cycleDarkMode"
                @cycle-chat-width="cycleChatWidth"
              />
              <DraftRecoverySettings v-if="isSettingsOpen" :key="composerThreadContextId"
                :thread-id="composerThreadContextId" :disabled="!activeDraftComposer"
                :recover-draft="payload => activeDraftComposer?.recoverDraft(payload) ?? false"
                @count="recoverableDraftCount=$event"
              />
              <div class="sidebar-settings-rate-limits">
                <RateLimitStatus :snapshots="accountRateLimitSnapshots" />
              </div>
        </section>
        <section v-if="connectorsLoaded" v-show="settingsCategory==='Apps / Connectors'" aria-label="Apps / Connectors">
          <SkillsMcpHub :epoch="operationEpoch" />
        </section>
        <ArchivedThreads v-show="settingsCategory==='Archived conversations'"
          :active="isSettingsOpen && settingsCategory==='Archived conversations'"
          :epoch="operationEpoch" :restore="restoreThreadById" />
        <AboutSettings v-if="settingsCategory==='About'" />
      </div>
    </div>
  </ManagementDialog>
  <div v-if="transferPicker" class="transfer-picker-backdrop" role="presentation">
    <section class="transfer-picker" role="dialog" aria-modal="true" aria-label="Transfer conversation">
      <h2>{{ transferPicker.revertTarget ? 'Portable Fork and Revert' : 'Portable Fork' }}</h2>
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
import { readUiPreference, writeUiPreference } from './utils/browserUiStorage'

import { createComposerSendMode } from './composables/composerSendMode'
import { createAppRouteCoordinator } from './appRouteCoordinator'
import { createAppTransferDialog } from './appTransferDialog'


import { parseModelSelection } from './api/modelCapabilities'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNewThreadCwdRoute } from './composables/useNewThreadCwdRoute'
import { useThreadTabIndicator } from './composables/useThreadTabIndicator'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import GeneralPreferencesSettings from './components/sidebar/GeneralPreferencesSettings.vue'
import AboutSettings from './components/sidebar/AboutSettings.vue'
import DraftRecoverySettings from './components/sidebar/DraftRecoverySettings.vue'
import ManagementDialog from './components/shared/ManagementDialog.vue'
import ArchivedThreads from './components/sidebar/ArchivedThreads.vue'
import AccountSettingsPanel from './components/sidebar/AccountSettingsPanel.vue'
import SidebarThreadTree from './components/sidebar/SidebarThreadTree.vue'
import type { SidebarSearch, SidebarSearchScope } from './components/sidebar/sidebarSearch'
import { newThreadRoute, sidebarHref, threadRoute, type NewThreadTarget } from './router/sidebarRoutes'
import ContentHeader from './components/content/ContentHeader.vue'
import FolderPickerModal from './components/content/FolderPickerModal.vue'
import ThreadGoalPanel from './components/content/ThreadGoalPanel.vue'
import ThreadGoalSummary from './components/content/ThreadGoalSummary.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import ThreadPendingRequestPanel from './components/content/ThreadPendingRequestPanel.vue'
import RateLimitStatus from './components/content/RateLimitStatus.vue'
import ComposerDropdown from './components/content/ComposerDropdown.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import IconTablerBolt from './components/icons/IconTablerBolt.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerSettings from './components/icons/IconTablerSettings.vue'
import IconTablerDots from './components/icons/IconTablerDots.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import { useDesktopState } from './composables/useDesktopState'
import { useFolderPicker } from './composables/useFolderPicker'
import { useMobile } from './composables/useMobile'
import { useSidebarMessageSearch } from './composables/useSidebarMessageSearch'
import { getHomeDirectory } from './api/codexGateway'
import { QUESTION_REQUEST } from './serverRequestMethod'
import type { ReasoningEffort, SpeedMode, UiServerRequest, UiServerRequestReply, UiThreadTokenUsage } from './types/codex'
import type { SubmitPayload, ThreadComposerExposed } from './components/content/ThreadComposer.vue'
import { normalizePathForUi } from './pathUtils.js'
import { formatChatPageTitle, getChatFolderName, getThreadContextLabel } from './utils/chatFolderLabels'
import { copyTextToClipboard } from './utils/clipboard'

const ConversationTools = defineAsyncComponent(() => import('./components/content/ConversationTools.vue'))
const areConversationToolsLoaded = ref(false)
const isConversationToolsOpen = ref(false)
const isContextOpen = ref(false)
let queueInspectionTarget: { threadId: string; epoch: number } | undefined
function openContext() {
  closeConversationMenu()
  isContextOpen.value = true
}
const conversationMenuRef = ref<HTMLDetailsElement | null>(null)
function closeConversationMenu() { if (conversationMenuRef.value) conversationMenuRef.value.open = false }
function openConversationTools() {
  queueInspectionTarget = undefined
  closeConversationMenu()
  areConversationToolsLoaded.value = true
  isConversationToolsOpen.value = true
}
const ThreadConversation = defineAsyncComponent(() => import('./components/content/ThreadConversation.vue'))
const SkillsHub = defineAsyncComponent(() => import('./components/content/SkillsHub.vue'))
const SkillsMcpHub = defineAsyncComponent(() => import('./components/content/SkillsMcpHub.vue'))

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'codex-web-local.sidebar-collapsed.v1'
const SETTINGS_HELP = {
  sendWithEnter: ('In the normal view, use Ctrl+Enter or Command+Enter to send when this setting is on. When it is off, Enter sends. In full screen, Enter inserts a line break.'),
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
  projectDisplayNameById, projects,
  selectedThread,
  selectedThreadWorkspace,
  selectedThreadGoal,
  selectedThreadTokenUsage,
  selectedThreadServerRequests,
  selectedQuestionResponses,
  readQuestionDraft,
  updateQuestionDraft,
  questionSaveWarning,
  dismissQuestionDraft,
  selectedLiveOverlay,
  selectedThreadId,
  availableCollaborationModes,
  availableModelIds,
  selectedSpeedMode,
  installedSkills,
  accountRateLimitSnapshots,
  messages,
  hasMoreOlderMessages,
  isLoadingThreads,
  isThreadListFullyLoaded,
  threadListError,
  isThreadListPagingPaused,
  setThreadListSearchActive,
  retryThreadListSearch,
  isLoadingProjects,
  projectListError,
  retryProjectList,
  isLoadingMessages,
  isLoadingOlderMessages,
  isSendingMessage,
  isInterruptingTurn,
  isSelectedThreadInterruptPending,
  isUpdatingSpeedMode,
  browserConnectionNotice, appServerConnectionNotice,
  transportState, selectedRecoveryState, selectedUnknownOutcome, selectedLostApproval,
  retrySelectedSubscription, reconcileSelectedHistory,
  error: desktopError,
  modelSelectionNotice,
  restoreNewConversationPreferences,
  modelPreferenceNotice,
  modelPreferencesLoading,
  modelPreferencesError,
  refreshBackendModelPreferences,
  refreshAll,
  selectProjectFolder,
  renameProject,
  moveProject,
  refreshSkills,
  selectThread,
  ensureThreadMessagesLoaded,
  loadOlderMessages,
  archiveThreadById,
  restoreThreadById,
  operationEpoch,
  securityObservation,
  deniedActions,
  nativeQueue,
  permissionChanges,
  accountSettings, accountUsageEpoch, nativeAccountChangeBlocked,
  nativeDeletion,ensureNativeDeletion,
  compaction, review,
  forkThreadById,
  forkNativeThreadById,
  renameThreadById,
  sendMessageToSelectedThread,
  sendMessageToNewThread,
  interruptSelectedThreadTurn,
  setSelectedCollaborationMode,
  setSelectedCollaborationModeForThread,
  resetSubmittedPlanMode,
  readCollaborationModeForThread,
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
} = useDesktopState({ onSelectedThreadAttention: (threadId, occurredAt) => markBackgroundThread(threadId, occurredAt) })

const route = useRoute()
const router = useRouter()
const { isMobile } = useMobile()
const isComposerExpanded = ref(false)
const pendingComposerSubmissions = reactive(new Set<string>())
const homeThreadComposerRef = ref<ThreadComposerExposed | null>(null)
const threadGoalPanelRef = ref<InstanceType<typeof ThreadGoalPanel> | null>(null)
const threadComposerRef = ref<ThreadComposerExposed | null>(null)
const threadGoal = selectedThreadGoal.goal
const showGoalOutsideComposer = computed(() => threadComposerRef.value?.isCollapsed || !!selectedThreadPendingRequest.value)
const threadConversationRef = ref<{ jumpToLatest: () => void } | null>(null)
const routing = createAppRouteCoordinator({
  get selectedThreadId() { return selectedThreadId; },
  get selectThread() { return selectThread; },
  get routeThreadId() { return routeThreadId; },
  get ensureThreadMessagesLoaded() { return ensureThreadMessagesLoaded; },
  get newThreadCwd() { return newThreadCwd; },
  get desktopError() { return desktopError; },
  get sendMessageToNewThread() { return sendMessageToNewThread; },
  get newThreadProjectId() { return newThreadProjectId; },
  onThreadCreated: threadId => composerSendMode.created(threadId),
  get router() { return router; },
  get scheduleMobileConversationJumpToLatest() { return scheduleMobileConversationJumpToLatest; }
})
const hasInitialized = ref(false)
const newThreadCwd = ref('')
const newThreadFolderName = computed(() => getChatFolderName(newThreadCwd.value))
const newThreadProjectId = computed(() => typeof route.query.projectId === 'string' ? route.query.projectId : '')
useNewThreadCwdRoute(router, newThreadCwd)
const isSidebarCollapsed = ref(loadSidebarCollapsed())
const sidebarSearchQuery = ref('')
const isSidebarSearchVisible = ref(false)
const sidebarSearchScope = ref<SidebarSearchScope>('content')
const sidebarSearchTargets: { label: string; scope: SidebarSearchScope }[] = [
  { label: 'Messages', scope: 'content' },
  { label: 'Thread Name', scope: 'thread-title' },
  { label: 'Project', scope: 'project' },
  { label: 'Folder', scope: 'folder' },
]
const sidebarScrollableRef = ref<HTMLElement | null>(null)
const sidebarSearchInputRef = ref<HTMLInputElement | null>(null)
const sidebarSearchToggleRef = ref<HTMLButtonElement | null>(null)
const settingsAreaRef = ref<HTMLElement | null>(null)
const settingsButtonRef = ref<HTMLElement | null>(null)
const activeSidebarSearchTerm = computed(() =>
  isSidebarSearchVisible.value && !isSidebarCollapsed.value && !isComposerExpanded.value ? sidebarSearchQuery.value.trim() : '')
const messageSearch = useSidebarMessageSearch(computed(() =>
  sidebarSearchScope.value === 'content' ? activeSidebarSearchTerm.value : ''))
const searchesThreadList = computed(() => Boolean(activeSidebarSearchTerm.value)
  && (sidebarSearchScope.value === 'thread-title' || sidebarSearchScope.value === 'folder'))
const searchesProjectList = computed(() => sidebarSearchScope.value === 'project' || sidebarSearchScope.value === 'folder')
watch(searchesThreadList, setThreadListSearchActive)

const sidebarSearch = computed<SidebarSearch | null>(() => {
  const query = activeSidebarSearchTerm.value
  if (!query) return null
  const scope = sidebarSearchScope.value
  if (scope === 'content') {
    return {
      scope, query, threads: messageSearch.threads.value, error: messageSearch.error.value,
      pending: messageSearch.pending.value ? 'Searching messages…' : undefined,
    }
  }

  const projectError = searchesProjectList.value ? projectListError.value : ''
  const threadError = searchesThreadList.value ? threadListError.value : ''
  const error = [projectError && `Could not load projects. ${projectError}`,
    threadError && `Could not load threads. ${threadError}`].filter(Boolean).join(' ')
  let pending: string | undefined
  if (searchesThreadList.value && !isThreadListFullyLoaded.value) {
    pending = isThreadListPagingPaused.value ? 'Waiting for responses to finish…' : 'Loading more threads…'
  } else if (searchesProjectList.value && isLoadingProjects.value) {
    pending = 'Loading projects…'
  }
  return { scope, query, error, pending, canRetry: Boolean(error) }
})

function retrySidebarSearch(): void {
  if (searchesThreadList.value && threadListError.value) retryThreadListSearch()
  if (searchesProjectList.value && projectListError.value) void retryProjectList()
}

let sidebarScrollTop = 0
let sidebarScrollRestoreRequestId = 0
let isRestoringSidebarScroll = false
const isSettingsOpen = ref(false)
const recoverableDraftCount = ref(0)
const settingsCategories = ['General', 'Codex account', 'Apps / Connectors', 'Archived conversations', 'About']
const settingsCategory = ref('Codex account')
const settingsLoaded = ref(false)
const connectorsLoaded = ref(false)
function openConnectorSettings() { connectorsLoaded.value = true; settingsCategory.value = 'Apps / Connectors'; isSettingsOpen.value = true }
watch(settingsCategory, category => { if (category === 'Apps / Connectors') connectorsLoaded.value = true })
watch(isSettingsOpen, open => { if (open) settingsLoaded.value = true })
watch(() => isSettingsOpen.value && settingsCategory.value === 'Codex account', accountSettings.setActive)
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
const contentContextLabel = computed(() => {
  if (isHomeRoute.value || isSkillsRoute.value) return ''
  return getThreadContextLabel(selectedThread.value, projectDisplayNameById.value)
})
const { markBackgroundThread } = useThreadTabIndicator(
  () => route.name === 'thread' ? routeThreadId.value : null,
  computed(() => formatChatPageTitle(selectedThread.value?.title, contentContextLabel.value)),
)
const filteredMessages = computed(() =>
  messages.value.filter((message) => {
    const type = normalizeMessageType(message.messageType, message.role)
    if (type === 'worked') return true
    if (type === 'turnActivity.live' || type === 'turnError.live' || type === 'agentReasoning.live') return false
    return true
  }),
)
const liveOverlay = computed(() => selectedLiveOverlay.value)
watch(selectedThreadId, () => {
  queueInspectionTarget = undefined
  isConversationToolsOpen.value = false
  isContextOpen.value = false
  closeConversationMenu()
}, { flush: 'sync' })
watch(isHomeRoute, (home, previous) => { if (home && !previous) restoreNewConversationPreferences() })
const composerThreadContextId = computed(() => (isHomeRoute.value ? '__new-thread__' : selectedThreadId.value))
const activeDraftComposer = computed(() => isHomeRoute.value ? homeThreadComposerRef.value : threadComposerRef.value)
const composerSendMode = createComposerSendMode(composerThreadContextId)
watch([composerSendMode.queue, composerThreadContextId, operationEpoch, transportState], () => {
  if (composerSendMode.queue.value && !isHomeRoute.value && selectedThreadId.value && !nativeQueue.loaded.value) void nativeQueue.refresh()
})
const composerReasoningEffort = computed(() => readReasoningEffortForThread(composerThreadContextId.value))
const composerReasoningOptions = computed(() => readReasoningOptionsForThread(composerThreadContextId.value))
const composerCollaborationMode = computed(() => readCollaborationModeForThread(composerThreadContextId.value))
const composerSelectedModelId = computed(() => readModelIdForThread(composerThreadContextId.value))
// The question still blocks the composer until Codex closes the request.
const selectedThreadLiveRequests = computed(() => selectedThreadServerRequests.value.filter(request => !request.questionClosed))
const selectedThreadPendingRequest = computed<UiServerRequest | null>(() => selectedThreadLiveRequests.value.at(-1) ?? null)
const selectedThreadPendingQuestion = computed(() => {
  const request = selectedThreadPendingRequest.value
  const question = request?.method === QUESTION_REQUEST
    ? request
    : selectedThreadServerRequests.value.filter(row => row.questionClosed).at(-1)
  if (!question) return null

  const attempt = readQuestionDraft(question)?.attempt
  const isConfirming = attempt ? !attempt.error : !question.questionClosed && question.answerAttempted
  return isConfirming ? null : question
})
function onUpdateQuestionDraft(questionId: string, field: 'choice' | 'text', value: string): void {
  const request = selectedThreadPendingQuestion.value
  if (request) updateQuestionDraft(request, questionId, field, value)
}
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

const newThreadFolderOptions = computed(() => projects.value.map(project => ({ value: project.id, label: project.name })))
const nativeProjectIds = computed(() => projects.value.map(project => project.id))
const projectRootById = computed(() => new Map(projects.value.map(project => [project.id, project.roots[0]?.path ?? ''])))
const projectFallbackCwdById = computed(() => new Map(projectGroups.value.map(group => [
  group.projectName, group.threads.find(thread => thread.cwd?.trim())?.cwd?.trim() ?? '',
])))

const toolbarNewThreadTarget = computed<NewThreadTarget>(() => {
  if (isHomeRoute.value) return { cwd: newThreadCwd.value, projectId: newThreadProjectId.value }
  const workspace = selectedThreadWorkspace.value
  if (!workspace || selectedThreadId.value !== routeThreadId.value) return { cwd: '' }

  const projectId = workspace.projectId || undefined
  const cwd = (projectId && projectRootById.value.get(projectId)) || workspace.cwd.trim()
  return { cwd, projectId }
})
const toolbarNewThreadHref = computed(() => sidebarHref(router, newThreadRoute(toolbarNewThreadTarget.value)))
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
  window.addEventListener('storage', onUiPreferenceStorage)
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('resize', updateVisualViewportState)
  window.visualViewport?.addEventListener('resize', updateVisualViewportState)
  window.visualViewport?.addEventListener('scroll', updateVisualViewportState)
  updateVisualViewportState()
  applyDarkMode()
  darkModeMediaQuery?.addEventListener('change', applyDarkMode)
  void initialize()
})

onUnmounted(() => {
  window.removeEventListener('storage', onUiPreferenceStorage)
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('resize', updateVisualViewportState)
  window.visualViewport?.removeEventListener('resize', updateVisualViewportState)
  window.visualViewport?.removeEventListener('scroll', updateVisualViewportState)
  darkModeMediaQuery?.removeEventListener('change', applyDarkMode)
  stopPolling()
})

function updateVisualViewportState(): void {
  if (typeof window === 'undefined') return
  layoutViewportHeight.value = Math.max(layoutViewportHeight.value, window.innerHeight)
  visualViewportHeight.value = window.visualViewport?.height ?? window.innerHeight
  visualViewportOffsetTop.value = window.visualViewport?.offsetTop ?? 0
}

function onSkillsChanged(): void {
  void refreshSkills({ force: true })
}

function toggleSidebarSearch(): void {
  if (isSidebarSearchVisible.value) {
    closeSidebarSearch()
    return
  }
  sidebarSearchScope.value = 'content'
  isSidebarSearchVisible.value = true
  void nextTick(() => sidebarSearchInputRef.value?.focus())
}

function closeSidebarSearch(): void {
  isSidebarSearchVisible.value = false
  sidebarSearchQuery.value = ''
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

function onSidebarSearchEscape(event: KeyboardEvent): void {
  if (!isSidebarSearchVisible.value || isComposerExpanded.value || event.isComposing) return
  event.preventDefault()
  closeSidebarSearch()
  void nextTick(() => sidebarSearchToggleRef.value?.focus())
}

function onSelectThread(threadId: string): void {
  if (!threadId) return
  if (isMobile.value) setSidebarCollapsed(true)
  if (route.name === 'thread' && routeThreadId.value === threadId) return
  void router.push(threadRoute(threadId))
}

function onArchiveThread(threadId: string): void {
  void archiveThreadById(threadId)
}

const transfers = createAppTransferDialog({
  get messages() { return messages; },
  get selectedThreadId() { return selectedThreadId; },
  get composerSelectedModelId() { return composerSelectedModelId; },
  get forkThreadById() { return forkThreadById; },
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

function resolveProjectNewThreadCwd(projectId: string): string {
  return projectRootById.value.get(projectId) || projectFallbackCwdById.value.get(projectId) || ''
}

function onStartNewThread(target: NewThreadTarget): void {
  if (isHomeRoute.value) restoreNewConversationPreferences()
  composerSendMode.reset()
  if (isMobile.value) setSidebarCollapsed(true)
  void router.push(newThreadRoute(target))
}

function onStartNewThreadFromToolbar(): void {
  onStartNewThread(toolbarNewThreadTarget.value)
}

function onRenameThread(payload: { threadId: string; title: string }): void {
  void renameThreadById(payload.threadId, payload.title)
}

async function runProjectAction(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (error) {
    desktopError.value = error instanceof Error ? error.message : 'Failed to update project.'
  }
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
    closeSidebarSearch()
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
  if (event.key === 'Escape') {
    if (isSettingsOpen.value) isSettingsOpen.value = false
    else onSidebarSearchEscape(event)
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

function openNativeQueue() {
  openConversationTools()
  queueInspectionTarget = { threadId: selectedThreadId.value, epoch: operationEpoch.value }
  void nextTick(revealNativeQueue)
}

async function revealNativeQueue() {
  const target = queueInspectionTarget
  if (!target || !isConversationToolsOpen.value
    || target.threadId !== selectedThreadId.value || target.epoch !== operationEpoch.value) return
  const panel = document.getElementById('native-prompt-queue') as HTMLDetailsElement | null
  // On first use, the mounted callback retries once the lazy panel exists.
  if (!panel) return
  queueInspectionTarget = undefined
  panel.open = true
  await nextTick()
  if (!isConversationToolsOpen.value
    || target.threadId !== selectedThreadId.value || target.epoch !== operationEpoch.value) return
  panel.scrollIntoView({ block: 'nearest' })
  await nativeQueue.refresh()
}

function onSubmitThreadMessage(
  payload: SubmitPayload,
  onSettled: (accepted: boolean) => void,
): void {
  const submittedContext = composerThreadContextId.value
  if (pendingComposerSubmissions.has(submittedContext)) {
    onSettled(false)
    return
  }
  pendingComposerSubmissions.add(submittedContext)
  const settle = (accepted: boolean) => {
    pendingComposerSubmissions.delete(submittedContext)
    onSettled(accepted)
  }
  scheduleMobileConversationJumpToLatest()
  if (isHomeRoute.value && !payload.queue) {
    void routing.submitFirstMessageForNewThread(payload.text, payload.imageUrls, payload.skills, payload.fileAttachments, () => settle(true))
      .then(accepted => { if (!accepted) settle(false) })
    return
  }
  const submittedMode = composerCollaborationMode.value
  const submittedEpoch = operationEpoch.value
  const submission = payload.queue
    ? isHomeRoute.value ? Promise.reject(new Error('Select an existing native thread before queuing')) : nativeQueue.add(payload)
    : sendMessageToSelectedThread(payload.text, payload.imageUrls, payload.skills, payload.fileAttachments, undefined, payload.apps)
  void submission.then(accepted => {
    if (accepted && payload.queue && submittedMode === 'plan' && submittedEpoch === operationEpoch.value) {
      resetSubmittedPlanMode(submittedContext)
    }
    settle(accepted)
  }, failure => {
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

function onSelectNewThreadFolder(projectId: string): void {
  const cwd = projectRootById.value.get(projectId)
  if (cwd === undefined) return
  void router.replace({ name: 'home', query: { ...route.query, cwd, projectId } })
}

async function onConfirmExistingFolder(path = resolvedExistingFolderPath.value): Promise<void> {
  const targetPath = normalizePathForUi(path).trim()
  if (!targetPath) return

  existingFolderError.value = ''
  isOpeningExistingFolder.value = true
  try {
    const project = await selectProjectFolder(targetPath)
    await router.replace({ name: 'home', query: { cwd: targetPath, projectId: project.id } })
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
    const path = normalizePathForUi(launchProjectPath)
    const project = await selectProjectFolder(path)
    await router.replace({ name: 'home', query: { cwd: path, projectId: project.id } })
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
  const preferredRoot = projects.value.find(project => project.roots.length)?.roots[0]?.path || ''
  if (preferredRoot) return preferredRoot
  try {
    return await getHomeDirectory()
  } catch {
    return ''
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

async function onRollback(payload: { threadId: string; turnId: string; operation: import('./types/codex').RevertOperation; messageId?: string }): Promise<void> {
  if (isForkOperationPending.value || isRollingBack.value) return
  if (payload.operation === 'portable-fork-and-revert') {
    if (payload.messageId) await openTransferPicker(payload.threadId, undefined, { turnId: payload.turnId, messageId: payload.messageId })
    return
  }
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

function onImplementPlan(): void {
  if (isHomeRoute.value || !selectedThreadId.value) return
  setSelectedCollaborationMode('default')
  scheduleMobileConversationJumpToLatest()
  void sendMessageToSelectedThread('Implement', [], [], [], 'default').catch(failure => {
    desktopError.value = failure instanceof Error ? failure.message : String(failure)
  })
}

async function onCopyThreadChat(threadId: string): Promise<void> {
  const thread = selectedThread.value
  if (isHomeRoute.value || isSkillsRoute.value || !thread || thread.id !== threadId || filteredMessages.value.length === 0) return
  const markdown = buildThreadMarkdown(thread.title, thread.id)
  try {
    await copyTextToClipboard(markdown)
  } catch {
    // Clipboard writes can be blocked by browser permissions; keep the menu action best-effort.
  }
}

function buildThreadMarkdown(title: string, threadId: string): string {
  const lines: string[] = []
  const threadTitle = title.trim() || 'Untitled thread'
  lines.push(`# ${escapeMarkdownText(threadTitle)}`)
  lines.push('')
  lines.push(`- Exported: ${new Date().toISOString()}`)
  lines.push(`- Thread ID: ${threadId}`)
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

function onUiPreferenceStorage(event: StorageEvent): void {
  if (event.key === SEND_WITH_ENTER_KEY) sendWithEnter.value = loadBoolPref(SEND_WITH_ENTER_KEY, true)
  if (event.key === DARK_MODE_KEY) { darkMode.value = loadDarkModePref(); applyDarkMode() }
  if (event.key === CHAT_WIDTH_KEY) chatWidth.value = loadChatWidthPref()
  if (event.key === SIDEBAR_COLLAPSED_STORAGE_KEY) isSidebarCollapsed.value = loadSidebarCollapsed()
}

function loadBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = readUiPreference(key)
  if (v === null) return fallback
  return v === '1'
}

function loadDarkModePref(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  const v = readUiPreference(DARK_MODE_KEY)
  if (v === 'light' || v === 'dark') return v
  return 'system'
}

function loadChatWidthPref(): ChatWidthMode {
  if (typeof window === 'undefined') return 'standard'
  const value = readUiPreference(CHAT_WIDTH_KEY)
  return value === 'standard' || value === 'wide' || value === 'extra-wide' ? value : 'standard'
}

function toggleSendWithEnter(): void {
  sendWithEnter.value = !sendWithEnter.value
  writeUiPreference(SEND_WITH_ENTER_KEY, sendWithEnter.value ? '1' : '0')
}

function cycleDarkMode(): void {
  const order: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark']
  const idx = order.indexOf(darkMode.value)
  darkMode.value = order[(idx + 1) % order.length]
  writeUiPreference(DARK_MODE_KEY, darkMode.value)
  applyDarkMode()
}

function cycleChatWidth(): void {
  const order: ChatWidthMode[] = ['standard', 'wide', 'extra-wide']
  const idx = order.indexOf(chatWidth.value)
  chatWidth.value = order[(idx + 1) % order.length]
  writeUiPreference(CHAT_WIDTH_KEY, chatWidth.value)
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
  return readUiPreference(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  writeUiPreference(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? '1' : '0')
}

function normalizeMessageType(rawType: string | undefined, role: string): string {
  const normalized = (rawType ?? '').trim()
  if (normalized.length > 0) {
    return normalized
  }
  return role.trim() || 'message'
}

function onSelectCollaborationMode(mode: 'default' | 'plan'): void {
  setSelectedCollaborationModeForThread(composerThreadContextId.value, mode)
}

async function initialize(): Promise<void> {
  await router.isReady()

  if (route.name === 'thread' && routeThreadId.value) {
    primeSelectedThread(routeThreadId.value)
  } else if (route.name === 'home' || route.name === 'skills') {
    primeSelectedThread('')
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

watch(()=>nativeDeletion.value?.state.value,state=>{
  if(state==='completed'&&route.name==='thread'&&routeThreadId.value===nativeDeletion.value?.thread.value)void router.replace({name:'home'})
})

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

watch(isMobile, (mobile) => {
  if (mobile && !isSidebarCollapsed.value) {
    setSidebarCollapsed(true)
  }
}, { immediate: true })

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

.sidebar-search-targets {
  @apply mx-2 flex flex-wrap gap-1;
}

.sidebar-search-target {
  @apply rounded-md border border-transparent px-1.5 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-500;
}

.sidebar-search-target[aria-pressed='true'] {
  @apply border-zinc-300 bg-zinc-100 text-zinc-900;
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

/* Keep footer notices and goal actions clear of the floating restore/Stop buttons. */
.content-grid:not(.has-pending-request) .composer-container:has(> .thread-composer--collapsed) {
  padding-right: calc(7rem + env(safe-area-inset-right, 0px));
}

/* Preserve mounted conversation/editor state while exposing only the writing surface. */
.content-root.is-composer-expanded > :not(.content-body),
.content-root.is-composer-expanded .content-grid > :not(.composer-container),
.content-root.is-composer-expanded .composer-container > :not(.thread-composer, .composer-queue-notice) {
  display: none;
}

.content-root.is-composer-expanded .content-body,
.content-root.is-composer-expanded .content-grid,
.content-root.is-composer-expanded .composer-container {
  @apply min-h-0 flex-1 gap-0 p-0;
}

.content-root.is-composer-expanded .content-grid-home {
  overflow: visible;
}

.content-root.is-composer-expanded .composer-queue-notice {
  @apply w-auto shrink-0;
  margin-left: max(0.75rem, env(safe-area-inset-left, 0px));
  margin-right: max(0.75rem, env(safe-area-inset-right, 0px));
  margin-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));
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

.thread-context-summary {
  @apply flex flex-wrap items-center justify-between gap-3 py-3;
}

.thread-context-breakdown {
  white-space: pre-line;
}

.thread-context-value {
  @apply text-xs font-semibold text-zinc-700 text-right;
}

.thread-context-value[data-state='ok'] {
  @apply text-emerald-700;
}

.thread-context-value[data-state='warning'] {
  @apply text-amber-700;
}

.thread-context-value[data-state='danger'] {
  @apply text-rose-700;
}

.thread-context-meta {
  @apply block text-[11px] font-normal text-zinc-500;
}

.sidebar-settings-rate-limits {
  @apply border-t border-zinc-200 px-2 pt-2;
}

</style>
