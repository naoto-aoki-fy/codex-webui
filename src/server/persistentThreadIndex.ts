import { randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type Row = Record<string, any>
type Rpc = (method: string, params: Row) => Promise<any>
// Legacy list metadata is tolerated on disk but never generated or updated.
type Entry = { firstTurnId?: string; pending?: { token: string; text: string; previous: string[] } }
const object = (v: any): Row => v && typeof v === 'object' ? v : {}

// Recognize only the exact transport envelope produced by attachmentPrompt.
function isAttachmentOnly(text: string): boolean {
  return /^# Files mentioned by the user:\n((?:\n## [^\n]*: [^\n]+\n)+)\n## My request for Codex:\n\n\s*$/u.test(text)
}
function inputText(params: Row): string {
  return (params.input ?? []).filter((v: Row) => v.type === 'text').map((v: Row) => v.text).join('\n')
}
function turns(thread: Row): Row[] { return Array.isArray(thread.turns) ? thread.turns : [] }
function hasText(turn: Row, text: string): boolean {
  return (turn.items ?? []).some((item: Row) => item.type === 'userMessage'
    && (item.content ?? []).some((block: Row) => block.type === 'text' && block.text === text))
}

export class PersistentThreadIndex {
  private readonly started = new Map<string, Row>()
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly home: () => string) {}
  private path() { return join(this.home(), 'codexapp-thread-index.json') }
  private async load(): Promise<Record<string, Entry>> {
    await this.queue
    try { return JSON.parse(await readFile(this.path(), 'utf8')) }
    catch (error: any) { if (error.code === 'ENOENT') return {}; throw error }
  }
  private async update(fn: (entries: Record<string, Entry>) => void): Promise<void> {
    const previous = this.queue
    const write = previous.catch(() => {}).then(async () => {
      await mkdir(this.home(), { recursive: true })
      const release = await lockfile.lock(this.path(), { realpath: false, retries: { retries: 5, minTimeout: 10, maxTimeout: 100 } })
      let temp: string | undefined
      try {
        let entries: Record<string, Entry> = {}
        try { entries = JSON.parse(await readFile(this.path(), 'utf8')) }
        catch (error: any) { if (error.code !== 'ENOENT') throw error }
        const before = JSON.stringify(entries)
        fn(entries)
        if (JSON.stringify(entries) === before) return
        temp = `${this.path()}.${randomUUID()}.tmp`
        await writeFile(temp, JSON.stringify(entries), { mode: 0o600 })
        await rename(temp, this.path())
      } finally {
        if (temp) await rm(temp, { force: true }).catch(() => {})
        await release()
      }
    })
    this.queue = write.catch(() => {})
    await write
  }
  private async bestEffort(fn: () => Promise<void>) {
    try { await fn() } catch (error) { console.warn('Failed to update application thread index; will reconcile without resending', error) }
  }
  private confirm(id: string, token: string, turnId: string) {
    return this.update((entries) => {
      const entry = entries[id]
      if (!entry || entry.pending?.token !== token) return
      entry.firstTurnId ||= turnId
      delete entry.pending
    })
  }
  async call(method: string, params: Row, rpc: Rpc): Promise<any> {
    const id = params.threadId
    let token: string | undefined
    const attachmentOnly = method === 'turn/start' && isAttachmentOnly(inputText(params))
    if (id && attachmentOnly && !(await this.load())[id]?.firstTurnId) {
      // A durable intent is required before submission. Capture existing turn IDs
      // so repeated identical file submissions cannot confirm an earlier turn.
      const thread = this.started.get(id) ?? object((await rpc('thread/read', { threadId: id, includeTurns: true })).thread)
      token = randomUUID()
      await this.update((entries) => {
        const entry = entries[id] ?? {}
        if (entry.pending) throw new Error('An attachment submission is awaiting reconciliation; reopen the thread before sending again.')
        entry.pending = { token: token!, text: inputText(params), previous: turns(thread).map((turn) => turn.id) }
        entries[id] = entry
      })
    }
    // Never catch an ambiguous submission error and replay it. Its intent survives.
    let result: any
    try { result = await rpc(method, params) }
    catch (error: any) {
      // A protocol rejection is definitive; transport failures remain ambiguous.
      if (token && typeof error?.code === 'number') await this.bestEffort(() => this.update((entries) => {
        if (entries[id]?.pending?.token === token) delete entries[id]!.pending
      }))
      throw error
    }
    if (method === 'thread/start' && result?.thread?.id) {
      this.started.set(result.thread.id, result.thread)
      if (this.started.size > 64) this.started.delete(this.started.keys().next().value!)
    }
    if (token) this.started.delete(id)
    if (token && result?.turn?.id) await this.bestEffort(() => this.confirm(id, token!, result.turn.id))
    // Reconcile only from returned native history, never from cached list metadata.
    const thread = object(result?.thread)
    if (id && thread.id) await this.bestEffort(async () => {
      if (!(await this.load())[id]?.pending) return
      await this.update((entries) => {
        const entry = entries[id]
        if (!entry?.pending) return
        const accepted = turns(thread).find((turn) => !entry.pending!.previous.includes(turn.id) && hasText(turn, entry.pending!.text))
        if (accepted) { entry.firstTurnId ||= accepted.id; delete entry.pending }
      })
    })
    return result
  }
}
