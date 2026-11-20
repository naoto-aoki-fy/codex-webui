<template>
  <section class="conversation-root" @contextmenu.capture="onConversationContextMenu">
    <p v-if="isLoading" class="conversation-loading">Loading messages...</p>

    <p
      v-else-if="!hasConversationContent"
      class="conversation-empty"
    >
      No messages in this thread yet.
    </p>

    <ul
      v-if="pendingQuestion || (!isLoading && hasConversationContent)"
      ref="conversationListRef"
      class="conversation-list"
      @scroll="onConversationScroll"
      @wheel.passive="resetMessageNavigation"
      @pointerdown="resetMessageNavigation"
      @touchstart.passive="resetMessageNavigation"
    >
      <li v-if="!isLoading && hasMoreAbove" class="conversation-load-more">
        <button
          type="button"
          class="load-more-button"
          :disabled="isLoadingMore || isLoadingPersistedAbove"
          @click="loadMoreAbove"
        >
          {{ isLoadingMore || isLoadingPersistedAbove ? 'Loading…' : 'Load earlier messages' }}
        </button>
      </li>
      <template v-for="message in conversationRows" :key="message ? message.id : pendingQuestionRowKey">
      <li
        v-if="message"
        class="conversation-item"
        :data-message-id="message.id"
        :data-navigation-message="!message.questionResponse && (message.role === 'user' || message.role === 'assistant') && !isCommandMessage(message) && message.messageType !== 'fileChange'"
        :data-role="message.role"
        :data-message-type="message.messageType || ''"
      >
        <div v-if="message.questionResponse" class="message-row" data-role="user">
          <div class="message-stack" data-role="user">
            <article class="message-card question-response-card" data-role="user">
              <section v-for="question in message.questionResponse.questions" :key="question.id">
                <h3>{{ question.heading }}</h3>
                <p>{{ questionAnswerText(question) }}</p>
              </section>
            </article>
            <p class="message-timestamp">
              <time :datetime="message.submittedAt">Sent: {{ formatMessageTimestamp(message.submittedAt) }}</time>
            </p>
            <div class="message-toolbar" data-role="user">
              <button type="button" class="message-copy-button" :data-copied="copiedUserMessageId === message.id"
                :aria-label="copiedUserMessageId === message.id ? 'Answers copied' : 'Copy answers'" @click="copyUserMessage(message)">
                <IconTablerCopy class="icon-svg message-copy-icon" />
                <span class="message-copy-label">{{ copiedUserMessageId === message.id ? 'Copied' : 'Copy' }}</span>
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="message.executionLabel" class="message-row" data-role="system">
        <details class="execution-details feature-panel">
          <summary>{{ message.executionLabel }}</summary>
          <pre v-text="message.text"></pre>
          <p v-if="message.messageType === 'exitedReviewMode'" class="message-generation-metadata">{{ generationMetadataLabel(message.generationMetadata) }}</p>
          <p v-if="message.messageType === 'exitedReviewMode' && formatMessageTimestamp(message.completedAt)" class="message-timestamp"><time :datetime="message.completedAt">Answered: {{ formatMessageTimestamp(message.completedAt) }}</time></p>
        </details>
        </div>
        <div v-else-if="isCommandMessage(message)" class="message-row" data-role="system">
          <div class="message-stack" data-role="system">
            <button
              v-if="getGroupedCommandsForLatest(message).length > 0"
              type="button"
              class="cmd-row cmd-row-group cmd-compact"
              :class="[commandStatusClass(message), { 'cmd-expanded': isCommandGroupExpanded(message) }]"
              @click="toggleCommandGroup(message)"
            >
              <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isCommandGroupExpanded(message) }">▶</span>
              <span class="cmd-group-label">{{ commandGroupSummaryLabel(message) }}</span>
              <span class="cmd-status">{{ commandGroupSummaryStatus(message) }}</span>
            </button>
            <div
              v-if="getGroupedCommandsForLatest(message).length > 0"
              class="cmd-group-wrap"
              :class="{ 'cmd-group-visible': isCommandGroupExpanded(message) }"
            >
              <div class="cmd-group-inner">
                <div
                  v-for="cmd in getCommandBlockForLatest(message)"
                  :key="`grouped-cmd-${cmd.id}`"
                  class="worked-cmd-item"
                >
                  <button
                    type="button"
                    class="cmd-row"
                    :class="[
                      commandStatusClass(cmd),
                      {
                        'cmd-expanded': isCommandExpanded(cmd),
                        'cmd-compact': true,
                      },
                    ]"
                    @click="toggleCommandExpand(cmd)"
                  >
                    <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isCommandExpanded(cmd) }">▶</span>
                    <code class="cmd-label">{{ cmd.commandExecution?.command || '(command)' }}</code>
                    <span class="cmd-status">{{ commandStatusLabel(cmd) }}</span>
                  </button>
                  <div
                    class="cmd-output-wrap"
                    :class="{ 'cmd-output-visible': isCommandExpanded(cmd) }"
                  >
                    <div class="cmd-output-inner">
                      <pre
                        class="cmd-output"
                        :class="{ 'cmd-output-condensed': isCommandOutputCondensed(cmd) }"
                        v-text="cmd.commandExecution?.aggregatedOutput || '(no output)'"
                      ></pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <template v-else>
              <button
                type="button"
                class="cmd-row"
                :class="[
                  commandStatusClass(message),
                  {
                    'cmd-expanded': isCommandExpanded(message),
                    'cmd-compact': isCommandCompact(message),
                  },
                ]"
                @click="toggleCommandExpand(message)"
              >
                <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isCommandExpanded(message) }">▶</span>
                <code class="cmd-label">{{ message.commandExecution?.command || '(command)' }}</code>
                <span class="cmd-status">{{ commandStatusLabel(message) }}</span>
              </button>
              <div
                class="cmd-output-wrap"
                :class="{ 'cmd-output-visible': isCommandExpanded(message) }"
              >
                <div class="cmd-output-inner">
                  <pre
                    class="cmd-output"
                    :class="{ 'cmd-output-condensed': isCommandOutputCondensed(message) }"
                    v-text="message.commandExecution?.aggregatedOutput || '(no output)'"
                  ></pre>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div
          v-else-if="isFileChangeMessage(message)"
          class="message-row"
          :data-role="message.role"
          :data-message-type="message.messageType || ''"
        >
          <div class="message-stack" :data-role="message.role">
            <article class="message-body" :data-role="message.role">
              <section v-if="readStandaloneFileChangeSummary(message)" class="file-change-summary-block">
                <button
                  type="button"
                  class="cmd-row cmd-row-group cmd-compact file-change-summary-row"
                  :class="{ 'cmd-expanded': isFileChangeSummaryExpanded(message) }"
                  @click="toggleFileChangeSummary(message)"
                >
                  <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isFileChangeSummaryExpanded(message) }">▶</span>
                  <span class="file-change-summary-label">
                    {{ fileChangeSummaryLabel(readStandaloneFileChangeSummary(message)) }}
                  </span>
                  <span class="file-change-summary-status">
                    <span
                      v-for="part in fileChangeSummaryStatusParts(readStandaloneFileChangeSummary(message))"
                      :key="`summary-status:${message.id}:${part.tone}:${part.label}`"
                      class="file-change-signed-count"
                      :data-tone="part.tone"
                    >
                      {{ part.label }}
                    </span>
                  </span>
                </button>
                <div class="cmd-group-wrap" :class="{ 'cmd-group-visible': isFileChangeSummaryExpanded(message) }">
                  <div class="file-change-panel-inner">
                    <ul class="file-change-list">
                      <li
                        v-for="change in readStandaloneFileChangeSummary(message)?.changes ?? []"
                        :key="`file-change:${message.id}:${change.path}:${change.movedToPath || ''}`"
                        class="file-change-item"
                      >
                        <span class="file-change-badge" :data-operation="fileChangeOperationTone(change)">
                          {{ fileChangeOperationLabel(change) }}
                        </span>
                        <button
                          type="button"
                          class="file-change-path-button"
                          :title="change.path"
                          @click="openDiffViewer(readStandaloneFileChangeSummary(message), change)"
                        >
                          {{ displayFileChangePath(change.path) }}
                        </button>
                        <span v-if="change.movedToPath" class="file-change-arrow">→</span>
                        <button
                          v-if="change.movedToPath"
                          type="button"
                          class="file-change-path-button"
                          :title="change.movedToPath"
                          @click="openDiffViewer(readStandaloneFileChangeSummary(message), change)"
                        >
                          {{ displayFileChangePath(change.movedToPath) }}
                        </button>
                        <span v-if="change.addedLineCount > 0 || change.removedLineCount > 0" class="file-change-delta">
                          <span
                            v-for="part in fileChangeDeltaParts(change)"
                            :key="`change-delta:${message.id}:${change.path}:${part.tone}:${part.label}`"
                            class="file-change-signed-count"
                            :data-tone="part.tone"
                          >
                            {{ part.label }}
                          </span>
                        </span>
                      </li>
                    </ul>

                  </div>
                </div>
              </section>
            </article>
          </div>
        </div>

        <div v-else class="message-row" :data-role="message.role" :data-message-type="message.messageType || ''">
          <div class="message-stack" :data-role="message.role">
            <article class="message-body" :data-role="message.role">
              <span v-if="message.role === 'user' && message.generationMetadata?.collaborationMode === 'plan'" class="message-plan-badge">Plan</span>
              <ul
                v-if="message.images && message.images.length > 0"
                class="message-image-list"
                :class="{ 'message-generated-image-list': message.messageType === 'imageView' }"
                :data-role="message.role"
              >
                <li v-for="imageUrl in message.images" :key="imageUrl" class="message-image-item">
                  <button class="message-image-button" type="button" @click="openImageModal(imageUrl)">
                    <img
                      class="message-image-preview"
                      :class="{ 'message-generated-image-preview': message.messageType === 'imageView' }"
                      :src="imageUrl"
                      :alt="message.messageType === 'imageView' ? 'Generated image' : 'Message image preview'"
                      loading="lazy"
                    />
                  </button>
                </li>
              </ul>

              <div v-if="message.fileAttachments && message.fileAttachments.length > 0" class="message-file-attachments">
                <span v-for="att in message.fileAttachments" :key="`${message.id}:${att.path}`" class="message-file-chip">
                  <span class="message-file-chip-icon">📄</span>
                  <a
                    class="message-file-link message-file-chip-name"
                    :href="toBrowseUrl(att.path)"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="att.path"
                  >
                    {{ att.label }}
                  </a>
                </span>
              </div>

              <p v-for="app in message.apps" :key="app.id" class="message-app-reference">App reference: {{ app.name }} · app://{{ app.id }}</p>
              <div v-if="message.skills && message.skills.length > 0" class="message-skill-attachments">
                <a
                  v-for="skill in message.skills"
                  :key="`${message.id}:${skill.path}`"
                  class="message-skill-chip"
                  :href="toBrowseUrl(skill.path)"
                  :title="skill.path"
                >
                  <span class="message-skill-chip-prefix">Skill</span>
                  <span class="message-skill-chip-name">{{ skill.name }}</span>
                </a>
              </div>

              <article v-if="message.text.length > 0" class="message-card" :data-role="message.role">
                <div v-if="message.isAutomationRun" class="automation-message-label">
                  <span>Sent via automation</span>
                  <code v-if="message.automationDisplayName">{{ message.automationDisplayName }}</code>
                </div>
                <div v-if="message.messageType === 'worked'" class="worked-separator-wrap" aria-live="polite">
                  <button type="button" class="worked-separator" @click="toggleWorkedExpand(message)">
                    <span class="worked-separator-line" aria-hidden="true" />
                    <span class="worked-chevron" :class="{ 'worked-chevron-open': isWorkedExpanded(message) }">▶</span>
                    <p class="worked-separator-text">{{ message.text }}</p>
                    <span class="worked-separator-line" aria-hidden="true" />
                  </button>
                  <div v-if="isWorkedExpanded(message)" class="worked-details">
                    <div
                      v-for="cmd in getCommandsForWorked(messages, messages.indexOf(message))"
                      :key="`worked-cmd-${cmd.id}`"
                      class="worked-cmd-item"
                    >
                      <button
                        type="button"
                        class="cmd-row"
                        :class="[
                          commandStatusClass(cmd),
                          {
                            'cmd-expanded': isCommandExpanded(cmd),
                            'cmd-compact': isCommandCompact(cmd),
                          },
                        ]"
                        @click="toggleCommandExpand(cmd)"
                      >
                        <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isCommandExpanded(cmd) }">▶</span>
                        <code class="cmd-label">{{ cmd.commandExecution?.command || '(command)' }}</code>
                        <span class="cmd-status">{{ commandStatusLabel(cmd) }}</span>
                      </button>
                      <div
                        class="cmd-output-wrap"
                        :class="{ 'cmd-output-visible': isCommandExpanded(cmd) }"
                      >
                        <div class="cmd-output-inner">
                          <pre
                            class="cmd-output"
                            :class="{ 'cmd-output-condensed': isCommandOutputCondensed(cmd) }"
                            v-text="cmd.commandExecution?.aggregatedOutput || '(no output)'"
                          ></pre>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else-if="isPlanMessage(message)" class="plan-card" :data-streaming="message.messageType === 'plan.live'">
                  <div class="plan-card-header">
                    <button
                      type="button"
                      class="plan-card-title"
                      :aria-expanded="!collapsedPlanIds.has(message.id)"
                      :aria-label="collapsedPlanIds.has(message.id) ? 'Expand plan' : 'Minimize plan'"
                      @click="togglePlan(message.id)"
                    >
                      <IconTablerChevronRight class="plan-card-chevron" />
                      Plan
                    </button>
                    <span v-if="message.messageType === 'plan.live'" class="plan-card-badge">Updating</span>
                    <button
                      v-else-if="readPlan(message).hasCopyContent"
                      type="button"
                      class="message-copy-button"
                      :data-copied="copiedPlanId === message.id"
                      :aria-label="copiedPlanId === message.id ? 'Plan copied' : 'Copy plan'"
                      :title="copiedPlanId === message.id ? 'Plan copied' : 'Copy plan'"
                      @click="copyPlan(message)"
                    >
                      <IconTablerCopy class="icon-svg message-copy-icon" />
                      <span class="message-copy-label">{{ copiedPlanId === message.id ? 'Copied' : 'Copy' }}</span>
                    </button>
                  </div>
                  <template v-if="!collapsedPlanIds.has(message.id)">
                    <div
                      v-if="readPlan(message).explanation"
                      class="plan-card-explanation plan-card-markdown"
                      v-html="renderMarkdownBlocksAsHtml(readPlan(message).explanation)"
                    />
                    <ol v-if="readPlan(message).steps.length > 0" class="plan-step-list">
                      <li
                        v-for="(step, stepIndex) in readPlan(message).steps"
                        :key="`${message.id}:plan-step:${stepIndex}`"
                        class="plan-step-item"
                        :data-status="step.status"
                      >
                        <span class="plan-step-status" :data-status="step.status">{{ planStepStatusIcon(step.status) }}</span>
                        <div class="plan-step-text plan-card-markdown" v-html="renderMarkdownBlocksAsHtml(step.step)" />
                      </li>
                    </ol>
                    <div v-else class="plan-card-markdown" v-html="renderMarkdownBlocksAsHtml(message.text)" />
                    <div v-if="showImplementPlanButton(message)" class="plan-card-actions">
                      <button
                        type="button"
                        class="plan-card-implement-button"
                        @click="implementPlan(message)"
                      >
                        Implement plan
                      </button>
                    </div>
                  </template>
                </div>
                <div
                  v-else
                  class="message-text-flow"
                  v-memo="[message.id, message.text, props.cwd, highlightCacheVersion, markdownImageFailureVersion]"
                >
                  <template v-for="(block, blockIndex) in getMessageBlocks(message)" :key="`block-${blockIndex}`">
                    <p v-if="block.kind === 'paragraph'" class="message-text">
                      <template v-for="(segment, segmentIndex) in getInlineSegments(block.value)" :key="`seg-${blockIndex}-${segmentIndex}`">
                        <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                        <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                        <em v-else-if="segment.kind === 'italic'" class="message-italic-text">{{ segment.value }}</em>
                        <s v-else-if="segment.kind === 'strikethrough'" class="message-strikethrough-text">{{ segment.value }}</s>
                        <a
                          v-else-if="segment.kind === 'file'"
                          class="message-file-link"
                          :href="toBrowseUrl(segment.path)"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.path"
                        >
                          {{ segment.displayPath }}
                        </a>
                        <a
                          v-else-if="segment.kind === 'url'"
                          class="message-file-link"
                          :href="segment.href"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.href"
                        >
                          {{ segment.value }}
                        </a>
                        <code v-else class="message-inline-code">{{ segment.value }}</code>
                      </template>
                    </p>
                    <component
                      :is="headingTag(block.level)"
                      v-else-if="block.kind === 'heading'"
                      class="message-heading"
                      :class="headingClass(block.level)"
                    >
                      <template v-for="(segment, segmentIndex) in getInlineSegments(block.value)" :key="`heading-seg-${blockIndex}-${segmentIndex}`">
                        <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                        <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                        <em v-else-if="segment.kind === 'italic'" class="message-italic-text">{{ segment.value }}</em>
                        <s v-else-if="segment.kind === 'strikethrough'" class="message-strikethrough-text">{{ segment.value }}</s>
                        <a
                          v-else-if="segment.kind === 'file'"
                          class="message-file-link"
                          :href="toBrowseUrl(segment.path)"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.path"
                        >
                          {{ segment.displayPath }}
                        </a>
                        <a
                          v-else-if="segment.kind === 'url'"
                          class="message-file-link"
                          :href="segment.href"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.href"
                        >
                          {{ segment.value }}
                        </a>
                        <code v-else class="message-inline-code">{{ segment.value }}</code>
                      </template>
                    </component>
                    <blockquote v-else-if="block.kind === 'blockquote'" class="message-blockquote">
                      <template v-for="(segment, segmentIndex) in getInlineSegments(block.value)" :key="`quote-seg-${blockIndex}-${segmentIndex}`">
                        <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                        <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                        <em v-else-if="segment.kind === 'italic'" class="message-italic-text">{{ segment.value }}</em>
                        <s v-else-if="segment.kind === 'strikethrough'" class="message-strikethrough-text">{{ segment.value }}</s>
                        <a
                          v-else-if="segment.kind === 'file'"
                          class="message-file-link"
                          :href="toBrowseUrl(segment.path)"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.path"
                        >
                          {{ segment.displayPath }}
                        </a>
                        <a
                          v-else-if="segment.kind === 'url'"
                          class="message-file-link"
                          :href="segment.href"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.href"
                        >
                          {{ segment.value }}
                        </a>
                        <code v-else class="message-inline-code">{{ segment.value }}</code>
                      </template>
                    </blockquote>
                    <ul v-else-if="block.kind === 'unorderedList'" class="message-list message-list-unordered">
                      <li v-for="(item, itemIndex) in block.items" :key="`ul-${blockIndex}-${itemIndex}`" class="message-list-item">
                        <div class="message-list-item-content" v-html="renderListItemContentAsHtml(item)" />
                      </li>
                    </ul>
                    <ul v-else-if="block.kind === 'taskList'" class="message-list message-task-list">
                      <li v-for="(item, itemIndex) in block.items" :key="`task-${blockIndex}-${itemIndex}`" class="message-task-item">
                        <span class="message-task-checkbox" :data-checked="item.checked">{{ item.checked ? '☑' : '☐' }}</span>
                        <div class="message-list-item-text">
                          <template v-for="(segment, segmentIndex) in getInlineSegments(item.text)" :key="`task-seg-${blockIndex}-${itemIndex}-${segmentIndex}`">
                            <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                            <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                            <em v-else-if="segment.kind === 'italic'" class="message-italic-text">{{ segment.value }}</em>
                            <s v-else-if="segment.kind === 'strikethrough'" class="message-strikethrough-text">{{ segment.value }}</s>
                            <a
                              v-else-if="segment.kind === 'file'"
                              class="message-file-link"
                              :href="toBrowseUrl(segment.path)"
                              target="_blank"
                              rel="noopener noreferrer"
                              :title="segment.path"
                            >
                              {{ segment.displayPath }}
                            </a>
                            <a
                              v-else-if="segment.kind === 'url'"
                              class="message-file-link"
                              :href="segment.href"
                              target="_blank"
                              rel="noopener noreferrer"
                              :title="segment.href"
                            >
                              {{ segment.value }}
                            </a>
                            <code v-else class="message-inline-code">{{ segment.value }}</code>
                          </template>
                        </div>
                      </li>
                    </ul>
                    <ol
                      v-else-if="block.kind === 'orderedList'"
                      class="message-list message-list-ordered"
                      :start="block.start"
                    >
                      <li v-for="(item, itemIndex) in block.items" :key="`ol-${blockIndex}-${itemIndex}`" class="message-list-item">
                        <div class="message-list-item-content" v-html="renderListItemContentAsHtml(item)" />
                      </li>
                    </ol>
                    <div v-else-if="block.kind === 'table'" class="message-table-wrap">
                      <table class="message-table">
                        <thead>
                          <tr>
                            <th
                              v-for="(cell, cellIndex) in block.headers"
                              :key="`th-${blockIndex}-${cellIndex}`"
                              class="message-table-head-cell"
                              :style="{ textAlign: block.alignments[cellIndex] ?? 'left' }"
                            >
                              <template v-for="(segment, segmentIndex) in getInlineSegments(cell)" :key="`th-seg-${blockIndex}-${cellIndex}-${segmentIndex}`">
                                <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                                <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                                <em v-else-if="segment.kind === 'italic'" class="message-italic-text">{{ segment.value }}</em>
                                <s v-else-if="segment.kind === 'strikethrough'" class="message-strikethrough-text">{{ segment.value }}</s>
                                <a
                                  v-else-if="segment.kind === 'file'"
                                  class="message-file-link"
                                  :href="toBrowseUrl(segment.path)"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  :title="segment.path"
                                >
                                  {{ segment.displayPath }}
                                </a>
                                <a
                                  v-else-if="segment.kind === 'url'"
                                  class="message-file-link"
                                  :href="segment.href"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  :title="segment.href"
                                >
                                  {{ segment.value }}
                                </a>
                                <code v-else class="message-inline-code">{{ segment.value }}</code>
                              </template>
                            </th>
                          </tr>
                        </thead>
                        <tbody v-if="block.rows.length > 0">
                          <tr v-for="(row, rowIndex) in block.rows" :key="`tr-${blockIndex}-${rowIndex}`" class="message-table-body-row">
                            <td
                              v-for="(cell, cellIndex) in row"
                              :key="`td-${blockIndex}-${rowIndex}-${cellIndex}`"
                              class="message-table-cell"
                              :style="{ textAlign: block.alignments[cellIndex] ?? 'left' }"
                            >
                              <template v-for="(segment, segmentIndex) in getInlineSegments(cell)" :key="`td-seg-${blockIndex}-${rowIndex}-${cellIndex}-${segmentIndex}`">
                                <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                                <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                                <em v-else-if="segment.kind === 'italic'" class="message-italic-text">{{ segment.value }}</em>
                                <s v-else-if="segment.kind === 'strikethrough'" class="message-strikethrough-text">{{ segment.value }}</s>
                                <a
                                  v-else-if="segment.kind === 'file'"
                                  class="message-file-link"
                                  :href="toBrowseUrl(segment.path)"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  :title="segment.path"
                                >
                                  {{ segment.displayPath }}
                                </a>
                                <a
                                  v-else-if="segment.kind === 'url'"
                                  class="message-file-link"
                                  :href="segment.href"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  :title="segment.href"
                                >
                                  {{ segment.value }}
                                </a>
                                <code v-else class="message-inline-code">{{ segment.value }}</code>
                              </template>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div v-else-if="block.kind === 'codeBlock'" class="message-code-block">
                      <div v-if="block.language" class="message-code-language">{{ block.language }}</div>
                      <pre class="message-code-pre"><code class="hljs" v-html="renderCachedHighlightedCodeAsHtml(block.language, block.value)"></code></pre>
                    </div>
                    <hr v-else-if="block.kind === 'thematicBreak'" class="message-divider" />
                    <p v-else-if="isMarkdownImageFailed(message.id, blockIndex, block.url)" class="message-text">{{ block.markdown }}</p>
                    <button
                      v-else
                      class="message-image-button"
                      type="button"
                      @click="openImageModal(block.url)"
                    >
                      <img
                        class="message-image-preview message-markdown-image"
                        :src="block.url"
                        :alt="block.alt || 'Embedded message image'"
                        loading="lazy"
                        @error="onMarkdownImageError(message.id, blockIndex, block.url)"
                      />
                    </button>
                  </template>
                </div>
              </article>

              <p v-if="message.role === 'assistant'" class="message-generation-metadata">
                {{ generationMetadataLabel(message.generationMetadata) }}
              </p>

              <section v-if="readAnchoredFileChangeSummary(message)" class="file-change-summary-block file-change-summary-block-inline">
                <button
                  type="button"
                  class="cmd-row cmd-row-group cmd-compact file-change-summary-row"
                  :class="{ 'cmd-expanded': isFileChangeSummaryExpanded(message) }"
                  @click="toggleFileChangeSummary(message)"
                >
                  <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isFileChangeSummaryExpanded(message) }">▶</span>
                  <span class="file-change-summary-label">
                    {{ fileChangeSummaryLabel(readAnchoredFileChangeSummary(message)) }}
                  </span>
                  <span class="file-change-summary-status">
                    <span
                      v-for="part in fileChangeSummaryStatusParts(readAnchoredFileChangeSummary(message))"
                      :key="`summary-status:${message.id}:${part.tone}:${part.label}`"
                      class="file-change-signed-count"
                      :data-tone="part.tone"
                    >
                      {{ part.label }}
                    </span>
                  </span>
                </button>
                <div class="cmd-group-wrap" :class="{ 'cmd-group-visible': isFileChangeSummaryExpanded(message) }">
                  <div class="file-change-panel-inner">
                    <ul class="file-change-list">
                      <li
                        v-for="change in readAnchoredFileChangeSummary(message)?.changes ?? []"
                        :key="`file-change:inline:${message.id}:${change.path}:${change.movedToPath || ''}`"
                        class="file-change-item"
                      >
                        <span class="file-change-badge" :data-operation="fileChangeOperationTone(change)">
                          {{ fileChangeOperationLabel(change) }}
                        </span>
                        <button
                          type="button"
                          class="file-change-path-button"
                          :title="change.path"
                          @click="openDiffViewer(readAnchoredFileChangeSummary(message), change)"
                        >
                          {{ displayFileChangePath(change.path) }}
                        </button>
                        <span v-if="change.movedToPath" class="file-change-arrow">→</span>
                        <button
                          v-if="change.movedToPath"
                          type="button"
                          class="file-change-path-button"
                          :title="change.movedToPath"
                          @click="openDiffViewer(readAnchoredFileChangeSummary(message), change)"
                        >
                          {{ displayFileChangePath(change.movedToPath) }}
                        </button>
                        <span v-if="change.addedLineCount > 0 || change.removedLineCount > 0" class="file-change-delta">
                          <span
                            v-for="part in fileChangeDeltaParts(change)"
                            :key="`change-delta:inline:${message.id}:${change.path}:${part.tone}:${part.label}`"
                            class="file-change-signed-count"
                            :data-tone="part.tone"
                          >
                            {{ part.label }}
                          </span>
                        </span>
                      </li>
                    </ul>

                  </div>
                </div>
              </section>

              <p v-if="formatMessageTimestamp(message.submittedAt || message.completedAt)" class="message-timestamp">
                <time :datetime="message.submittedAt || message.completedAt">{{ message.role === 'user' ? 'Sent' : 'Answered' }}: {{ formatMessageTimestamp(message.submittedAt || message.completedAt) }}</time>
              </p>
              <div
                v-if="message.role === 'user' || showCopyResponseButton(message) || showEditMessageButton(message)"
                class="message-toolbar"
                :data-role="message.role"
              >
                <span v-if="showEditMessageButton(message)" class="message-revert-split" style="display: inline-flex; align-items: center">
                <button
                  type="button"
                  class="message-edit-button"
                  aria-label="Fork and Revert"
                  title="Fork and Revert"
                  :disabled="isRevertDisabled"
                  @click="editMessage(message.id)"
                >
                  <IconTablerArrowBackUp class="icon-svg message-edit-icon" />
                  <span class="message-edit-label">Revert</span>
                </button>
                <ComposerDropdown :key="activeThreadId" model-value="" icon-only
                  placeholder="Revert options" :disabled="isRevertDisabled" menu-align="end"
                  :options="[{ value: 'revert', label: 'Revert' }, { value: 'fork-and-revert', label: 'Fork and Revert (Native)' }, { value: 'portable-fork-and-revert', label: 'Portable Fork and Revert' }]"
                  @update:model-value="editMessage(message.id, $event)" />
                </span>
                <button
                  v-if="message.role === 'user'"
                  type="button"
                  class="message-copy-button"
                  :data-copied="copiedUserMessageId === message.id"
                  :aria-label="copiedUserMessageId === message.id ? 'Message copied' : 'Copy message'"
                  :title="copiedUserMessageId === message.id ? 'Message copied' : 'Copy message'"
                  @click="copyUserMessage(message)"
                >
                  <IconTablerCopy class="icon-svg message-copy-icon" />
                  <span class="message-copy-label">{{ copiedUserMessageId === message.id ? 'Copied' : 'Copy' }}</span>
                </button>
                <ForkSplitButton v-if="showForkResponseButton(message)" :key="`${activeThreadId}:${message.id}`"
                  aria-label="Fork thread from this response" :disabled="isForkDisabled"
                  :native-available="showNativeForkButton(message)"
                  @fork="forkResponse(message.id, $event)" />
                <button
                  v-if="showCopyResponseButton(message)"
                  type="button"
                  class="message-copy-button"
                  :data-copied="copiedResponseAnchorId === message.id"
                  :aria-label="copiedResponseAnchorId === message.id ? 'Response copied' : 'Copy response'"
                  :title="copiedResponseAnchorId === message.id ? 'Response copied' : 'Copy response'"
                  @click="copyResponse(message.id)"
                >
                  <IconTablerCopy class="icon-svg message-copy-icon" />
                  <span class="message-copy-label">{{ copiedResponseAnchorId === message.id ? 'Copied' : 'Copy' }}</span>
                </button>
              </div>
            </article>
          </div>
        </div>
      </li>
      <li v-else-if="pendingQuestion" class="conversation-item">
        <ThreadPendingRequestPanel
          :key="JSON.stringify([activeThreadId, pendingQuestion.id])"
          :request="pendingQuestion"
          :request-count="pendingRequests.length"
          :question-draft="questionDraft"
          @dismiss-question-draft="emit('dismissQuestionDraft', $event)"
          @update-question-draft="(...edit) => emit('updateQuestionDraft', ...edit)"
          @respond-server-request="emit('respondServerRequest', $event)"
        />
      </li>
      </template>
      <li v-if="!isLoading && liveOverlay" class="conversation-item conversation-item-overlay">
        <div class="message-row">
          <div class="message-stack">
            <article class="live-overlay-inline" aria-live="polite">
              <p class="live-overlay-label">{{ liveOverlay.activityLabel }}</p>
              <p class="message-generation-metadata">{{ generationMetadataLabel(liveOverlay.generationMetadata) }}</p>
              <p
                v-if="liveOverlay.reasoningText"
                class="live-overlay-reasoning"
              >
                {{ liveOverlay.reasoningText }}
              </p>
              <div v-if="liveOverlay.errorText" class="live-overlay-error">
                <span>{{ liveOverlay.errorText }}</span>
              </div>
            </article>
          </div>
        </div>
      </li>
      <li ref="bottomAnchorRef" class="conversation-bottom-anchor" />
    </ul>

    <div v-if="showJumpToQuestionButton || showJumpToLatestButton" class="conversation-jump-actions">
      <button
        v-if="showJumpToQuestionButton"
        type="button"
        class="conversation-jump-button jump-to-question-button"
        @click="jumpToQuestion"
      >
        Jump to question
      </button>
      <button
        v-if="showJumpToLatestButton"
        type="button"
        class="conversation-jump-button jump-to-latest-button"
        title="Jump to latest"
        aria-label="Jump to latest output"
        @click="jumpToLatest"
      >
        <IconTablerArrowUp class="icon-svg jump-to-latest-icon" />
      </button>
    </div>

    <div v-if="modalImageUrl.length > 0" class="image-modal-backdrop" @click="closeImageModal">
      <div class="image-modal-content" @click.stop>
        <button class="image-modal-close" type="button" aria-label="Close image preview" @click="closeImageModal">
          <IconTablerX class="icon-svg" />
        </button>
        <img class="image-modal-image" :src="modalImageUrl" alt="Expanded message image" />
      </div>
    </div>

    <div
      v-if="isFileLinkContextMenuVisible"
      ref="fileLinkContextMenuRef"
      class="file-link-context-menu"
      :style="fileLinkContextMenuStyle"
      @click.stop
    >
      <button type="button" class="file-link-context-menu-item" @click="openFileLinkContextBrowse">
        Open link
      </button>
      <button type="button" class="file-link-context-menu-item" @click="copyFileLinkContextLink">
        Copy link
      </button>
    </div>

    <ThreadDiffViewer
      v-if="activeDiffViewerChange"
      :active-diff-viewer-change="activeDiffViewerChange"
      :diff-viewer-changes="diffViewerChanges"
      :is-mobile="isMobile"
      :is-diff-viewer-file-list-open="isDiffViewerFileListOpen"
      :language="inferDiffViewerLanguage(activeDiffViewerChange)"
      :display-file-change-path="displayFileChangePath"
      :file-change-operation-label="fileChangeOperationLabel"
      :file-change-operation-tone="fileChangeOperationTone"
      :format-file-change-delta="formatFileChangeDelta"
      :format-file-change-count-label="formatFileChangeCountLabel"
      @close="closeDiffViewer"
      @select="selectDiffViewerChange"
      @toggle-file-list="toggleDiffViewerFileList"
      @close-file-list="closeDiffViewerFileList"
    />
  </section>
