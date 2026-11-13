import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadReadResponse } from '../appServerDtos'
import { getOlderThreadMessages, getThreadDetail, startThread } from '../codexGateway'
import {
  buildTurnIndexByTurnId,
  normalizeThreadCwdFromPayload,
  normalizeThreadIdFromPayload,
  normalizeThreadModelFromPayload,
  normalizeThreadModelProviderFromPayload,
  readThreadTurnStartIndex,
  readThreadTurnOutcomes,
} from './threadMetadata'
import { normalizeThreadMessagesV2, readActiveTurnIdFromResponse } from './v2'

// Deliberately accept malformed wire values to characterize existing fallbacks.
const response = (value: unknown) => value as ThreadReadResponse

describe('thread response metadata', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves raw identifiers/cwd but trims the top-level model', () => {
    const payload = Object.freeze({
      thread: Object.freeze({ id: ' id ', cwd: ' /project ', model: 'nested' }),
      model: ' model ',
    })
    expect(normalizeThreadIdFromPayload(payload)).toBe(' id ')
    expect(normalizeThreadCwdFromPayload(payload)).toBe(' /project ')
    expect(normalizeThreadModelFromPayload(payload)).toBe('model')
    expect(normalizeThreadModelFromPayload({ thread: { model: 'nested' } })).toBe('')
    expect(normalizeThreadIdFromPayload({ thread: { id: '  ' } })).toBe('  ')
  })

  it.each([null, undefined, false, 1, '', [], {}, { thread: null },
    { thread: { id: '', cwd: '', model: '' } },
    { thread: { id: 1, cwd: 1 }, model: 1 },
  ])('keeps missing or malformed string fallbacks for %j', (payload) => {
    expect(normalizeThreadIdFromPayload(payload)).toBe('')
    expect(normalizeThreadCwdFromPayload(payload)).toBe('')
    expect(normalizeThreadModelFromPayload(payload)).toBe('')
    expect(normalizeThreadModelProviderFromPayload(payload)).toBe('')
  })

  it('prefers nonblank top-level provider, then nested provider, with legacy snake-case fallback; ignores source', () => {
    expect(normalizeThreadModelProviderFromPayload({
      modelProvider: ' top ', thread: { modelProvider: ' nested ' }, source: 'source',
    })).toBe('top')
    for (const modelProvider of [undefined, null, '', '  ', 42]) {
      expect(normalizeThreadModelProviderFromPayload({
        modelProvider, thread: { modelProvider: ' nested ' },
      })).toBe('nested')
    }
    expect(normalizeThreadModelProviderFromPayload({ source: 'source', model_provider: ' alias ' })).toBe('alias')
    expect(normalizeThreadModelProviderFromPayload({ thread: { model_provider: ' legacy ' } })).toBe('legacy')
    expect(normalizeThreadModelProviderFromPayload({ model_provider: 'alias', thread: { modelProvider: 'canonical' } })).toBe('canonical')
    expect(normalizeThreadModelProviderFromPayload({ source: 'source' })).toBe('')
    expect(normalizeThreadModelProviderFromPayload({ thread: { modelProvider: '  ' } })).toBe('')
  })

  it('uses raw turn IDs, last duplicate wins, and offsets include missing IDs', () => {
    const turns = Object.freeze([
      Object.freeze({ id: 'same' }), Object.freeze({ id: '' }),
      Object.freeze({}), Object.freeze({ id: 'same' }),
      Object.freeze({ id: ' spaced ' }), Object.freeze({ id: ' ' }),
      Object.freeze({ id: 7 }), null,
    ])
    const thread = Object.freeze({ turns })
    const payload = Object.freeze({ thread })
    const result = buildTurnIndexByTurnId(response(payload), 10)
    expect(result).toEqual({ same: 13, ' spaced ': 14, ' ': 15 })
    expect(buildTurnIndexByTurnId(response(payload))).toEqual({ same: 3, ' spaced ': 4, ' ': 5 })
    expect(buildTurnIndexByTurnId(response(payload), 10)).not.toBe(result)
    expect(payload.thread).toBe(thread)
    expect(payload.thread.turns).toBe(turns)
    expect(result.missing).toBeUndefined()
  })

  it.each([undefined, null, [], 'bad'])('returns a fresh empty lookup for turns=%j', (turns) => {
    const payload = response({ thread: { turns } })
    expect(buildTurnIndexByTurnId(payload)).toEqual({})
    expect(buildTurnIndexByTurnId(payload)).not.toBe(buildTurnIndexByTurnId(payload))
  })

  it.each([
    [undefined, 0], [null, 0], ['12', 0], [-3.5, 0], [3.9, 3],
    [NaN, NaN], [Infinity, Infinity], [-Infinity, 0],
  ])('preserves numeric start-index behavior for %s', (raw, expected) => {
    expect(readThreadTurnStartIndex(response({ threadTurnStartIndex: raw }))).toBe(expected)
  })

  it('keeps null/undefined start-index fallbacks and required-thread lookup errors', () => {
    for (const payload of [null, undefined]) {
      expect(readThreadTurnStartIndex(response(payload))).toBe(0)
      expect(() => buildTurnIndexByTurnId(response(payload))).toThrow(TypeError)
    }
    expect(() => buildTurnIndexByTurnId(response({}))).toThrow(TypeError)
    expect(buildTurnIndexByTurnId(response({ thread: { turns: [{ id: 'x' }] } }), NaN).x).toBeNaN()
  })

  it('retains v2 trimmed active IDs and message indices alongside raw lookup keys', () => {
    const payload = response({ thread: { turns: [
      { id: ' older ', status: 'inProgress', items: [] },
      { id: ' active ', status: 'inProgress', items: [{ id: 'msg', type: 'agentMessage', text: 'hello' }] },
      { id: ' ', status: 'inProgress', items: [] },
    ] } })
    expect(readActiveTurnIdFromResponse(payload)).toBe('active')
    expect(normalizeThreadMessagesV2(payload, 20)).toMatchObject([{ turnId: 'active', turnIndex: 21 }])
    expect(buildTurnIndexByTurnId(payload, 20)).toEqual({ ' older ': 20, ' active ': 21, ' ': 22 })
    expect(readActiveTurnIdFromResponse(response({ thread: { turns: [] } }))).toBe('')
  })

  it('preserves detail and pagination transformations through the gateway', async () => {
    const result = {
      model: ' model ', modelProvider: ' ', threadTurnStartIndex: 8.9,
      thread: { id: 'thread', modelProvider: ' nested ', turns: [
        { id: ' active ', status: 'inProgress', items: [{ id: 'msg', type: 'agentMessage', text: 'hello' }] },
      ] },
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      result, startTurnIndex: 12.9, hasMoreOlder: true,
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(getThreadDetail('thread')).resolves.toMatchObject({
      model: 'model', modelProvider: 'nested', activeTurnId: 'active', inProgress: true,
      hasMoreOlder: true, turnIndexByTurnId: { ' active ': 8 },
      messages: [{ turnId: 'active', turnIndex: 8 }],
    })
    await expect(getOlderThreadMessages('thread', 'before', 5)).resolves.toMatchObject({
      startTurnIndex: 12, activeTurnId: 'active', inProgress: true, hasMoreOlder: true,
      turnIndexByTurnId: { ' active ': 12 }, messages: [{ turnIndex: 12 }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[0]).toBe('/codex-api/thread-turn-page?threadId=thread&beforeTurnId=before&limit=5')
  })

  it('preserves start-thread return metadata through the gateway', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: { thread: { id: ' id ', modelProvider: ' nested ' }, model: ' model ' },
    }), { headers: { 'Content-Type': 'application/json' } })))
    await expect(startThread()).resolves.toEqual({ threadId: ' id ', model: 'model', modelProvider: 'nested' })
  })
})


it('preserves durable turn statuses even when a failed turn has no display items', () => {
  const payload = { thread: { turns: [
    { id: 'done', status: 'completed', items: [] },
    { id: 'fail', status: 'failed', items: [], error: { message: 'schema rejected' } },
    { id: 'active', status: 'inProgress' },
    { id: 'unknown', items: [] },
  ] } }
  expect(readThreadTurnOutcomes(payload)).toEqual({
    done: { status: 'completed' }, fail: { status: 'failed', error: 'schema rejected' }, active: { status: 'inProgress' },
  })
  expect(readThreadTurnOutcomes({ thread: { status: 'idle' } })).toEqual({})
})

it('exposes durable outcomes through the real thread/read gateway', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { thread: {
    id: 't', turns: [{ id: 'failed', status: 'failed', items: [], error: { message: 'schema rejected' } }],
  } } }))))
  try {
    const detail = await getThreadDetail('t')
    expect(detail.turnOutcomes).toEqual({ failed: { status: 'failed', error: 'schema rejected' } })
    expect(detail.messages.filter(message => message.role === 'assistant')).toEqual([])
  } finally { vi.unstubAllGlobals() }
})
