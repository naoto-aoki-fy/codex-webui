import { afterEach, expect, it, vi } from 'vitest'
import { configureFreshFork, startThreadTurn } from './codexGateway'
import { modelSelectionKey } from './modelCapabilities'

afterEach(() => vi.unstubAllGlobals())

it('uses supported fork overrides on the draft prefix and requires backend confirmation', async () => {
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(JSON.stringify({ result: {
    thread: { id: 'configured', modelProvider: 'Q', turns: [{ id: 'inherited' }] },
    model: 'C', modelProvider: 'Q',
  } })))
  vi.stubGlobal('fetch', fetch)
  await expect(configureFreshFork('prefix-draft', modelSelectionKey('Q', 'C'))).resolves.toEqual({
    threadId: 'configured', model: 'C', modelProvider: 'Q',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    method: 'thread/fork', params: { threadId: 'prefix-draft', model: 'C', modelProvider: 'Q', persistExtendedHistory: true },
  })
})

it.each([
  { thread: { id: 'fork' }, model: 'C' },
  { thread: { id: 'fork' }, model: 'C', modelProvider: 'P' },
  { thread: { id: 'fork' }, model: 'A', modelProvider: 'Q' },
  { thread: { id: 'draft' }, model: 'C', modelProvider: 'Q' },
])('fails closed for an unconfirmed configuration: %j', async result => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result }))))
  await expect(configureFreshFork('draft', modelSelectionKey('Q', 'C'))).rejects.toThrow('did not confirm')
})


it('explains the backend provider limitation instead of accepting a mismatched turn', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: {
    code: -32600, data: { type: 'modelProviderMismatch', modelProvider: 'Q', currentModelProvider: 'P' },
    message: 'This chat uses Q, but your current provider is P. Switch to Q to continue.',
  } }), { status: 400 })))
  await expect(startThreadTurn('fork', 'hello', [], modelSelectionKey('Q', 'C')))
    .rejects.toThrow('No message was accepted')
})