</template>

<script setup lang="ts">
import type { ConversationProps } from "./conversationContracts"
import { createConversationViewport } from './conversationViewport'
import { createConversationActions } from './conversationActions'
import { createConversationMarkdown } from './conversationMarkdown'

import { fileChangeOperationLabel, fileChangeOperationTone, formatFileChangeDelta, fileChangeDeltaParts, formatFileChangeCountLabel, fileChangeSummaryLabel, fileChangeSummaryStatusParts } from '../../utils/fileChangePresentation'
import ComposerDropdown from './ComposerDropdown.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { questionAnswerText } from '../../questionResponses'
import { insertQuestionResponseRows, type QuestionResponseRow } from './questionResponseRows'
import { generationMetadataLabel } from '../../turnGenerationMetadata'
import { formatMessageTimestamp } from '../../messageTimestamps'
import type { UiFileChange, UiMessage, UiServerRequestReply } from '../../types/codex'
import { useMobile } from '../../composables/useMobile'
import { copyTextToClipboard } from '../../utils/clipboard'

import { normalizePathSeparators, normalizePathDots, resolveRelativePath } from '../../utils/conversationLinks'
import { indexConversationFileChanges, type TurnFileChangeSummary } from '../../utils/conversationFileChanges'
import { indexConversationPlans, interpretConversationPlan, isPlanMessage, showImplementPlanButton, planStepStatusIcon } from '../../utils/conversationPlan'
import { fileChangeKey } from '../../utils/diffViewerLines'

