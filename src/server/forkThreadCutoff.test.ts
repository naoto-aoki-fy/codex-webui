import { describe, expect, it, vi } from 'vitest'
import { forkThreadAtCutoff } from './codexAppServerBridge'

const history = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `turn-${i}`, items: [{ type: 'userMessage', text: `user-${i}` }, { type: 'agentMessage', text: `answer-${i}` }],
}))

describe('response fork cutoff', () => {
  it.each([0, 2, 14])('persists an inclusive cutoff at turn %i through reload and continuation', async cutoff => {
    const source = history(15)
    let fork = structuredClone(source)
    const rpc = vi.fn(async (method: string, params: unknown) => {
      const p = params as Record<string, unknown>
      if (method === 'thread/fork') {
        expect(p).not.toHaveProperty('forkFromTurnIndex')
        return { model: 'test-model', thread: { id: 'fork', turns: structuredClone(fork) } }
      }
      expect(p.threadId).toBe('fork')
      if (method === 'thread/rollback') fork = fork.slice(0, fork.length - Number(p.numTurns))
      if (method === 'turn/start') {
        expect(fork).toEqual(source.slice(0, cutoff + 1))
        fork.push(...history(1))
      }
      return { thread: { id: 'fork', turns: structuredClone(fork) } }
    })
    const result = await forkThreadAtCutoff({ rpc }, { threadId: 'source', forkFromTurnIndex: cutoff })
    expect(result).toMatchObject({ model: 'test-model', thread: { turns: source.slice(0, cutoff + 1) } })
    for (const method of ['thread/read', 'thread/resume']) {
      expect(await rpc(method, { threadId: 'fork' })).toEqual({ thread: { id: 'fork', turns: source.slice(0, cutoff + 1) } })
    }
    await rpc('turn/start', { threadId: 'fork' })
    expect(source).toEqual(history(15))
    expect(rpc.mock.calls.filter(([method]) => method === 'thread/rollback')).toHaveLength(cutoff === 14 ? 0 : 1)
  })

  it.each([-1, 1.5, undefined])('rejects invalid cutoff %s before creating a fork', async cutoff => {
    const rpc = vi.fn()
    await expect(forkThreadAtCutoff({ rpc }, { threadId: 'source', forkFromTurnIndex: cutoff })).rejects.toThrow('Invalid fork response cutoff')
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['out-of-range', 'rollback-failure', 'missing-history'])('archives incomplete fork after %s', async failure => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'thread/fork') return { thread: { id: 'fork', turns: failure === 'missing-history' ? undefined : history(3) } }
      if (method === 'thread/rollback') throw new Error('rollback failed')
      return {}
    })
    await expect(forkThreadAtCutoff({ rpc }, { threadId: 'source', forkFromTurnIndex: failure === 'out-of-range' ? 5 : 0 })).rejects.toThrow()
    expect(rpc).toHaveBeenLastCalledWith('thread/archive', { threadId: 'fork' })
  })
})
