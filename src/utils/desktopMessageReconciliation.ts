import type { CommandExecutionData, UiFileChange, UiMessage, UiPlanData, UiPlanStep } from '../types/codex'

export function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.status === second.status && first.aggregatedOutput === second.aggregatedOutput && first.exitCode === second.exitCode
}

function arePlanStepsEqual(first: UiPlanStep[] = [], second: UiPlanStep[] = []): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index]?.step !== second[index]?.step || first[index]?.status !== second[index]?.status) {
      return false
    }
  }
  return true
}

function arePlanDataEqual(first?: UiPlanData, second?: UiPlanData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.explanation === second.explanation &&
    first.isStreaming === second.isStreaming &&
    arePlanStepsEqual(first.steps, second.steps)
  )
}

export function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    first.submittedAt === second.submittedAt &&
    first.completedAt === second.completedAt &&
    areStringArraysEqual(first.images, second.images) &&
    areUiFileChangesEqual(first.fileChanges, second.fileChanges) &&
    first.fileChangeStatus === second.fileChangeStatus &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
    arePlanDataEqual(first.plan, second.plan) &&
    first.turnId === second.turnId &&
    first.generationMetadata?.model === second.generationMetadata?.model &&
    first.generationMetadata?.effort === second.generationMetadata?.effort &&
    first.generationMetadata?.modelSource === second.generationMetadata?.modelSource &&
    first.generationMetadata?.effortSource === second.generationMetadata?.effortSource &&
    first.turnIndex === second.turnIndex &&
    first.isAutomationRun === second.isAutomationRun &&
    first.automationDisplayName === second.automationDisplayName
  )
}

export function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

export function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean } = {},
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous
    .map((previousMessage) => {
      const nextMessage = incomingById.get(previousMessage.id)
      if (!nextMessage) {
        return previousMessage
      }
      if (areMessageFieldsEqual(previousMessage, nextMessage)) {
        return previousMessage
      }
      return nextMessage
    })
    .filter((message) => !isOptimisticUserMessage(message) || !hasEquivalentUserMessage(message, incoming))

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const merged = [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function areUiFileChangesEqual(first?: UiFileChange[], second?: UiFileChange[]): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    const firstChange = first[index]
    const secondChange = second[index]
    if (
      firstChange.path !== secondChange.path ||
      firstChange.operation !== secondChange.operation ||
      firstChange.movedToPath !== secondChange.movedToPath ||
      firstChange.diff !== secondChange.diff ||
      firstChange.addedLineCount !== secondChange.addedLineCount ||
      firstChange.removedLineCount !== secondChange.removedLineCount
    ) {
      return false
    }
  }
  return true
}

export function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function isOptimisticUserMessage(message: UiMessage): boolean {
  return message.messageType === 'userMessage.optimistic'
}

export function hasOptimisticUserMessages(messages: UiMessage[]): boolean {
  return messages.some(isOptimisticUserMessage)
}

export function hasEquivalentUserMessage(target: UiMessage, messages: UiMessage[]): boolean {
  if (target.role !== 'user') return false
  // A turn ID is assigned to the specific optimistic submission once the
  // server accepts it. Prefer that identity over prompt content: attachment
  // prompts can be rewritten by the server, and identical prompts/files can
  // also be submitted intentionally in separate turns.
  if (target.turnId) {
    return messages.some((message) =>
      message !== target &&
      message.role === 'user' &&
      !isOptimisticUserMessage(message) &&
      message.turnId === target.turnId,
    )
  }

  const targetText = normalizeMessageText(target.text)
  const targetImages = Array.isArray(target.images) ? target.images : []
  const targetFileCount = Array.isArray(target.fileAttachments) ? target.fileAttachments.length : 0
  const targetSkillCount = Array.isArray(target.skills) ? target.skills.length : 0

  return messages.some((message) => {
    if (message === target || message.role !== 'user' || isOptimisticUserMessage(message)) return false
    if (typeof target.turnIndex === 'number' && typeof message.turnIndex === 'number' && target.turnIndex !== message.turnIndex) {
      return false
    }
    const messageText = normalizeMessageText(message.text)
    const messageImages = Array.isArray(message.images) ? message.images : []
    const messageFileCount = Array.isArray(message.fileAttachments) ? message.fileAttachments.length : 0
    const messageSkillCount = Array.isArray(message.skills) ? message.skills.length : 0
    return (
      messageText === targetText &&
      areStringArraysEqual(messageImages, targetImages) &&
      messageFileCount === targetFileCount &&
      messageSkillCount === targetSkillCount
    )
  })
}

export function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingById = new Map(incoming.map((message) => [message.id, message]))
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant' && message.turnId)
      .map((message) => JSON.stringify([message.turnId, normalizeMessageText(message.text)])),
  )

  const next = previous.filter((message) => {
    const persisted = incomingById.get(message.id)
    if (persisted) {
      // A history snapshot can trail the latest delta for the same item.
      return !normalizeMessageText(persisted.text).startsWith(normalizeMessageText(message.text))
    }
    if (message.messageType !== 'agentMessage.live') return true
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return true
    return !incomingAssistantTexts.has(JSON.stringify([message.turnId, normalized]))
  })

  return next.length === previous.length ? previous : next
}

export function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) {
    return [...previous, nextMessage]
  }

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, nextMessage)) {
    return previous
  }

  const next = [...previous]
  next.splice(existingIndex, 1, nextMessage)
  return next
}