import ThreadDiffViewer from './ThreadDiffViewer.vue'
import ThreadPendingRequestPanel from './ThreadPendingRequestPanel.vue'

import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import ForkSplitButton from './ForkSplitButton.vue'
import type { ForkMethod } from '../../types/codex'
import IconTablerX from '../icons/IconTablerX.vue'

const expandedCommandIds = ref<Set<string>>(new Set())
const collapsedAutoCommandIds = ref<Set<string>>(new Set())
const expandedCommandGroupIds = ref<Set<string>>(new Set())
const expandedWorkedIds = ref<Set<string>>(new Set())
const expandedFileChangeSummaryIds = ref<Set<string>>(new Set())
const collapsedPlanIds = reactive(new Set<string>())
const activeDiffViewerSummary = ref<TurnFileChangeSummary | null>(null)
const activeDiffViewerChangeKey = ref('')
const isDiffViewerFileListOpen = ref(false)
const fileLinkContextMenuRef = ref<HTMLElement | null>(null)
const isFileLinkContextMenuVisible = ref(false)
const fileLinkContextMenuX = ref(0)
const fileLinkContextMenuY = ref(0)
const fileLinkContextBrowseUrl = ref('')
const { isMobile } = useMobile()

function isCommandMessage(message: UiMessage): boolean {
  return message.messageType === 'commandExecution' && !!message.commandExecution
}

