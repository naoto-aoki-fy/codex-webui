import { randomUUID } from 'node:crypto'
import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'

type RecordValue = Record<string, any>
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {}
export type PortableMessage = { role: 'user' | 'assistant'; text: string; source: string }
export type PortableItem = { type: 'message'; role: 'user' | 'assistant'; content: { type: 'input_text' | 'output_text'; text: string }[] }
export function portableItems(messages: PortableMessage[]): PortableItem[] {
  return messages.map(({ role, text }) => ({ type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] }))
}

/** Construct fresh text-only items. No source item IDs, instructions or tool calls cross this boundary. */
export function convertTransferHistory(turns: unknown[], source: string): { messages: PortableMessage[]; warnings: string[] } {
  const messages: PortableMessage[] = []
  for (const value of turns) {
    const turn = record(value)
    if (!Array.isArray(turn.items)) throw new Error('Incomplete source items; cannot transfer safely.')
    for (const raw of turn.items) {
      const item = record(raw)
      if (item.type === 'userMessage' && Array.isArray(item.content)) {
        const text = item.content.flatMap((value: unknown) => {
          const content = record(value)
          return content.type === 'text' && typeof content.text === 'string' && content.text.length ? [content.text] : []
        }).join('\n')
        if (text.trim()) messages.push({ role: 'user', text, source })
      } else if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        messages.push({ role: 'assistant', text: item.text, source: typeof turn.generationMetadata?.model === 'string' ? `${source}; response model ${turn.generationMetadata.model}` : source })
      }
    }
  }
  // Retain the response shape for older clients; omissions never create notices.
  return { messages, warnings: [] }
}

