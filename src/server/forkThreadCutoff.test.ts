import { describe, expect, it, vi } from 'vitest'
import { forkThreadAtCutoff } from './codexAppServerBridge'

const turns = Array.from({ length: 5 }, (_, i) => ({ id: `turn-${i}` }))

describe('response fork cutoff', () => {
  it('uses the native inclusive turn id without unsupported rollback', async () => {
    const rpc = vi.fn(async (method: string, params: unknown) => {
      const p = params as Record<string, unknown>
      if (method === 'thread/fork') {
        expect(p).toEqual({ threadId: 'source', lastTurnId: 'turn-1' })
      } else expect(method).toBe('thread/read')
      return { thread: { id: p.threadId === 'source' && method === 'thread/read' ? 'source' : 'fork', turns: method === 'thread/read' && p.threadId === 'source' ? turns : turns.slice(0, 2) } }
    })
    expect(await forkThreadAtCutoff({ rpc }, { threadId: 'source', turnId: 'turn-1' })).toMatchObject({
      forkCutoff: { sourceThreadId: 'source', turnId: 'turn-1' },
      thread: { id: 'fork', turns: turns.slice(0, 2) },
    })
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/fork', 'thread/read'])
  })

  it('verifies the response identity captured before the picker opened', async () => {
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === 'thread/fork') {
        expect(params).toEqual({ threadId: 'source', persistExtendedHistory: true, lastTurnId: 'turn-1' })
        return { thread: { id: 'fork', turns: turns.slice(0, 2) } }
      }
      return { thread: { id: params.threadId, turns: params.threadId === 'source' ? turns : turns.slice(0, 2) } }
    })
    await forkThreadAtCutoff({ rpc }, { threadId: 'source', turnId: 'turn-1', persistExtendedHistory: true })
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/fork', 'thread/read'])
    rpc.mockClear()
    await expect(forkThreadAtCutoff({ rpc }, { threadId: 'source', turnId: 'stale' })).rejects.toThrow('Source history changed')
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read'])
  })

  it.each(['ignored-cutoff', 'reappears-on-read', 'wrong-ids'])('archives the fork after %s', async failure => {
    const rpc = vi.fn(async (method: string, params: unknown) => {
      const p = params as Record<string, unknown>
      if (method === 'thread/archive') return {}
      if (method === 'thread/read' && p.threadId === 'source') return { thread: { id: 'source', turns } }
      const history = failure === 'ignored-cutoff' || (failure === 'reappears-on-read' && method === 'thread/read')
        ? turns : failure === 'wrong-ids' ? turns.slice(2, 4) : turns.slice(0, 2)
      return { thread: { id: 'fork', turns: history } }
    })
    await expect(forkThreadAtCutoff({ rpc }, { threadId: 'source', turnId: 'turn-1' })).rejects.toThrow('cutoff was not applied')
    expect(rpc).toHaveBeenLastCalledWith('thread/archive', { threadId: 'fork' })
  })

  it.each([1, '', undefined])('rejects invalid cutoff %s before RPC', async cutoff => {
    const rpc = vi.fn()
    await expect(forkThreadAtCutoff({ rpc }, { threadId: 'source', turnId: cutoff })).rejects.toThrow('Missing response turn ID')
    expect(rpc).not.toHaveBeenCalled()
  })
})