function togglePlan(messageId: string): void {
  if (collapsedPlanIds.has(messageId)) {
    collapsedPlanIds.delete(messageId)
  } else {
    collapsedPlanIds.add(messageId)
  }
}

function implementPlan(message: UiMessage): void {
  const turnId = message.turnId?.trim() ?? ''
  if (!turnId) return
  emit('implementPlan', { turnId })
}

function isFileChangeMessage(message: UiMessage): boolean {
  return message.messageType === 'fileChange'
    && message.fileChangeStatus === 'completed'
    && Array.isArray(message.fileChanges)
    && message.fileChanges.length > 0
}

const activeCommandMessageId = computed(() => {
  for (let index = props.messages.length - 1; index >= 0; index -= 1) {
    const message = props.messages[index]
    if (message.messageType === 'commandExecution' && message.commandExecution?.status === 'inProgress') {
      return message.id
    }
  }
  return ''
})

const hasLiveAssistantText = computed(() =>
  props.messages.some((message) =>
    message.role === 'assistant' &&
    message.messageType === 'agentMessage.live' &&
    message.text.trim().length > 0,
  ),
)

const isLiveTurnRuntime = computed(() =>
  Boolean(props.liveOverlay) || activeCommandMessageId.value.length > 0 || hasLiveAssistantText.value,
)

const groupedCommandsByLatestId = computed<Record<string, UiMessage[]>>(() => {
  const next: Record<string, UiMessage[]> = {}
  for (let index = 0; index < props.messages.length;) {
    const message = props.messages[index]
    if (!isCommandMessage(message)) {
      index += 1
      continue
    }

    const block: UiMessage[] = []
    while (index < props.messages.length && isCommandMessage(props.messages[index])) {
      block.push(props.messages[index])
      index += 1
    }

    if (block.length <= 1) continue
    const latest = block[block.length - 1]
    next[latest.id] = block.slice(0, -1)
  }
  return next
})

const hiddenGroupedCommandIds = computed(() => {
  const next = new Set<string>()
  for (const commands of Object.values(groupedCommandsByLatestId.value)) {
    for (const command of commands) {
      next.add(command.id)
    }
  }
  return next
})

function isCommandAutoExpanded(message: UiMessage): boolean {
  return !hasLiveAssistantText.value && message.id === activeCommandMessageId.value
}

function isCommandExpanded(message: UiMessage): boolean {
  if (!isCommandMessage(message)) return false
  return expandedCommandIds.value.has(message.id)
    || (!collapsedAutoCommandIds.value.has(message.id) && isCommandAutoExpanded(message))
}

function isCommandCompact(message: UiMessage): boolean {
  return isCommandMessage(message) && isLiveTurnRuntime.value
}

function isCommandOutputCondensed(message: UiMessage): boolean {
  return isCommandMessage(message) && (isLiveTurnRuntime.value || message.commandExecution?.status === 'inProgress')
}

function toggleCommandExpand(message: UiMessage): void {
  if (!isCommandMessage(message)) return

  const nextExpanded = new Set(expandedCommandIds.value)
  const nextCollapsedAuto = new Set(collapsedAutoCommandIds.value)
  const isAutoExpanded = isCommandAutoExpanded(message)
  const isManuallyExpanded = nextExpanded.has(message.id)

  if (isManuallyExpanded) {
    nextExpanded.delete(message.id)
    if (isAutoExpanded) nextCollapsedAuto.add(message.id)
  } else if (isAutoExpanded && !nextCollapsedAuto.has(message.id)) {
    nextCollapsedAuto.add(message.id)
  } else {
    nextExpanded.add(message.id)
    nextCollapsedAuto.delete(message.id)
  }

  expandedCommandIds.value = nextExpanded
  collapsedAutoCommandIds.value = nextCollapsedAuto
}

function getGroupedCommandsForLatest(message: UiMessage): UiMessage[] {
  return groupedCommandsByLatestId.value[message.id] ?? []
}