type Transfer = { projectId?: string | null; sourceId: string; cwd: string; messages: PortableMessage[]; warnings: string[]; stage: string; destinationId?: string; model?: string; modelProvider?: string; failure?: string }
const KEY = 'conversation-transfers-v1'
async function transfers(): Promise<Record<string, Transfer>> { return (await readCodexGlobalState())[KEY] as Record<string, Transfer> || {} }
async function save(id: string, transfer: Transfer) {
  await updateCodexGlobalState(state => { const rows = state[KEY] as Record<string, Transfer> || {}; rows[id] = transfer; state[KEY] = rows })
}
type Rpc = (method: string, params: any) => Promise<any>
export function createConversationTransfers(rpc: Rpc) {
  const busy = new Set<string>()
  return {
    async prepare(sourceId: string, cutoff?: number, expectedTurnId?: string) {
      if (!sourceId) throw new Error('Missing source thread')
      // Direct server read is uncapped; never use the browser's ten-turn presentation page.
      const thread = record((await rpc('thread/read', { threadId: sourceId, includeTurns: true })).thread)
      const turns = thread.turns
      if (!Array.isArray(turns)) throw new Error('Complete source history unavailable. Upgrade the app-server.')
      if (thread.inProgress === true || thread.status === 'inProgress' || thread.turnStatus === 'inProgress' || ['active', 'inProgress'].includes(thread.status?.type) || turns.some(t => ['inProgress', 'in_progress'].includes(record(t).status))) throw new Error('Finish or stop the current source turn before transferring.')
      if (cutoff !== undefined && (!Number.isSafeInteger(cutoff) || cutoff >= turns.length)) throw new Error('The selected response is no longer available. Refresh the thread.')
      if (expectedTurnId && cutoff !== undefined && cutoff >= 0 && record(turns[cutoff]).id !== expectedTurnId) throw new Error('Source history changed at the selected response. Refresh the thread.')
      const selected = cutoff === undefined ? turns : cutoff < 0 ? [] : turns.slice(0, cutoff + 1)
      const converted = convertTransferHistory(selected, `${sourceId} (${thread.modelProvider || 'source provider'} / ${thread.model || 'source model'})`)
      const imported = Object.values(await transfers()).find(t => t.destinationId === sourceId)
      if (imported && imported.stage !== 'ready') throw new Error('The source is an incomplete transfer; inspect it before continuing.')
      if (cutoff !== undefined && cutoff < 0 && (!imported || -cutoff > imported.messages.length || imported.messages[-cutoff - 1]?.role !== 'assistant')) throw new Error('Imported response cutoff is no longer available.')
      const prefix = cutoff !== undefined && cutoff < 0 ? imported!.messages.slice(0, -cutoff) : imported?.messages || []
      const retainedPrefix = prefix.filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string' && message.text.trim())
        .map(({ role, text, source }) => ({ role, text, source }))
      const messages = [...retainedPrefix, ...converted.messages]
      const warnings: string[] = []
      // Explicit bounded request, never truncate. Destination context limits can be smaller.
      if (Buffer.byteLength(JSON.stringify(portableItems(messages))) > 8 * 1024 * 1024) throw new Error('History exceeds the 8 MiB transfer request limit. No thread was created.')
      if (!messages.length) throw new Error('There is no portable conversation history to import. No thread was created.')
      if (typeof thread.cwd !== 'string' || !thread.cwd.trim()) throw new Error('The source has no working directory. Select a source with an existing workspace before transferring.')
      const id = randomUUID()
      await save(id, { sourceId, cwd: thread.cwd, ...(thread.projectId ? { projectId: thread.projectId } : {}), messages, warnings, stage: 'prepared' })
      return { id, warnings, messageCount: messages.length }
    },
    async status(id: string) {
      const transfer = (await transfers())[id]
      if (!transfer) throw new Error('Transfer record not found')
      return { stage: transfer.stage, threadId: transfer.destinationId, model: transfer.model, modelProvider: transfer.modelProvider, warnings: [], failure: transfer.failure }
    },
    async cancel(id: string) {
      await updateCodexGlobalState(state => { const rows = state[KEY] as Record<string, Transfer> || {}; if (rows[id]?.stage === 'prepared') delete rows[id] })
    },
    async create(id: string, model: string, modelProvider: string) {
      if (busy.has(id)) throw new Error('Transfer is already pending; do not retry injection.')
      busy.add(id)
      let transfer: Transfer | undefined
      let claimed = false
      try {
        transfer = (await transfers())[id]
        if (!transfer || transfer.stage !== 'prepared') throw new Error(`Transfer already consumed (${transfer?.destinationId || id}); do not retry injection.`)
        if (!model || !modelProvider) throw new Error('Select a configured provider and model.')
        await updateCodexGlobalState(state => {
          const rows = state[KEY] as Record<string, Transfer> || {}
          if (rows[id]?.stage !== 'prepared') throw new Error('Transfer already consumed; do not retry injection.')
          transfer = rows[id]!
          transfer.stage = 'starting'
        })
        claimed = true
        const started = await rpc('thread/start', { cwd: transfer.cwd, ...(transfer.projectId ? { projectId: transfer.projectId } : {}), model, modelProvider, persistExtendedHistory: true })
        transfer.destinationId = started.thread?.id
        transfer.model = started.model
        transfer.modelProvider = started.modelProvider
        if (!transfer.destinationId || started.model !== model || started.modelProvider !== modelProvider) throw new Error('thread/start did not confirm the selected provider/model.')
        transfer.stage = 'injecting'
        await save(id, transfer) // durable fence before append: never replay after lost acknowledgement
        await rpc('thread/inject_items', { threadId: transfer.destinationId, items: portableItems(transfer.messages) })
        transfer.stage = 'ready'
        await save(id, transfer)
        return { threadId: transfer.destinationId, ...(transfer.projectId ? { projectId: transfer.projectId } : {}), model, modelProvider, warnings: [] }
      } catch (error) {
        if (transfer && claimed) {
          transfer.failure = String(error)
          await save(id, transfer)
          throw new Error(`Incomplete destination ${transfer.destinationId || '(thread/start outcome unknown)'}; stage ${transfer.stage}: ${String(error)}. Do not retry injection. If thread/inject_items is unsupported, upgrade the connected app-server. Source and draft are unchanged.`)
        }
        throw error
      } finally { busy.delete(id) }
    },
    async assertReady(threadId: string) {
      const transfer = Object.values(await transfers()).find(t => t.destinationId === threadId)
      if (transfer && transfer.stage !== 'ready') throw new Error(`Incomplete imported conversation ${threadId} (${transfer.stage}). Inspect it; automatic replay is disabled.`)
    },
    async decorate(result: any) {
      const id = result?.thread?.id
      if (!id) return result
      const transfer = Object.values(await transfers()).find(t => t.destinationId === id)
      return transfer ? { ...result, importedTranscript: transfer.messages, importStage: transfer.stage, importFailure: transfer.failure } : result
    },
  }
}
