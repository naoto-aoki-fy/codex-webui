import { ref } from 'vue'
import { getOlderThreadMessages, getThreadDetail } from '../api/codexGateway'
import type { UiMessage } from '../types/codex'
import { generationMetadataLabel, readGenerationMetadata } from '../turnGenerationMetadata'

const MAX_PAGES = 1000
const MAX_TEXT_CHARS = 32 * 1024 * 1024
function fence(text: string, language = 'text'): string {
  let length = 3
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
  const marker = '`'.repeat(length)
  return `${marker}${language}\n${text}\n${marker}`
}
export function safeExportFilename(title: string): string {
  const stem = title.replace(/[^\p{L}\p{N}_ -]/gu, '_').trim().slice(0, 100) || 'conversation'
  return `conversation-${stem}.md`
}
export function conversationMarkdown(title: string, id: string, messages: UiMessage[], excludedActiveTurn: boolean): string {
  const lines = [`# ${title.replace(/[\r\n]/g, ' ')}`, '', `Thread ID: ${id}`, '',
    'Snapshot of available completed conversation content. Raw internal payloads and hidden instructions are excluded.', '',
    ...(excludedActiveTurn ? ['The turn active when export started is excluded, including its user input.', ''] : [])]
  for (const message of messages) {
    if (message.isUnhandled || message.messageType?.endsWith('.live')) continue
    lines.push(`## ${message.role.toUpperCase()}`, '')
    if (message.importMetadata) lines.push('Imported history (source execution metadata unavailable).', '')
    if (message.submittedAt) lines.push(`Sent: ${message.submittedAt}`, '')
    if (message.completedAt) lines.push(`Answered: ${message.completedAt}`, '')
    const metadata = readGenerationMetadata(message.generationMetadata)
    if (metadata) lines.push(generationMetadataLabel(metadata), '')
    if (message.text) lines.push(message.text, '')
    if (message.commandExecution) {
      const command = message.commandExecution
      const details = [`command: ${command.command}`, `status: ${command.status}`]
      if (command.cwd) details.push(`cwd: ${command.cwd}`)
      if (command.exitCode !== null) details.push(`exitCode: ${command.exitCode}`)
      lines.push(fence([...details, command.aggregatedOutput].join('\n')), '')
    }
    if (message.plan) lines.push(...message.plan.steps.map(step => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.step}`), '')
    for (const change of message.fileChanges || []) lines.push(`File: ${change.path} (${change.operation})${change.movedToPath ? ` → ${change.movedToPath}` : ''}`, '', fence(change.diff, 'diff'), '')
    for (const attachment of message.fileAttachments || []) lines.push(`Attachment: ${attachment.label} — ${attachment.path}`, '')
    for (const image of message.images || []) lines.push(`Image: ${image}`, '')
    for (const skill of message.skills || []) lines.push(`Skill: ${skill.name} — ${skill.path}`, '')
  }
  return lines.join('\n').trimEnd() + '\n'
}
export function downloadMarkdown(filename: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Reads the same normalized, imported-history-decorated pages as the conversation UI. */
export function createConversationExport(deps: {
  epoch: () => number
  detail?: typeof getThreadDetail
  older?: typeof getOlderThreadMessages
  download?: typeof downloadMarkdown
}) {
  const busy = ref(false)
  const status = ref('')
  async function run(threadId: string, title: string) {
    if (busy.value) return
    busy.value = true
    status.value = 'Exporting completed conversation history…'
    const epoch = deps.epoch()
    const check = () => { if (epoch !== deps.epoch()) throw new Error('Connection changed. Export canceled; no file was saved.') }
    try {
      const snapshot = await (deps.detail || getThreadDetail)(threadId)
      check()
      if (snapshot.inProgress && !snapshot.activeTurnId) throw new Error('Cannot identify the active turn safely. Finish generation before exporting.')
      const excludedTurn = snapshot.inProgress ? snapshot.activeTurnId : ''
      const batches: UiMessage[][] = [snapshot.messages]
      let characters = 0
      const account = (messages: UiMessage[]) => {
        characters += JSON.stringify(messages).length
        if (characters > MAX_TEXT_CHARS) throw new Error('Conversation exceeds the export text safety limit. No file was saved.')
      }
      account(snapshot.messages)
      let more = snapshot.hasMoreOlder
      let indices = snapshot.turnIndexByTurnId
      const visited = new Set<string>()
      let pages = 0
      while (more) {
        check()
        const boundary = Object.entries(indices).sort((a, b) => a[1] - b[1])[0]?.[0]
        if (!boundary || visited.has(boundary) || ++pages > MAX_PAGES) throw new Error('History pagination did not complete safely. No file was saved.')
        visited.add(boundary)
        const page = await (deps.older || getOlderThreadMessages)(threadId, boundary, 10)
        check()
        account(page.messages)
        batches.unshift(page.messages)
        more = page.hasMoreOlder
        indices = page.turnIndexByTurnId
      }
      // Imported prefixes are repeated on each normal page. Keep them once, before native turns.
      const imported = new Map<string, UiMessage>()
      const native = new Map<string, UiMessage>()
      for (const batch of batches) for (const message of batch) {
        if (excludedTurn && message.turnId === excludedTurn) continue
        ;(message.importMetadata ? imported : native).set(message.id, message)
      }
      check()
      const markdown = conversationMarkdown(title, threadId, [...imported.values(), ...native.values()], !!excludedTurn)
      if (markdown.length > MAX_TEXT_CHARS) throw new Error('Export exceeds the safe size limit. No file was saved.')
      ;(deps.download || downloadMarkdown)(safeExportFilename(title), markdown)
      status.value = excludedTurn ? 'Exported completed history. The active turn was excluded.' : 'Exported complete available conversation history.'
    } catch (cause) { status.value = `Export failed: ${cause instanceof Error ? cause.message : 'Cannot load complete history'}` }
    finally { busy.value = false }
  }
  return { busy, status, run }
}