function getCommandBlockForLatest(message: UiMessage): UiMessage[] {
  if (!isCommandMessage(message)) return []
  return [...getGroupedCommandsForLatest(message), message]
}

function toggleCommandGroup(message: UiMessage): void {
  const groupedCommands = getGroupedCommandsForLatest(message)
  if (groupedCommands.length === 0) return
  const next = new Set(expandedCommandGroupIds.value)
  if (next.has(message.id)) next.delete(message.id)
  else next.add(message.id)
  expandedCommandGroupIds.value = next
}

function isCommandGroupExpanded(message: UiMessage): boolean {
  return expandedCommandGroupIds.value.has(message.id)
}

function commandGroupSummaryLabel(message: UiMessage): string {
  const commands = getCommandBlockForLatest(message)
  const count = commands.length
  const latestCommand = message.commandExecution?.command?.trim() || '(command)'
  const countLabel = count === 1 ? '1 command' : `${count} commands`
  return `${countLabel} · latest: ${latestCommand}`
}

function commandGroupSummaryStatus(message: UiMessage): string {
  return commandStatusLabel(message)
}

function toggleWorkedExpand(message: UiMessage): void {
  const next = new Set(expandedWorkedIds.value)
  if (next.has(message.id)) next.delete(message.id)
  else next.add(message.id)
  expandedWorkedIds.value = next
}

function isWorkedExpanded(message: UiMessage): boolean {
  return expandedWorkedIds.value.has(message.id)
}

function toggleFileChangeSummary(message: UiMessage): void {
  const next = new Set(expandedFileChangeSummaryIds.value)
  if (next.has(message.id)) next.delete(message.id)
  else next.add(message.id)
  expandedFileChangeSummaryIds.value = next
}

function isFileChangeSummaryExpanded(message: UiMessage): boolean {
  return expandedFileChangeSummaryIds.value.has(message.id)
}

function openDiffViewer(summary: TurnFileChangeSummary | null, change: UiFileChange): void {
  if (!summary) return
  activeDiffViewerSummary.value = summary
  activeDiffViewerChangeKey.value = fileChangeKey(change)
  isDiffViewerFileListOpen.value = false
}

function closeDiffViewer(): void {
  activeDiffViewerSummary.value = null
  activeDiffViewerChangeKey.value = ''
  isDiffViewerFileListOpen.value = false
}

function toggleDiffViewerFileList(): void {
  isDiffViewerFileListOpen.value = !isDiffViewerFileListOpen.value
}

function closeDiffViewerFileList(): void {
  isDiffViewerFileListOpen.value = false
}

function selectDiffViewerChange(change: UiFileChange): void {
  activeDiffViewerChangeKey.value = fileChangeKey(change)
  if (isMobile.value) {
    isDiffViewerFileListOpen.value = false
  }
}

function commandStatusLabel(message: UiMessage): string {
  const ce = message.commandExecution
  if (!ce) return ''
  const compact = isCommandCompact(message)
  switch (ce.status) {
    case 'inProgress': return compact ? 'Running' : '⟳ Running'
    case 'completed': return ce.exitCode === 0 ? (compact ? 'Done' : '✓ Completed') : `Exit ${ce.exitCode ?? '?'}`
    case 'failed': return compact ? 'Failed' : '✗ Failed'
    case 'declined': return compact ? 'Declined' : '⊘ Declined'
    case 'interrupted': return compact ? 'Stopped' : '⊘ Interrupted'
    default: return ''
  }
}

function commandStatusClass(message: UiMessage): string {
  const s = message.commandExecution?.status
  if (s === 'inProgress') return 'cmd-status-running'
  if (s === 'completed' && message.commandExecution?.exitCode === 0) return 'cmd-status-ok'
  return 'cmd-status-error'
}

function pruneCommandIdSet(source: Set<string>, validIds: Set<string>): Set<string> {
  if (source.size === 0) return source
  const next = new Set<string>()
  for (const id of source) {
    if (validIds.has(id)) next.add(id)
  }
  return next.size === source.size ? source : next
}

function getCommandsForWorked(messages: UiMessage[], workedIndex: number): UiMessage[] {
  const result: UiMessage[] = []
  for (let i = workedIndex - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.messageType === 'commandExecution') result.unshift(m)
    else if (m.role === 'user' || m.messageType === 'worked') break
  }
  return result
}

const props = defineProps<ConversationProps>()

const emit = defineEmits<{
  forkThread: [payload: { threadId: string; target: import('../../types/codex').ResponseForkTarget; method: ForkMethod }]
  rollback: [payload: { threadId: string; turnId: string; operation: import('../../types/codex').RevertOperation; messageId?: string }]
  implementPlan: [payload: { turnId: string }]
  respondServerRequest: [payload: UiServerRequestReply]
  dismissQuestionDraft: [id: number]
  updateQuestionDraft: [questionId: string, field: 'choice' | 'text', value: string]
}>()

const viewport = createConversationViewport({
  get props() { return props; }
})
const {
  conversationListRef,
  bottomAnchorRef,
  isLoadingMore,
  visibleMessages,
  hasMoreAbove,
  showJumpToLatestButton,
  resetMessageNavigation,
  jumpToLatest,
  loadMoreAbove,
  onConversationScroll,
} = viewport

const questionHeading = ref<HTMLButtonElement | null>(null)
const showJumpToQuestionButton = ref(false)

watch([conversationListRef, () => props.activeThreadId, () => props.pendingQuestion?.id], ([root, , questionId], _, onCleanup) => {
  const heading = questionId === undefined ? null : viewport.findQuestionHeading()
  questionHeading.value = heading
  showJumpToQuestionButton.value = false
  if (!root || !heading) return

  const observer = new IntersectionObserver(([entry]) => {
    if (entry) showJumpToQuestionButton.value = !entry.isIntersecting
  }, { root })
  observer.observe(heading)
  onCleanup(() => {
    observer.disconnect()
    observer.takeRecords()
  })
}, { flush: 'post' })

function jumpToQuestion(): void {
  const heading = questionHeading.value
  if (heading) viewport.jumpToQuestion(heading)
}

const modalImageUrl = ref('')
const actions = createConversationActions({
  get threadGeneration() { return viewport.threadGeneration; },
  get readPlan() { return readPlan; },
  get isCurrentThreadGeneration() { return viewport.isCurrentThreadGeneration; },
  get props() { return props; },
  get anchoredFileChangeSummaryByAnchorId() { return anchoredFileChangeSummaryByAnchorId; },
  get buildFileChangeCopyText() { return buildFileChangeCopyText; },
  get emit() { return emit; }
})
const {
  copiedResponseAnchorId,
  copiedUserMessageId,
  copiedPlanId,
  copyPlan,
  showNativeForkButton,
  showCopyResponseButton,
  showForkResponseButton,
  copyUserMessage,
  copyResponse,
  forkResponse,
  showEditMessageButton,
  editMessage,
} = actions

const markdown = createConversationMarkdown({
  get props() { return props; }
})
const {
  highlightCacheVersion,
  markdownImageFailureVersion,
  headingTag,
  headingClass,
  getInlineSegments,
  toBrowseUrl,
  getMessageBlocks,
  renderCachedHighlightedCodeAsHtml,
  renderListItemContentAsHtml,
  renderMarkdownBlocksAsHtml,
} = markdown

const conversationPlans = computed(() => indexConversationPlans(props.messages))

function readPlan(message: UiMessage) {
  return conversationPlans.value.get(message) ?? interpretConversationPlan(message)
}

const fileChangeSummaryIndex = computed(() => indexConversationFileChanges(props.messages))
const anchoredFileChangeSummaryByAnchorId = computed(() => fileChangeSummaryIndex.value.anchored)
const standaloneFileChangeSummaryByMessageId = computed(() => fileChangeSummaryIndex.value.standalone)
const hiddenFileChangeMessageIds = computed(() => fileChangeSummaryIndex.value.hiddenMessageIds)

const hasConversationContent = computed(() =>
  props.messages.length > 0 || props.pendingRequests.length > 0 || Boolean(props.pendingQuestion || props.liveOverlay || props.questionResponses?.length),
)
const pendingQuestionRowKey = Symbol('pendingQuestion')
const conversationRows = computed(() => {
  const visible = visibleMessages.value.filter(message =>
    !hiddenGroupedCommandIds.value.has(message.id) && !hiddenFileChangeMessageIds.value.has(message.id),
  )
  const rows: Array<QuestionResponseRow | null> = props.isLoading ? [] : insertQuestionResponseRows(
    props.messages, visible, props.questionResponses ?? [], visibleMessages.value[0]?.id,
  )
  if (!props.pendingQuestion) return rows

  const turnId = props.pendingQuestion.turnId
  let insertAt = rows.length
  if (turnId) {
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows[index]?.turnId === turnId) {
        insertAt = index + 1
        break
      }
    }
  }
  // Keep the question a keyed sibling of its anchor so a change in position keeps its draft.
  rows.splice(insertAt, 0, null)
  return rows
})

function readAnchoredFileChangeSummary(message: UiMessage): TurnFileChangeSummary | null {
  return anchoredFileChangeSummaryByAnchorId.value[message.id] ?? null
}

function readStandaloneFileChangeSummary(message: UiMessage): TurnFileChangeSummary | null {
  return standaloneFileChangeSummaryByMessageId.value[message.id] ?? null
}

function displayFileChangePath(pathValue: string): string {
  const resolved = resolveRelativePath(pathValue, props.cwd)
  const normalizedCwd = normalizePathDots(normalizePathSeparators(props.cwd.trim()))
  const normalizedResolved = normalizePathDots(normalizePathSeparators(resolved))
  if (normalizedCwd && normalizedResolved.startsWith(`${normalizedCwd}/`)) {
    return normalizedResolved.slice(normalizedCwd.length + 1)
  }
  return pathValue
}

function buildFileChangeCopyText(summary: TurnFileChangeSummary | null): string {
  if (!summary || summary.changes.length === 0) return ''
  const lines = summary.changes.map((change) => {
    const pathLabel = displayFileChangePath(change.path)
    const movedLabel = change.movedToPath ? ` -> ${displayFileChangePath(change.movedToPath)}` : ''
    const delta = formatFileChangeDelta(change)
    return `- ${fileChangeOperationLabel(change)}: ${pathLabel}${movedLabel}${delta ? ` (${delta})` : ''}`
  })
  return `Modified files:\n${lines.join('\n')}`.trim()
}

