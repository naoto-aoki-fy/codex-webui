import { rpcCall } from './codexRpcClient'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { archiveThread, forkThread, forkThreadFromResponse, renameThread, resumeThread, revertThreadHistory, startThread, startThreadTurn } from './codexGateway'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function payload(version: string) {
  return { thread: { id: 'created', model: version, turns: [{ id: version, status: version === 'before' ? 'inProgress' : 'completed', items: [{ id: version, type: 'agentMessage', text: version }] }] } }
}
const response = (version: string) => new Response(JSON.stringify({ result: { ...payload(version), forkCutoff: { sourceThreadId: 'A', turnId: 'turn-0' } } }))
const invalidates = (name: string) => name === 'rollback' || name === 'turn start'
const mutations = [
  ['archive', (id: string) => archiveThread(id), 'thread/archive'],
  ['rename', (id: string) => renameThread(id, 'new title'), 'thread/name/set'],
  ['rollback', (id: string) => revertThreadHistory(id, 'turn'), 'thread/revert'],
  ['turn start', (id: string) => startThreadTurn(id, 'next'), 'turn/start'],
  ['fork', (id: string) => forkThread(id), 'thread/fork'],
  ['fork with options', (id: string) => forkThread(id, '/workspace', 'model'), 'thread/fork'],
  ['response fork', (id: string) => forkThreadFromResponse(id, 'turn-0'), 'thread/fork-at-response'],
  ['thread start', (_id: string) => startThread('/workspace'), 'thread/start'],
] as const

afterEach(async () => {
  // Drain retention timers so module-owned entries never leak between cases.
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fixture() {
  vi.useFakeTimers()
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const resumes: ReturnType<typeof deferred<Response>>[] = []
  const mutation = deferred<Response>()
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    if (body.method !== 'thread/resume') return mutation.promise
    const pending = deferred<Response>()
    resumes.push(pending)
    return pending.promise
  }))
  return { requests, resumes, mutation }
}

