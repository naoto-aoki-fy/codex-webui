import { afterEach, expect, it, vi } from 'vitest'
import { createConversationTransfer } from './codexGateway'
const key = 'provider-model:["Q","C"]'
afterEach(() => vi.unstubAllGlobals())
it('recovers a lost create acknowledgement using only a durable receipt', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const method = JSON.parse(init.body).method
    calls.push(method)
    if (method === 'conversation-transfer/create') throw new Error('lost acknowledgement')
    return new Response(JSON.stringify({ result: { stage: 'ready', threadId: 'destination', model: 'C', modelProvider: 'Q', warnings: [], draftText: 'Restored prompt' } }))
  }))
  await expect(createConversationTransfer('snapshot', key)).resolves.toMatchObject({ threadId: 'destination', draftText: 'Restored prompt' })
  expect(calls).toEqual(['conversation-transfer/create', 'conversation-transfer/status'])
})
it('identifies the incomplete destination without retrying the append', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const method = JSON.parse(init.body).method
    calls.push(method)
    if (method === 'conversation-transfer/create') throw new Error('timeout')
    return new Response(JSON.stringify({ result: { stage: 'injecting', threadId: 'incomplete' } }))
  }))
  await expect(createConversationTransfer('snapshot', key)).rejects.toThrow('destination incomplete, stage injecting')
  expect(calls).toEqual(['conversation-transfer/create', 'conversation-transfer/status'])
})