const diffViewerChanges = computed<UiFileChange[]>(() => activeDiffViewerSummary.value?.changes ?? [])

const activeDiffViewerChange = computed<UiFileChange | null>(() => {
  const changes = diffViewerChanges.value
  if (changes.length === 0) return null
  return changes.find((change) => fileChangeKey(change) === activeDiffViewerChangeKey.value) ?? changes[0]
})

function inferDiffViewerLanguage(change: UiFileChange): string {
  const targetPath = change.movedToPath || change.path
  const extension = targetPath.split('.').pop()?.toLowerCase() ?? ''
  return markdown.CODE_LANGUAGE_ALIASES[extension] ?? extension
}

const fileLinkContextMenuStyle = computed(() => ({
  left: `${String(fileLinkContextMenuX.value)}px`,
  top: `${String(fileLinkContextMenuY.value)}px`,
}))

function onConversationContextMenu(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return

  const anchor = target.closest('a.message-file-link')
  if (!(anchor instanceof HTMLAnchorElement)) return

  const href = (anchor.getAttribute('href') ?? '').trim()
  if (!href || href === '#') return

  event.preventDefault()
  event.stopPropagation()

  fileLinkContextBrowseUrl.value = href
  fileLinkContextMenuX.value = event.clientX
  fileLinkContextMenuY.value = event.clientY
  isFileLinkContextMenuVisible.value = true
}

function closeFileLinkContextMenu(): void {
  if (!isFileLinkContextMenuVisible.value) return
  isFileLinkContextMenuVisible.value = false
}

function openFileLinkContextBrowse(): void {
  const href = fileLinkContextBrowseUrl.value
  closeFileLinkContextMenu()
  if (!href || href === '#') return
  window.open(href, '_blank', 'noopener,noreferrer')
}

async function copyFileLinkContextLink(): Promise<void> {
  const href = fileLinkContextBrowseUrl.value
  closeFileLinkContextMenu()
  if (!href || href === '#') return

  try {
    await copyTextToClipboard(href)
  } catch {
    // Clipboard writes can be blocked by browser permissions; keep the context action best-effort.
  }
}

function onWindowPointerDownForFileLinkContextMenu(event: PointerEvent): void {
  if (!isFileLinkContextMenuVisible.value) return
  const menu = fileLinkContextMenuRef.value
  if (!menu) {
    closeFileLinkContextMenu()
    return
  }
  const target = event.target
  if (target instanceof Node && menu.contains(target)) return
  closeFileLinkContextMenu()
}

function onWindowBlurForFileLinkContextMenu(): void {
  closeFileLinkContextMenu()
}

function onWindowKeydownForFileLinkContextMenu(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  closeFileLinkContextMenu()
}

// Retain the selected row when the last message cannot align with the viewport top.

defineExpose({
  jumpToLatest: viewport.jumpToLatest,
})

watch(
  () => props.messages,
  async (next) => {
    if (props.isLoading) return

    const commandIds = new Set(
      next
        .filter((message) => message.messageType === 'commandExecution' && message.commandExecution)
        .map((message) => message.id),
    )
    expandedCommandIds.value = pruneCommandIdSet(expandedCommandIds.value, commandIds)
    collapsedAutoCommandIds.value = pruneCommandIdSet(collapsedAutoCommandIds.value, commandIds)
    expandedCommandGroupIds.value = pruneCommandIdSet(
      expandedCommandGroupIds.value,
      new Set(Object.keys(groupedCommandsByLatestId.value)),
    )
    expandedFileChangeSummaryIds.value = pruneCommandIdSet(
      expandedFileChangeSummaryIds.value,
      new Set([
        ...Object.keys(anchoredFileChangeSummaryByAnchorId.value),
        ...Object.keys(standaloneFileChangeSummaryByMessageId.value),
      ]),
    )

    // Keep renderWindowStart in bounds whenever the message list changes length.
    // Following output: always pin the window to the last RENDER_WINDOW_SIZE messages so
    //   the rendered count stays bounded (handles both growth and shrink/rollback).
    // Scrolled up: only clamp downward so renderWindowStart never exceeds the list length
    //   (prevents visibleMessages from becoming empty after a rollback).
    if (viewport.autoFollowOutput.value) {
      viewport.renderWindowStart.value = Math.max(0, next.length - viewport.RENDER_WINDOW_SIZE)
    } else {
      viewport.renderWindowStart.value = Math.min(viewport.renderWindowStart.value, Math.max(0, next.length - 1))
    }

    await viewport.scheduleConversationScroll()
  },
)

watch(
  () => props.messages.some((message) => (message.text.includes('```') || message.text.includes('~~~'))),
  (hasCodeBlocks) => {
    if (!hasCodeBlocks || markdown.highlightJsModule.value) return
    void markdown.ensureHighlightJsLoaded()
  },
  { immediate: true },
)

watch(
  activeCommandMessageId,
  (nextId, prevId) => {
    if (!prevId || prevId === nextId) return
    if (!collapsedAutoCommandIds.value.has(prevId)) return
    const nextCollapsedAuto = new Set(collapsedAutoCommandIds.value)
    nextCollapsedAuto.delete(prevId)
    collapsedAutoCommandIds.value = nextCollapsedAuto
  },
)

watch(
  () => props.pendingRequests,
  async () => {
    if (props.isLoading) return
    await viewport.scheduleConversationScroll()
  },
  { deep: true },
)

watch(
  () => props.liveOverlay,
  async (overlay) => {
    if (!overlay) return
    if (!viewport.autoFollowOutput.value) return
    const generation = viewport.threadGeneration
    await nextTick()
    if (!viewport.isCurrentThreadGeneration(generation) || !viewport.autoFollowOutput.value) return
    viewport.enforceBottomState()
    viewport.scheduleBottomLock(8)
  },
  { deep: true },
)

watch(
  () => props.isLoading,
  async (loading) => {
    if (loading) return
    viewport.renderWindowStart.value = Math.max(0, props.messages.length - viewport.RENDER_WINDOW_SIZE)
    await viewport.scheduleConversationScroll()
  },
)

watch(
  () => props.activeThreadId,
  () => {
    viewport.invalidateThreadWork()
    modalImageUrl.value = ''
    viewport.isLoadingMore.value = false
    closeDiffViewer()
    closeFileLinkContextMenu()
    fileLinkContextBrowseUrl.value = ''
    expandedCommandIds.value = new Set()
    collapsedAutoCommandIds.value = new Set()
    expandedCommandGroupIds.value = new Set()
    expandedWorkedIds.value = new Set()
    expandedFileChangeSummaryIds.value = new Set()
    collapsedPlanIds.clear()
    failedMarkdownImages.value = new Set()
    markdown.markdownImageFailureVersion.value += 1
    actions.copiedResponseAnchorId.value = ''
    actions.copiedUserMessageId.value = ''
    actions.copiedPlanId.value = ''
    if (actions.copiedMessageResetTimer) clearTimeout(actions.copiedMessageResetTimer)
    if (actions.copiedUserMessageResetTimer) clearTimeout(actions.copiedUserMessageResetTimer)
    if (actions.copiedPlanResetTimer) clearTimeout(actions.copiedPlanResetTimer)
    actions.copiedMessageResetTimer = actions.copiedUserMessageResetTimer = actions.copiedPlanResetTimer = null
  },
  { flush: 'sync' },
)

watch(
  () => props.activeThreadId,
  async () => {
    viewport.autoFollowOutput.value = true
    // Apply immediately for cached threads where isLoading never toggles.
    viewport.renderWindowStart.value = Math.max(0, props.messages.length - viewport.RENDER_WINDOW_SIZE)
    await viewport.scheduleConversationScroll()
  },
  { flush: 'post' },
)

const failedMarkdownImages = ref(new Set<string>())

function markdownImageKey(messageId: string, blockIndex: number, url: string): string {
  return JSON.stringify([messageId, blockIndex, url])
}

function isMarkdownImageFailed(messageId: string, blockIndex: number, url: string): boolean {
  return failedMarkdownImages.value.has(markdownImageKey(messageId, blockIndex, url))
}

function onMarkdownImageError(messageId: string, blockIndex: number, url: string): void {
  const next = new Set(failedMarkdownImages.value)
  next.add(markdownImageKey(messageId, blockIndex, url))
  failedMarkdownImages.value = next
  markdown.markdownImageFailureVersion.value += 1
}

function openImageModal(imageUrl: string): void {
  modalImageUrl.value = imageUrl
}

function closeImageModal(): void {
  modalImageUrl.value = ''
}

onMounted(() => {
  window.addEventListener('focusin', viewport.onQuestionFocusIn, true)
  window.addEventListener('keydown', viewport.onMessageNavigationKeydown)
  window.addEventListener('pointerdown', onWindowPointerDownForFileLinkContextMenu)
  window.addEventListener('blur', onWindowBlurForFileLinkContextMenu)
  window.addEventListener('keydown', onWindowKeydownForFileLinkContextMenu)
})

onBeforeUnmount(() => {
  viewport.conversationUnmounted = true
  viewport.invalidateThreadWork()
  if (actions.copiedUserMessageResetTimer) {
    clearTimeout(actions.copiedUserMessageResetTimer)
    actions.copiedUserMessageResetTimer = null
  }
  markdown.clearRenderCaches()
  if (actions.copiedMessageResetTimer) {
    clearTimeout(actions.copiedMessageResetTimer)
    actions.copiedMessageResetTimer = null
  }
  if (actions.copiedPlanResetTimer) {
    clearTimeout(actions.copiedPlanResetTimer)
    actions.copiedPlanResetTimer = null
  }
  window.removeEventListener('focusin', viewport.onQuestionFocusIn, true)
  window.removeEventListener('keydown', viewport.onMessageNavigationKeydown)
  window.removeEventListener('pointerdown', onWindowPointerDownForFileLinkContextMenu)
  window.removeEventListener('blur', onWindowBlurForFileLinkContextMenu)
  window.removeEventListener('keydown', onWindowKeydownForFileLinkContextMenu)
})
</script>

<style scoped>
@reference "tailwindcss";

.conversation-root {
  @apply relative h-full min-h-0 min-w-0 p-0 flex flex-col overflow-y-hidden overflow-x-hidden bg-transparent border-none rounded-none;
}

.conversation-loading {
  @apply m-0 px-6 text-sm text-slate-500;
}

.conversation-empty {
  @apply m-0 px-6 text-sm text-slate-500;
}

