import type { UiFileChange, UiMessage } from '../types/codex'

export type TurnFileChangeSummary = {
  changes: UiFileChange[]
  sourceMessageIds: string[]
  source: 'assistant' | 'metadata'
  turnId: string
}

export function isCopyableAssistantMessage(message: UiMessage): boolean {
  return message.role === 'assistant'
    && !(message.messageType === 'commandExecution' && !!message.commandExecution)
    && message.messageType !== 'worked'
    && !(message.messageType ?? '').endsWith('.live')
}

function isFileChangeMessage(message: UiMessage): boolean {
  return message.messageType === 'fileChange'
    && message.fileChangeStatus === 'completed'
    && Array.isArray(message.fileChanges)
    && message.fileChanges.length > 0
}

function mergeFileChangeDiff(first: string, second: string): string {
  if (!first) return second
  if (!second || first === second) return first
  return `${first}\n${second}`.trim()
}

function mergeFileChangeEntry(first: UiFileChange, second: UiFileChange): UiFileChange {
  const operation = first.operation === 'add' || second.operation === 'add'
    ? 'add'
    : first.operation === 'delete' || second.operation === 'delete'
      ? 'delete'
      : 'update'
  return {
    path: second.path || first.path,
    operation,
    movedToPath: second.movedToPath ?? first.movedToPath ?? null,
    diff: mergeFileChangeDiff(first.diff, second.diff),
    addedLineCount: first.addedLineCount + second.addedLineCount,
    removedLineCount: first.removedLineCount + second.removedLineCount,
  }
}

function compareFileChanges(first: UiFileChange, second: UiFileChange): number {
  const firstRank = first.operation === 'add' ? 0 : first.operation === 'update' ? 1 : 2
  const secondRank = second.operation === 'add' ? 0 : second.operation === 'update' ? 1 : 2
  if (firstRank !== secondRank) return firstRank - secondRank
  const firstPath = `${first.path}\u0000${first.movedToPath ?? ''}`
  const secondPath = `${second.path}\u0000${second.movedToPath ?? ''}`
  return firstPath.localeCompare(secondPath)
}

function aggregateFileChanges(changes: UiFileChange[]): UiFileChange[] {
  const byPath = new Map<string, UiFileChange>()
  for (const change of changes) {
    const key = `${change.path}\u0000${change.movedToPath ?? ''}`
    const previous = byPath.get(key)
    byPath.set(key, previous ? mergeFileChangeEntry(previous, change) : { ...change })
  }
  return Array.from(byPath.values()).sort(compareFileChanges)
}

/** Build file-change summaries from one traversal of the conversation. */
export function indexConversationFileChanges(messages: readonly UiMessage[]) {
  const assistantAnchorIdByTurnKey = new Map<string, string>()
  const assistantSummaryByAnchorId = new Map<string, TurnFileChangeSummary>()
  const fileChangeMessagesByTurnKey = new Map<string, UiMessage[]>()

  for (const message of messages) {
    if (isCopyableAssistantMessage(message) && typeof message.turnIndex === 'number') {
      assistantAnchorIdByTurnKey.set(`turn:${message.turnIndex}`, message.id)
      if (Array.isArray(message.fileChanges) && message.fileChanges.length > 0) {
        assistantSummaryByAnchorId.set(message.id, {
          changes: aggregateFileChanges(message.fileChanges),
          sourceMessageIds: [],
          source: 'assistant',
          turnId: message.turnId ?? '',
        })
      }
    }

    if (!isFileChangeMessage(message)) continue
    const turnKey = typeof message.turnIndex === 'number' ? `turn:${message.turnIndex}` : `message:${message.id}`
    const current = fileChangeMessagesByTurnKey.get(turnKey)
    if (current) current.push(message)
    else fileChangeMessagesByTurnKey.set(turnKey, [message])
  }

  const anchored: Record<string, TurnFileChangeSummary> = {}
  const standalone: Record<string, TurnFileChangeSummary> = {}
  for (const [turnKey, messages] of fileChangeMessagesByTurnKey.entries()) {
    const anchorId = assistantAnchorIdByTurnKey.get(turnKey)
    if (!anchorId && assistantAnchorIdByTurnKey.has(turnKey)) continue
    const visibleMessage = messages[messages.length - 1]
    if (!visibleMessage) continue
    const firstTurnId = messages.find((message) => typeof message.turnId === 'string' && message.turnId.length > 0)?.turnId
    const summary: TurnFileChangeSummary = {
      changes: aggregateFileChanges(messages.flatMap((message) => message.fileChanges ?? [])),
      sourceMessageIds: messages.map((message) => message.id),
      source: 'metadata',
      // Standalone summaries prefer the last message even when its turn ID is empty.
      turnId: anchorId
        ? firstTurnId ?? assistantSummaryByAnchorId.get(anchorId)?.turnId ?? ''
        : visibleMessage.turnId ?? firstTurnId ?? '',
    }
    if (anchorId) anchored[anchorId] = summary
    else standalone[visibleMessage.id] = summary
  }
  for (const [anchorId, summary] of assistantSummaryByAnchorId.entries()) {
    if (!anchored[anchorId]) anchored[anchorId] = summary
  }
  const hiddenMessageIds = new Set<string>()
  for (const summary of Object.values(anchored)) {
    for (const id of summary.sourceMessageIds) hiddenMessageIds.add(id)
  }
  for (const [visibleId, summary] of Object.entries(standalone)) {
    for (const id of summary.sourceMessageIds) {
      if (id !== visibleId) hiddenMessageIds.add(id)
    }
  }
  return { anchored, standalone, hiddenMessageIds }
}
