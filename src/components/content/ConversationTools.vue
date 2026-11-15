<script setup lang="ts">
import ComposerDropdown from './ComposerDropdown.vue'
import MemoryStatus from './MemoryStatus.vue'
import BackgroundTerminals from './BackgroundTerminals.vue'
import WorkingTreePanel from './WorkingTreePanel.vue'
import SubagentsPanel from './SubagentsPanel.vue'
import HooksInspection from './HooksInspection.vue'
import ConfigInspection from './ConfigInspection.vue'
import ImportPreview from './ImportPreview.vue'
import PermissionsInspection from './PermissionsInspection.vue'
import DeniedActions from './DeniedActions.vue'
import NativeQueuePanel from './NativeQueuePanel.vue'
import CreateWorktree from './CreateWorktree.vue'
import type {createNativeQueue} from '../../composables/nativeQueue'
import type {DeniedAction} from '../../composables/deniedActionObservation'
import type {ThreadSecurity} from '../../api/threadSecurity'
import type {createThreadCompaction} from '../../composables/threadCompaction'
import type {createThreadReview} from '../../composables/threadReview'
import type {UiMessage} from '../../types/codex'
defineProps<{
  threadId:string; cwd:string; epoch:number; messages:UiMessage[];
  security:ThreadSecurity|null;
  deniedActions:DeniedAction[];
  queue:ReturnType<typeof createNativeQueue>;
  openCreatedWorktree:(path:string)=>Promise<void>;
  inProgress:boolean; sending:boolean; incomplete:boolean; disconnected:boolean; interrupting:boolean;
  compaction:ReturnType<typeof createThreadCompaction>; review:ReturnType<typeof createThreadReview>;
}>()
const reviewTargetOptions = [
 {value:'uncommittedChanges',label:'Uncommitted changes'}, {value:'baseBranch',label:'Base branch'},
 {value:'commit',label:'Commit'}, {value:'custom',label:'Custom instructions'},
]
</script>
<template>
                <details id="native-conversation-actions" class="feature-panel native-thread-actions">
                  <summary>Conversation actions</summary>
                  <button type="button" :disabled="compaction.busy.value || review.busy.value || inProgress || sending || incomplete || disconnected" @click="compaction.run">Compact conversation</button>
                  <ComposerDropdown v-model="review.kind.value" :options="reviewTargetOptions" placeholder="Review target" />
                  <textarea v-if="review.kind.value !== 'uncommittedChanges'" v-model="review.value.value" aria-label="Review target value" maxlength="8000" placeholder="Base branch, commit SHA, or custom instructions" />
                  <button type="button" :disabled="review.busy.value || compaction.busy.value || inProgress || sending || incomplete || disconnected" @click="review.run">Start native review</button>
                  <button v-if="review.selectedBusy.value && review.turn.value" type="button" :disabled="interrupting || review.cancelling.value" @click="review.cancel">Interrupt review turn</button>
                  <p>Review runs inline in this conversation while idle. Active work must finish first.</p>
                  <p v-if="review.thread.value === threadId" role="status">{{ review.status.value }}</p>
                  <p>Manual native context compaction. Available while idle; visible and imported history is retained.</p>
                  <p v-if="compaction.thread.value === threadId" role="status">{{ compaction.status.value }}</p>
                </details>
                <MemoryStatus :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" />
                <SubagentsPanel :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" />
                <HooksInspection :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" />
                <ConfigInspection :cwd="cwd" :epoch="epoch" :disconnected="disconnected" />
                <ImportPreview :cwd="cwd" :epoch="epoch" :disconnected="disconnected" />
                <PermissionsInspection :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" :security="security" />
                <DeniedActions :thread-id="threadId" :rows="deniedActions" />
                <NativeQueuePanel :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" :queue="queue" :in-progress="inProgress" :blocked="sending||incomplete||compaction.busy.value||review.busy.value" />
                <BackgroundTerminals :thread-id="threadId" :epoch="epoch" :messages="messages" :disconnected="disconnected" />
                <WorkingTreePanel :cwd="cwd" :epoch="epoch" />
                <CreateWorktree :cwd="cwd" :epoch="epoch" :blocked="disconnected||inProgress||sending||incomplete||compaction.busy.value||review.busy.value" :open-project="openCreatedWorktree" />
</template>