.conversation-list {
  @apply h-full min-h-0 list-none m-0 px-2 sm:px-6 py-0 overflow-y-auto overflow-x-visible flex flex-col gap-2 sm:gap-3;
}

.conversation-load-more {
  @apply flex justify-center py-3 m-0;
}

.load-more-button {
  @apply px-4 py-1.5 text-xs rounded-full border border-slate-300 dark:border-slate-600
         text-slate-500 dark:text-slate-400 bg-transparent
         hover:bg-slate-100 dark:hover:bg-slate-800
         disabled:opacity-40 disabled:cursor-not-allowed
         transition-colors cursor-pointer;
}

.conversation-item {
  @apply m-0 w-full min-w-0 flex;
}

.conversation-item-overlay {
  @apply justify-center;
}

.message-row {
  @apply relative w-full min-w-0 max-w-[min(var(--chat-column-max,45rem),100%)] mx-auto flex;
}

.message-row[data-role='user'] {
  @apply justify-end;
}

.message-row[data-role='assistant'],
.message-row[data-role='system'] {
  @apply justify-start;
}

.conversation-bottom-anchor {
  @apply h-px;
}

.conversation-jump-actions {
  @apply absolute left-1/2 bottom-4 z-20 flex -translate-x-1/2 items-center gap-2;
}

.conversation-jump-button {
  @apply inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white/96 text-slate-700 shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-white hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current;
}

.jump-to-question-button {
  @apply px-4 text-sm font-medium whitespace-nowrap;
}

.jump-to-latest-button {
  @apply w-11;
}

.jump-to-latest-icon {
  transform: rotate(180deg);
}

.message-stack {
  @apply flex flex-col w-full min-w-0;
}

.live-overlay-inline {
  @apply w-full max-w-[min(var(--chat-column-max,45rem),100%)] px-0 py-1 flex flex-col gap-1;
}

.live-overlay-label {
  @apply m-0 text-sm leading-5 font-medium text-zinc-600;
}

.live-overlay-reasoning {
  @apply m-0 text-sm leading-5 text-zinc-500 whitespace-pre-wrap break-words;
  display: block;
  max-height: calc(1.25rem * 5);
  overflow: auto;
  overflow-wrap: anywhere;
  scrollbar-width: none;
  mask-image: linear-gradient(to top, black 75%, transparent 100%);
  -webkit-mask-image: linear-gradient(to top, black 75%, transparent 100%);
}

.live-overlay-reasoning::-webkit-scrollbar {
  display: none;
}

.live-overlay-error {
  @apply m-0 flex items-start justify-between gap-3 text-sm leading-5 text-rose-600 whitespace-pre-wrap;
}

.message-body {
  @apply flex flex-col min-w-0 max-w-full;
  width: fit-content;
}

.message-body[data-role='user'] {
  @apply ml-auto items-end;
  align-self: flex-end;
}

.message-toolbar {
  @apply mt-1 self-start flex items-center gap-1 opacity-[0.01] transition-opacity duration-200;
}

.message-toolbar[data-role='user'] {
  align-self: flex-end;
}

.message-row:hover .message-toolbar,
.message-toolbar:focus-within {
  @apply opacity-100;
}

@media (hover: none) {
  .message-toolbar { opacity: 1; }
}

.message-copy-button {
  @apply inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white/90 px-1.25 py-0.5 text-[9px] font-medium leading-none text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900;
}

.message-copy-button[data-copied='true'] {
  @apply border-emerald-200 bg-emerald-50 text-emerald-700;
}

.message-edit-button {
  @apply inline-flex items-center gap-0.5 px-0.5 py-0 text-[9px] font-medium leading-none text-amber-600/70 transition hover:text-amber-700;
}

.message-copy-icon,
.message-edit-icon {
  @apply text-[10px];
}

.message-copy-label,
.message-edit-label {
  @apply leading-none;
}

.message-image-list {
  @apply list-none m-0 mb-2 p-0 flex flex-wrap gap-2;
}

.message-image-list[data-role='user'] {
  @apply ml-auto justify-end;
}

.message-generated-image-list {
  @apply gap-3;
}

.message-image-item {
  @apply m-0;
}

.message-image-button {
  @apply block rounded-xl overflow-hidden border border-slate-300 bg-white p-0 transition hover:border-slate-400;
}

.message-image-preview {
  @apply block w-16 h-16 object-cover;
}

.message-generated-image-preview {
  @apply w-auto h-auto max-w-[min(560px,85vw)] max-h-[min(460px,62vh)] object-contain bg-white;
}

