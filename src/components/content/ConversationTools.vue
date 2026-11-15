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
import DaybreakStatus from './DaybreakStatus.vue'
import PermanentDeletion from './PermanentDeletion.vue'
import NativeShellPanel from './NativeShell.vue'
import type {NativeShell} from '../../composables/nativeShell'
import type {ThreadDeletion} from '../../composables/threadDeletion'
import type {createNativeQueue} from '../../composables/nativeQueue'
import type {createThreadPermissions} from '../../composables/threadPermissions'
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
  permissionChanges:ReturnType<typeof createThreadPermissions>;
  openCreatedWorktree:(path:string)=>Promise<void>;
  deletion:ThreadDeletion|null; ensureDeletion:()=>Promise<ThreadDeletion|null>; hasDraft:()=>boolean;
  shell:NativeShell|null; ensureShell:()=>Promise<NativeShell|null>;
  inProgress:boolean; sending:boolean; incomplete:boolean; disconnected:boolean; interrupting:boolean;
  compaction:ReturnType<typeof createThreadCompaction>; review:ReturnType<typeof createThreadReview>;
}>()
const reviewTargetOptions = [
 {value:'uncommittedChanges',label:'Uncommitted changes'}, {value:'baseBranch',label:'Base branch'},
 {value:'commit',label:'Commit'}, {value:'custom',label:'Custom instructions'},
]
</script>
<template>
                <fieldset :disabled="deletion?.selectedBlocking.value" style="border:0;padding:0;margin:0;min-width:0">
                <fieldset :disabled="shell?.selectedBlocking.value" style="border:0;padding:0;margin:0;min-width:0">
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
                <DaybreakStatus :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" />
                <SubagentsPanel :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" />
                <HooksInspection :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" :blocked="inProgress||sending||incomplete||queue.writing.value||compaction.busy.value||review.busy.value" />
                <ConfigInspection :cwd="cwd" :epoch="epoch" :disconnected="disconnected" :blocked="inProgress||sending||incomplete||queue.writing.value||compaction.busy.value||review.busy.value" />
                <ImportPreview :cwd="cwd" :epoch="epoch" :disconnected="disconnected" />
                <PermissionsInspection :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" :security="security" :changes="permissionChanges" :blocked="inProgress||sending||incomplete||compaction.busy.value||review.busy.value||queue.writing.value" />
                <DeniedActions :thread-id="threadId" :rows="deniedActions" />
                <NativeQueuePanel :thread-id="threadId" :epoch="epoch" :disconnected="disconnected" :queue="queue" :in-progress="inProgress" :blocked="sending||incomplete||compaction.busy.value||review.busy.value" />
                <BackgroundTerminals :thread-id="threadId" :epoch="epoch" :messages="messages" :disconnected="disconnected" />
                <WorkingTreePanel :cwd="cwd" :epoch="epoch" />
                <CreateWorktree :cwd="cwd" :epoch="epoch" :blocked="disconnected||inProgress||sending||incomplete||compaction.busy.value||review.busy.value" :open-project="openCreatedWorktree" />
                </fieldset>
                <NativeShellPanel :thread-id="threadId" :epoch="epoch" :shell="shell" :ensure-shell="ensureShell" :blocked="disconnected||inProgress||sending||incomplete||compaction.busy.value||review.busy.value||queue.writing.value" />
                </fieldset>
                <p v-if="shell?.blocking.value" class="feature-panel" role="status">Permanent deletion waits while a standalone command is pending or uncertain. Inspect its Standalone native command controls first.</p>
                <PermanentDeletion :thread-id="threadId" :epoch="epoch" :deletion="deletion" :ensure-deletion="ensureDeletion" :has-draft="hasDraft" :blocked="disconnected||inProgress||sending||incomplete||compaction.busy.value||review.busy.value||queue.writing.value||!!shell?.blocking.value" />
</template>
