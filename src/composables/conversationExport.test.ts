import { describe, it, expect, vi } from 'vitest'
import { createConversationExport, conversationMarkdown, safeExportFilename } from './conversationExport'
import type { UiMessage } from '../types/codex'
const msg = (id: string, text = id, extra: Partial<UiMessage> = {}): UiMessage => ({ id, text, role: 'assistant', turnId: id, ...extra })
const detail = (messages: UiMessage[], more = false) => ({ messages, hasMoreOlder: more, turnIndexByTurnId: { latest: 10 }, activeTurnId: '', inProgress: false, model: 'current-never-export', modelProvider: '' })
describe('complete Markdown export (CAP-002/003)', () => {
  it('loads older pages, includes imported history once and preserves historical metadata and code', async () => {
    const imported = msg('imported', 'Original portable prompt', { turnId: undefined, importMetadata: { source: 'old' } })
    const latest = msg('latest', '```ts\nlet a = 1\n```', { completedAt: '2026-01-01T00:00:00Z', generationMetadata: { model: 'historical', modelSource: 'execution', effort: 'none', effortSource: 'execution' }, fileAttachments: [{ label: 'file', path: '/remote/file' }] })
    const read = vi.fn().mockResolvedValue(detail([imported, latest], true))
    const older = vi.fn().mockResolvedValue({ ...detail([imported, msg('older', '**first**', { role: 'user' })]), startTurnIndex: 0, turnIndexByTurnId: { older: 0 } })
    const download = vi.fn()
    const job = createConversationExport({ epoch: () => 0, detail: read, older, download })
    expect(read).not.toHaveBeenCalled()
    await job.run('id', '../../unsafe')
    const markdown = download.mock.calls[0]![1]
    expect(markdown.match(/Original portable prompt/g)).toHaveLength(1)
    expect(markdown.indexOf('**first**')).toBeLessThan(markdown.indexOf('```ts'))
    expect(markdown).toContain('historical · reasoning: none')
    expect(markdown).toContain('2026-01-01T00:00:00Z')
    expect(markdown).toContain('/remote/file')
    expect(markdown).not.toContain('current-never-export')
    expect(older).toHaveBeenCalledWith('id', 'latest', 10)
    expect(safeExportFilename('../../unsafe')).not.toMatch(/[/.].*\//)
    expect(safeExportFilename('CON')).toBe('conversation-CON.md')
  })
  it('prevents duplicate jobs and excludes the initially active turn even if it completes later', async () => {
    let resolve!: (v: ReturnType<typeof detail>) => void
    const read = vi.fn(() => new Promise<ReturnType<typeof detail>>(r => { resolve = r }))
    const download = vi.fn()
    const job = createConversationExport({ epoch: () => 0, detail: read, download })
    const first = job.run('id', 'title'); await job.run('id', 'title')
    resolve({ ...detail([msg('done'), msg('active', 'partial')]), inProgress: true, activeTurnId: 'active' })
    await first
    expect(read).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0]![1]).toContain('done')
    expect(download.mock.calls[0]![1]).not.toContain('partial')
    expect(job.status.value).toContain('active turn was excluded')
  })
  it.each(['page failure', 'connection change', 'cursor loop'])('saves nothing on %s', async failure => {
    let epoch = 0
    const download = vi.fn()
    const older = vi.fn(async () => {
      if (failure === 'page failure') throw new Error('page denied')
      if (failure === 'connection change') epoch++
      return { ...detail([msg('latest')], true), startTurnIndex: 10 }
    })
    const job = createConversationExport({ epoch: () => epoch, detail: vi.fn().mockResolvedValue(detail([msg('latest')], true)), older, download })
    await job.run('id', 'title')
    expect(download).not.toHaveBeenCalled()
    expect(job.status.value).toContain('Export failed')
  })
  it('preserves visible command details and fences embedded code markers safely', () => {
    const text = conversationMarkdown('title', 'id', [msg('cmd', '', { commandExecution: { command: 'test', cwd: '/remote', status: 'completed', exitCode: 2, aggregatedOutput: '```output```' } })], false)
    expect(text).toContain('cwd: /remote')
    expect(text).toContain('exitCode: 2')
    expect(text).toContain('````text\n')
    expect(text).toContain('```output```')
  })
  it('exports large valid command output with many backtick runs', () => {
    const output = '`x'.repeat(150_000)
    const text = conversationMarkdown('title', 'id', [msg('large-command', '', { commandExecution: { command: 'cat transcript', cwd: '/fixture', status: 'completed', exitCode: 0, aggregatedOutput: output } })], false)
    expect(text).toContain(output)
    expect(text).toContain('```text\n')
  })
  it('omits internal payloads and never invents missing metadata', () => {
    const text = conversationMarkdown('title', 'id', [msg('ok', 'visible'), msg('raw', 'secret', { isUnhandled: true, rawPayload: 'secret' })], false)
    expect(text).toContain('visible'); expect(text).not.toContain('secret'); expect(text).not.toContain('Answered:')
  })
})