.message-file-attachments {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.message-skill-attachments {
  @apply mb-2 flex flex-wrap justify-end gap-1.5;
}

.message-file-chip {
  @apply inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700;
}

.message-skill-chip {
  @apply inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 no-underline transition hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-900;
}

.message-skill-chip-prefix {
  @apply shrink-0 font-medium text-emerald-700;
}

.message-skill-chip-name {
  @apply min-w-0 max-w-48 truncate font-mono;
}

.message-file-chip-icon {
  @apply text-[10px] leading-none;
}

.message-file-chip-name {
  @apply truncate max-w-48 font-mono;
}

.message-card {
  @apply max-w-[min(var(--chat-card-max,76ch),100%)] px-0 py-0 bg-transparent border-none rounded-none;
}

.message-text-flow {
  @apply flex flex-col gap-2;
}

.plan-card {
  @apply flex max-w-[min(var(--chat-card-max,76ch),100%)] flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-slate-900;
}

.plan-card-header {
  @apply flex items-center justify-between gap-3;
}

.plan-card-badge {
  @apply inline-flex items-center rounded-full bg-sky-200 px-2 py-0.5 text-[11px] font-medium leading-4 text-sky-900;
}

.plan-card-explanation {
  @apply text-slate-700;
}

.plan-card-markdown {
  @apply flex flex-col gap-2;
}

.plan-card-markdown :deep(.message-text),
.plan-card-markdown :deep(.message-heading),
.plan-card-markdown :deep(.message-blockquote),
.plan-card-markdown :deep(.message-list),
.plan-card-markdown :deep(.message-table-wrap),
.plan-card-markdown :deep(.message-code-block),
.plan-card-markdown :deep(.message-divider) {
  @apply m-0;
}

.plan-card-markdown :deep(.message-text) {
  @apply text-sm leading-relaxed whitespace-pre-wrap text-slate-800;
}

.plan-card-markdown :deep(.message-heading) {
  @apply text-slate-900 tracking-tight;
}

.plan-card-markdown :deep(.message-heading-h1) {
  @apply text-2xl font-semibold leading-tight;
}

.plan-card-markdown :deep(.message-heading-h2) {
  @apply text-xl font-semibold leading-tight;
}

.plan-card-markdown :deep(.message-heading-h3) {
  @apply text-lg font-semibold leading-snug;
}

.plan-card-markdown :deep(.message-heading-h4) {
  @apply text-base font-semibold leading-snug;
}

.plan-card-markdown :deep(.message-heading-h5) {
  @apply text-sm font-semibold leading-snug uppercase tracking-[0.02em];
}

.plan-card-markdown :deep(.message-heading-h6) {
  @apply text-xs font-semibold leading-snug uppercase tracking-[0.04em] text-slate-600;
}

.plan-card-markdown :deep(.message-blockquote) {
  @apply border-l-4 border-slate-300 pl-4 py-1 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 bg-slate-50/70 rounded-r-lg;
}

.plan-card-markdown :deep(.message-list) {
  @apply pl-5 text-sm leading-relaxed text-slate-800 flex flex-col gap-1.5;
}

.plan-card-markdown :deep(.message-list-unordered) {
  @apply list-disc;
}

.plan-card-markdown :deep(.message-list-ordered) {
  @apply list-decimal;
}

.plan-card-markdown :deep(.message-list-item) {
  @apply pl-1;
}

.plan-card-markdown :deep(.message-list-item-text) {
  @apply whitespace-pre-wrap;
}

.plan-card-markdown :deep(.message-list-item-paragraph + .message-list-item-paragraph) {
  @apply mt-2;
}

.plan-card-markdown :deep(.message-task-list) {
  @apply list-none pl-0;
}

.plan-card-markdown :deep(.message-task-item) {
  @apply flex items-start gap-2;
}

.plan-card-markdown :deep(.message-task-checkbox) {
  @apply mt-0.5 text-sm leading-none text-slate-500 select-none;
}

.plan-card-markdown :deep(.message-code-block) {
  @apply overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900;
}

.plan-card-markdown :deep(.message-code-language) {
  @apply border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-600;
}

.plan-card-markdown :deep(.message-code-pre) {
  @apply m-0 overflow-x-auto px-3 py-3 text-[13px] leading-6;
}

.plan-card-markdown :deep(.message-inline-code) {
  @apply bg-transparent p-0 font-sans text-[1em] font-semibold text-inherit;
}

.plan-card-markdown :deep(.message-file-link) {
  @apply text-sky-700 underline decoration-sky-300 underline-offset-2;
}

.plan-card-markdown :deep(.message-table) {
  @apply bg-white/90;
}

.plan-step-list {
  @apply m-0 flex list-none flex-col gap-2 p-0;
}

.plan-step-item {
  @apply flex items-start gap-2 rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm leading-relaxed text-slate-800;
}

.plan-step-item[data-status='completed'] {
  @apply border-emerald-200 bg-emerald-50/80;
}

.plan-step-item[data-status='inProgress'] {
  @apply border-amber-200 bg-amber-50/80;
}

.plan-step-status {
  @apply mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700;
}

.plan-step-status[data-status='completed'] {
  @apply bg-emerald-200 text-emerald-900;
}

.plan-step-status[data-status='inProgress'] {
  @apply bg-amber-200 text-amber-900;
}

.plan-step-text {
  @apply min-w-0 flex-1;
}

.plan-card-actions {
  @apply mt-3 flex justify-end;
}

.plan-card-implement-button {
  @apply inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50;
}

.message-text {
  @apply m-0 text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800;
  overflow-wrap: anywhere;
}

.message-heading {
  @apply m-0 text-slate-900 tracking-tight;
}

.message-heading-h1 {
  @apply text-2xl font-semibold leading-tight;
}

.message-heading-h2 {
  @apply text-xl font-semibold leading-tight;
}

.message-heading-h3 {
  @apply text-lg font-semibold leading-snug;
}

.message-heading-h4 {
  @apply text-base font-semibold leading-snug;
}

.message-heading-h5 {
  @apply text-sm font-semibold leading-snug uppercase tracking-[0.02em];
}

.message-heading-h6 {
  @apply text-xs font-semibold leading-snug uppercase tracking-[0.04em] text-slate-600;
}

.message-blockquote {
  @apply m-0 border-l-4 border-slate-300 pl-4 py-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-700 bg-slate-50/70 rounded-r-lg;
  overflow-wrap: anywhere;
}

.message-list {
  @apply m-0 pl-5 text-sm leading-relaxed text-slate-800 flex flex-col gap-1.5;
}

.message-list-unordered {
  @apply list-disc;
}

.message-list-ordered {
  @apply list-decimal;
}

.message-list-item {
  @apply pl-1;
}

.message-list-item-content {
  @apply flex flex-col gap-1.5;
}

.message-list-item-text {
  @apply whitespace-pre-wrap break-words;
  overflow-wrap: anywhere;
}

.message-list-item-paragraph + .message-list-item-paragraph {
  @apply mt-2;
}

.message-task-list {
  @apply list-none pl-0;
}

.message-task-item {
  @apply flex items-start gap-2;
}

.message-task-checkbox {
  @apply mt-0.5 text-sm leading-none text-slate-500 select-none;
}

.message-table-wrap {
  @apply w-full overflow-x-auto;
}

.message-table {
  @apply min-w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm text-slate-800;
}

.message-table-head-cell,
.message-table-cell {
  @apply border-b border-l border-slate-200 px-3 py-2 align-top whitespace-pre-wrap break-words;
  overflow-wrap: anywhere;
}

.message-table-head-cell:first-child,
.message-table-cell:first-child {
  @apply border-l-0;
}

.message-table-head-cell {
  @apply bg-slate-100 font-semibold text-slate-900;
}

.message-table-body-row:last-child .message-table-cell {
  @apply border-b-0;
}

.message-bold-text {
  @apply font-semibold text-slate-900;
}

.message-italic-text {
  @apply italic;
}

.message-strikethrough-text {
  @apply line-through text-slate-500;
}

.message-markdown-image {
  @apply w-auto h-auto max-w-[min(560px,85vw)] max-h-[min(460px,62vh)] object-contain bg-white;
}

.message-inline-code {
  @apply bg-transparent p-0 font-sans text-[1em] font-semibold text-inherit;
  line-height: inherit;
}

.message-code-block {
  @apply overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100;
}

.message-code-language {
  @apply border-b border-slate-800 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-slate-400;
}

.message-code-pre {
  @apply m-0 overflow-x-auto px-3 py-3 text-[13px] leading-relaxed font-mono whitespace-pre;
}

.message-code-pre :deep(.hljs) {
  @apply block bg-transparent p-0 text-inherit;
}

.message-file-link {
  @apply text-sm leading-relaxed text-[#0969da] no-underline hover:text-[#1f6feb] hover:underline underline-offset-2;
}

.file-link-context-menu {
  @apply fixed z-50 min-w-36 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl;
}

.file-link-context-menu-item {
  @apply block w-full rounded-md px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100;
}

.message-divider {
  @apply m-0 border-0 h-px bg-slate-300/80;
}

.message-stack[data-role='user'] {
  @apply items-end;
}

.message-stack[data-role='assistant'],
.message-stack[data-role='system'] {
  @apply items-start;
}

.message-card[data-role='user'] {
  @apply rounded-2xl bg-slate-200 px-4 py-3 max-w-[min(560px,100%)];
  width: fit-content;
  margin-left: auto;
  align-self: flex-end;
}

.message-plan-badge {
  @apply mb-1.5 inline-flex self-end rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700;
}

.question-response-card section + section {
  @apply mt-3;
}

.question-response-card h3 {
  @apply font-semibold;
}

.question-response-card p {
  @apply whitespace-pre-wrap break-words;
}

.automation-message-label {
  @apply mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500;
}

.automation-message-label code {
  @apply rounded-full bg-white/70 px-2 py-0.5 text-[10px] normal-case tracking-normal text-slate-600;
}

.message-card[data-role='assistant'],
.message-card[data-role='system'] {
  @apply px-0 py-0 bg-transparent border-none rounded-none;
}

:global(.dark) .message-file-chip {
  @apply border-zinc-700 bg-zinc-900 text-zinc-200;
}

:global(.dark) .message-skill-chip {
  @apply border-emerald-800/70 bg-emerald-950/50 text-emerald-100;
}

:global(.dark) .message-skill-chip-prefix {
  @apply text-emerald-300;
}

.conversation-item[data-message-type='worked'] .message-stack,
.conversation-item[data-message-type='worked'] .message-body,
.conversation-item[data-message-type='worked'] .message-card {
  @apply w-full max-w-full;
}

.worked-separator-wrap {
  @apply w-full flex flex-col gap-0;
}

.worked-separator {
  @apply w-full flex items-center gap-3 bg-transparent border-none cursor-pointer p-0;
}

.worked-chevron {
  @apply text-[9px] text-zinc-400 transition-transform duration-200 flex-shrink-0;
}

.worked-chevron-open {
  transform: rotate(90deg);
}

.worked-separator-line {
  @apply h-px bg-zinc-300/80 flex-1;
}

.worked-separator-text {
  @apply m-0 text-sm leading-relaxed font-normal text-slate-800;
}

.worked-details {
  @apply flex flex-col gap-1.5 pt-2;
}

.worked-cmd-item {
  @apply flex flex-col;
}

.image-modal-backdrop {
  @apply fixed inset-0 z-50 bg-black/40 p-6 flex items-center justify-center;
}

.image-modal-content {
  @apply relative max-w-[min(92vw,1100px)] max-h-[92vh];
}

.image-modal-close {
  @apply absolute top-2 right-2 z-10 w-10 h-10 rounded-full bg-white/90 text-slate-900 border border-slate-300 flex items-center justify-center;
}

.image-modal-image {
  @apply block max-w-full max-h-[90vh] rounded-2xl shadow-2xl bg-white;
}

.icon-svg {
  @apply w-5 h-5;
}

.cmd-row {
  @apply w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 cursor-pointer transition text-left hover:bg-zinc-100;
}

.cmd-row.cmd-row-group {
  @apply border-dashed border-zinc-300 bg-zinc-100/90 text-zinc-600;
}

.cmd-row.cmd-compact {
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border-radius: 0.625rem;
}

.cmd-row.cmd-compact .cmd-chevron {
  font-size: 9px;
}

.cmd-row.cmd-compact .cmd-label {
  font-size: 0.75rem;
}

.cmd-row.cmd-compact .cmd-status {
  max-width: 4.5rem;
  font-size: 0.75rem;
}

.cmd-row.cmd-expanded {
  @apply rounded-b-none;
}

.cmd-chevron {
  @apply text-[10px] text-zinc-400 transition-transform duration-150 flex-shrink-0;
}

.cmd-chevron-open {
  transform: rotate(90deg);
}

.cmd-label {
  @apply flex-1 min-w-0 truncate text-xs font-mono text-zinc-700;
}

.cmd-group-label {
  @apply flex-1 min-w-0 truncate text-xs font-medium text-zinc-600;
}

.cmd-status {
  @apply max-w-24 truncate text-right text-[11px] font-medium flex-shrink-0;
}

.cmd-status-running .cmd-status {
  @apply text-amber-600;
}

.cmd-status-ok .cmd-status {
  @apply text-emerald-600;
}

.cmd-status-error .cmd-status {
  @apply text-rose-600;
}

.cmd-output-wrap {
  @apply rounded-b-lg bg-zinc-900;
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms ease-out, border-color 300ms ease-out;
  border: 1px solid transparent;
  border-top: none;
}

.cmd-output-wrap.cmd-output-visible {
  grid-template-rows: 1fr;
  border-color: #e4e4e7;
}

.cmd-group-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 220ms ease-out;
}

.cmd-group-wrap.cmd-group-visible {
  grid-template-rows: 1fr;
}

.cmd-group-inner {
  @apply mb-1 flex min-h-0 flex-col gap-1 overflow-hidden pl-2;
}

.cmd-output-inner {
  overflow: hidden;
  min-height: 0;
}

.cmd-output {
  @apply m-0 px-3 py-2 text-xs font-mono text-zinc-200 whitespace-pre-wrap break-words max-h-60 overflow-y-auto;
}

.cmd-output.cmd-output-condensed {
  max-height: 9rem;
}

.file-change-summary-block {
  @apply mt-3 flex flex-col gap-0;
}

.file-change-summary-block-inline {
  @apply mt-4;
}

.file-change-summary-row {
  @apply border-dashed;
}

.file-change-summary-label {
  @apply flex-1 min-w-0 truncate text-xs font-medium text-zinc-700;
}

.file-change-summary-status {
  @apply inline-flex max-w-28 items-center justify-end gap-1.5 text-right text-[11px] font-semibold text-zinc-500 flex-shrink-0;
}

.file-change-panel-inner {
  @apply mb-1 min-h-0 overflow-hidden pl-2;
}

.file-change-list {
  @apply m-0 flex list-none flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white/80 p-1.5;
}

.file-change-item {
  @apply flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-zinc-700;
}

.file-change-badge {
  @apply inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em];
}

.file-change-badge[data-operation='add'] {
  @apply bg-emerald-50 text-emerald-700;
}

.file-change-badge[data-operation='update'] {
  @apply bg-sky-50 text-sky-700;
}

.file-change-badge[data-operation='delete'] {
  @apply bg-rose-50 text-rose-700;
}

.file-change-badge[data-operation='move'] {
  @apply bg-amber-50 text-amber-700;
}

.file-change-path {
  @apply min-w-0 break-all font-mono text-[13px];
}

.file-change-path-button {
  @apply min-w-0 border-0 bg-transparent p-0 text-left font-mono text-[13px] text-[#0969da] hover:text-[#1f6feb] hover:underline underline-offset-2;
}

.file-change-arrow {
  @apply text-zinc-400;
}

.file-change-delta {
  @apply ml-auto inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-600;
}

.file-change-signed-count {
  @apply inline-flex items-center whitespace-nowrap;
}

.file-change-signed-count[data-tone='add'] {
  @apply text-emerald-600;
}

.file-change-signed-count[data-tone='remove'] {
  @apply text-rose-600;
}

</style>