describe('Resume freshness regression (Gateway only, not server history recovery)', () => {
  it.each(mutations)('applies the mutation-specific settled cache policy for %s', async (_name, mutate, method) => {
    const f = fixture()
    const first = resumeThread('A')
    f.resumes[0]!.resolve(response('before'))
    const before = await first
    expect(before.messages).toMatchObject([{ text: 'before' }])
    expect(before.inProgress).toBe(true)
    expect(await resumeThread('A')).toBe(before)
    f.mutation.resolve(response('after'))
    await mutate('A')
    expect(f.requests.map(r => r.method)).toEqual(['thread/resume', method])
    if (!invalidates(_name)) {
      await vi.advanceTimersByTimeAsync(1999)
      expect(await resumeThread('A')).toBe(before)
      expect(f.resumes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
    }
    const fresh = resumeThread('A')
    expect(f.resumes).toHaveLength(2)
    f.resumes[1]!.resolve(response('after'))
    const after = await fresh
    expect(after).not.toBe(before)
    expect(after.messages).toMatchObject([{ text: 'after' }])
    expect(after.inProgress).toBe(false)
    expect(f.requests.map(r => r.method)).toEqual(['thread/resume', method, 'thread/resume'])
  })

  for (const outcome of ['success', 'failure'] as const) {
    it.each(mutations)(`applies pending Resume ownership across %s ${outcome}`, async (_name, mutate, method) => {
      const f = fixture()
      const first = resumeThread('A')
      const joined = resumeThread('A')
      const other = resumeThread('B')
      const mutation = mutate('A')
      const during = resumeThread('A')
      expect(f.resumes).toHaveLength(2)
      if (outcome === 'failure') {
        const rejected = expect(mutation).rejects.toThrow('mutation failed')
        f.mutation.reject(new Error('mutation failed'))
        await rejected
      } else {
        f.mutation.resolve(response('after'))
        await mutation
      }
      const fresh = outcome === 'success' && invalidates(_name)
      const again = resumeThread('A')
      if (fresh) f.resumes[2]!.resolve(response('after'))
      expect(f.requests.map(r => r.method)).toEqual(['thread/resume', 'thread/resume', method, ...(fresh ? ['thread/resume'] : [])])
      expect(f.requests.slice(0, 2).map(r => r.params.threadId)).toEqual(['A', 'B'])
      f.resumes[0]!.resolve(response('before'))
      f.resumes[1]!.resolve(response('independent'))
      const results = await Promise.all([first, joined, again])
      expect(results[1]).toBe(results[0])
      expect(await during).toBe(results[0])
      if (fresh) expect(results[2]).not.toBe(results[0])
      else expect(results[2]).toBe(results[0])
      expect(results[0]).toMatchObject({ inProgress: true, messages: [{ text: 'before' }] })
      expect(await resumeThread('A')).toBe(results[2])
      const independent = await other
      expect(independent).not.toBe(results[0])
      expect(await resumeThread('B')).toBe(independent)
      expect(f.resumes).toHaveLength(fresh ? 3 : 2)
    })
  }

  it.each(['success', 'failure'] as const)('handles Resume settlement before mutation %s', async outcome => {
    const f = fixture()
    const first = resumeThread('A')
    const mutation = revertThreadHistory('A', 'turn')
    const checked = outcome === 'failure' ? expect(mutation).rejects.toThrow('mutation failed') : mutation
    f.resumes[0]!.resolve(response('before'))
    const before = await first
    expect(await resumeThread('A')).toBe(before)
    if (outcome === 'success') f.mutation.resolve(response('after'))
    else f.mutation.reject(new Error('mutation failed'))
    await checked
    const next = resumeThread('A')
    if (outcome === 'success') f.resumes[1]!.resolve(response('after'))
    expect((await next) === before).toBe(outcome === 'failure')
  })

  it('each concurrent mutation success invalidates Resumes started during the mutation window', async () => {
    const f = fixture()
    const secondMutation = deferred<Response>()
    const fetch = vi.mocked(globalThis.fetch)
    const original = fetch.getMockImplementation()!
    let mutations = 0
    fetch.mockImplementation((url, init) => {
      if (JSON.parse(String(init?.body)).method === 'thread/revert' && ++mutations === 2) return secondMutation.promise
      return original(url, init)
    })
    const first = revertThreadHistory('A', 'turn')
    const second = revertThreadHistory('A', 'turn')
    f.mutation.resolve(response('after'))
    await first
    const during = resumeThread('A')
    secondMutation.resolve(response('after'))
    await second
    const fresh = resumeThread('A')
    const joined = resumeThread('A')
    expect(f.resumes).toHaveLength(2)
    f.resumes[1]!.resolve(response('after'))
    const after = await fresh
    expect(await joined).toBe(after)
    f.resumes[0]!.resolve(response('before'))
    expect(await during).not.toBe(after)
    expect(await resumeThread('A')).toBe(after)
  })

  it('retains an uninvalidated rejection for exactly 2 seconds', async () => {
    const f = fixture()
    const first = expect(resumeThread('A')).rejects.toThrow('resume failed')
    f.resumes[0]!.reject(new Error('resume failed'))
    await first
    await vi.advanceTimersByTimeAsync(1999)
    await expect(resumeThread('A')).rejects.toThrow('resume failed')
    expect(f.resumes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const next = resumeThread('A')
    f.resumes[1]!.resolve(response('after'))
    await next
  })

  it('invalidates a retained Resume rejection when rollback succeeds', async () => {
    const f = fixture()
    const first = resumeThread('A')
    const rejected = expect(first).rejects.toThrow('resume failed')
    const mutation = revertThreadHistory('A', 'turn')
    f.resumes[0]!.reject(new Error('resume failed'))
    await rejected
    f.mutation.resolve(response('after'))
    await mutation
    const retry = resumeThread('A')
    f.resumes[1]!.resolve(response('after'))
    expect(await retry).toMatchObject({ inProgress: false })
    expect(f.requests.map(r => r.method)).toEqual(['thread/resume', 'thread/revert', 'thread/resume'])
  })

  for (const outcome of ['success', 'failure'] as const) {
    for (const order of ['old first', 'replacement first'] as const) {
      it(`evicts without cancellation; ${outcome}, ${order} cannot delete replacement ownership`, async () => {
        const f = fixture()
        let settled = false
        const old = resumeThread('A')
        const observed = old.then(value => { settled = true; return value }, error => { settled = true; return error })
        await vi.advanceTimersByTimeAsync(29_999)
        const joined = resumeThread('A').catch(error => error)
        expect(f.resumes).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(settled).toBe(false)
        const replacement = resumeThread('A')
        expect(f.resumes).toHaveLength(2)
        const settleOld = async () => {
          if (outcome === 'success') f.resumes[0]!.resolve(response('before'))
          else f.resumes[0]!.reject(new Error('late failure'))
          const result = await observed
          expect(await joined).toBe(result)
          if (outcome === 'success') expect(result).toMatchObject({ inProgress: true })
          else expect(result).toBeInstanceOf(Error)
        }
        if (order === 'old first') {
          await settleOld()
          await vi.advanceTimersByTimeAsync(2000)
          const stillJoined = resumeThread('A')
          expect(f.resumes).toHaveLength(2)
          f.resumes[1]!.resolve(response('after'))
          expect(await stillJoined).toBe(await replacement)
        } else {
          f.resumes[1]!.resolve(response('after'))
          await replacement
          await vi.advanceTimersByTimeAsync(500)
          await settleOld()
          expect(await resumeThread('A')).toBe(await replacement)
          await vi.advanceTimersByTimeAsync(1500)
          const third = resumeThread('A')
          expect(f.resumes).toHaveLength(3)
          // Old cleanup fires while a third request owns the slot.
          await vi.advanceTimersByTimeAsync(500)
          const thirdJoined = resumeThread('A')
          expect(f.resumes).toHaveLength(3)
          f.resumes[2]!.resolve(response('third'))
          expect(await thirdJoined).toBe(await third)
        }
        expect(await replacement).toMatchObject({ inProgress: false, messages: [{ text: 'after' }] })
      })
    }
  }
  for (const outcome of ['success', 'failure'] as const) {
    for (const order of ['old first', 'replacement first'] as const) {
      it(`mutation invalidates without cancellation; ${outcome}, ${order} cannot delete replacement ownership`, async () => {
        const f = fixture()
        let settled = false
        const old = resumeThread('A')
        const observed = old.then(value => { settled = true; return value }, error => { settled = true; return error })
        const joined = resumeThread('A').catch(error => error)
        f.mutation.resolve(response('after'))
        await revertThreadHistory('A', 'turn')
        expect(settled).toBe(false)
        const replacement = resumeThread('A')
        expect(f.resumes).toHaveLength(2)
        const settleOld = async () => {
          if (outcome === 'success') f.resumes[0]!.resolve(response('before'))
          else f.resumes[0]!.reject(new Error('late failure'))
          const result = await observed
          expect(await joined).toBe(result)
          if (outcome === 'success') expect(result).toMatchObject({ inProgress: true })
          else expect(result).toBeInstanceOf(Error)
        }
        if (order === 'old first') {
          await settleOld()
          await vi.advanceTimersByTimeAsync(2000)
          const stillJoined = resumeThread('A')
          expect(f.resumes).toHaveLength(2)
          f.resumes[1]!.resolve(response('after'))
          expect(await stillJoined).toBe(await replacement)
        } else {
          f.resumes[1]!.resolve(response('after'))
          await replacement
          await vi.advanceTimersByTimeAsync(500)
          await settleOld()
          expect(await resumeThread('A')).toBe(await replacement)
          await vi.advanceTimersByTimeAsync(1500)
          const third = resumeThread('A')
          expect(f.resumes).toHaveLength(3)
          // Old cleanup fires while a third request owns the slot.
          await vi.advanceTimersByTimeAsync(500)
          const thirdJoined = resumeThread('A')
          expect(f.resumes).toHaveLength(3)
          f.resumes[2]!.resolve(response('third'))
          expect(await thirdJoined).toBe(await third)
        }
        expect(await replacement).toMatchObject({ inProgress: false, messages: [{ text: 'after' }] })
      })
    }
  }
})

it('browser HTTP RPC has no application deadline or notification-driven replay; fetch owns failure', async () => {
  vi.useFakeTimers()
  let reject!: (error: Error) => void
  const fetch = vi.fn(() => new Promise<Response>((_yes, no) => { reject = no }))
  vi.stubGlobal('fetch', fetch)
  const call = rpcCall('thread/resume', { threadId: 'A' })
  let settled = false
  const observed = call.catch(error => { settled = true; return error })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(settled).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]).toEqual(['/codex-api/rpc', expect.objectContaining({ method: 'POST', body: JSON.stringify({ method: 'thread/resume', params: { threadId: 'A' } }) })])
  expect(vi.getTimerCount()).toBe(0)
  reject(new Error('connection closed'))
  expect(await observed).toMatchObject({ code: 'network_error', method: 'thread/resume' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('coalesces overlapping retained-page recovery without dropping newly requested IDs', async () => {
  const f = fixture()
  const first = resumeThread('A', ['older'])
  const plain = resumeThread('A')
  const same = resumeThread('A', ['older'])
  const wider = resumeThread('A', ['older', 'earlier'])
  const joined = resumeThread('A', ['earlier'])
  expect(f.resumes).toHaveLength(2)
  f.resumes[0]!.resolve(response('first'))
  f.resumes[1]!.resolve(response('wider'))
  expect(await first).toBe(await plain)
  expect(await first).toBe(await same)
  expect(await wider).toBe(await joined)
})
