import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { normalizeAccountUsage, usageMetrics } from '../api/accountUsage'
import { createAccountUsage } from './accountUsage'
describe('real account usage', () => {
  it('keeps native units/periods, zero and unavailable metrics distinct', () => {
    expect(normalizeAccountUsage({ summary: { lifetimeTokens: 0 }, dailyUsageBuckets: [] })).toEqual({ summary: { lifetimeTokens: 0 }, daily: [] })
    expect(normalizeAccountUsage({ summary: {} })).toEqual({ summary: {}, daily: null })
    expect(normalizeAccountUsage(null)).toBe(null)
    expect(usageMetrics).toContainEqual(['longestRunningTurnSec', 'Longest running turn', 'seconds'])
    expect(normalizeAccountUsage({ summary: { lifetimeTokens: 500, currentStreakDays: 2 }, dailyUsageBuckets: [{ startDate: '2026-11-01', tokens: 123 }] })?.daily).toEqual([{ startDate: '2026-11-01', tokens: 123 }])
    expect(() => normalizeAccountUsage({ summary: { lifetimeTokens: -1 } })).toThrow()
    expect(() => normalizeAccountUsage({ summary: {}, dailyUsageBuckets: [{ startDate: 'bad', tokens: 0 }] })).toThrow()
  })
  it('does no startup fetch or polling, coalesces clicks, and rejects old profile results', async () => {
    const epoch = ref(0)
    let resolve!: (value: null) => void
    const read = vi.fn(() => new Promise<null>(r => { resolve = r }))
    const state = createAccountUsage(epoch, read)
    expect(read).not.toHaveBeenCalled()
    const job = state.refresh(); await state.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    epoch.value++; resolve(null); await job
    expect(state.loaded.value).toBe(false)
    expect(state.data.value).toBe(null)
  })
  it('distinguishes unsupported from permission/transport errors without showing zeros', async () => {
    const read = vi.fn().mockRejectedValueOnce(Object.assign(new Error('missing'), { rpcCode: -32601 })).mockRejectedValueOnce(new Error('permission denied'))
    const state = createAccountUsage(ref(0), read)
    await state.refresh(); expect(state.error.value).toContain('unsupported')
    await state.refresh(); expect(state.error.value).toBe('permission denied')
    expect(state.data.value).toBe(null)
  })
})
