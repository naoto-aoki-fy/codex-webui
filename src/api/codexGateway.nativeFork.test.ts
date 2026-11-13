import { afterEach, expect, it, vi } from 'vitest'
import { forkThread, forkThreadFromResponse } from './codexGateway'

const result = {
  thread: { id: 'native', cwd: '/workspace', turns: [{ id: 'turn-0', status: 'completed', items: [
    { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'question' }] },
    { type: 'agentMessage', id: 'answer', text: 'answer' },
  ] }] },
  model: 'source-model', modelProvider: 'source-provider',
  forkCutoff: { sourceThreadId: 'source', turnIndex: 0, turnId: 'turn-0', turnCount: 1 },
}
afterEach(() => vi.unstubAllGlobals())
it.each(['full', 'response'])('uses only the native %s API without provider overrides or import decoration', async entry => {
  const fetch = vi.fn(async (_url: string, _init?: { body?: unknown }) => new Response(JSON.stringify({ result })))
  vi.stubGlobal('fetch', fetch)
  const forked = entry === 'full'
    ? await forkThread('source')
    : await forkThreadFromResponse('source', 0, 'turn-0')
  expect(forked).toMatchObject({ threadId: 'native', model: 'source-model', modelProvider: 'source-provider' })
  expect(forked.messages.map(message => message.text)).toEqual(['question', 'answer'])
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    method: entry === 'full' ? 'thread/fork' : 'thread/fork-at-response',
    params: { threadId: 'source', persistExtendedHistory: true, ...(entry === 'response' ? { forkFromTurnIndex: 0, expectedTurnId: 'turn-0' } : {}) },
  })
})
it('reports an unsupported native fork without falling back to thread/start or injection', async () => {
  const fetch = vi.fn(async (_url: string, _init?: { body?: unknown }) => new Response(JSON.stringify({ error: 'Method not found: thread/fork' }), { status: 400 }))
  vi.stubGlobal('fetch', fetch)
  await expect(forkThread('source')).rejects.toThrow('Method not found')
  expect(fetch).toHaveBeenCalledTimes(1)
})
