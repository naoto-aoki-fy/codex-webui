import { rpcCall } from './codexRpcClient'

export const usageMetrics = [
  ['lifetimeTokens', 'Lifetime tokens', 'tokens'],
  ['peakDailyTokens', 'Peak daily tokens', 'tokens/day'],
  ['longestRunningTurnSec', 'Longest running turn', 'seconds'],
  ['currentStreakDays', 'Current streak', 'days'],
  ['longestStreakDays', 'Longest streak', 'days'],
] as const
export type AccountUsage = {
  summary: Partial<Record<typeof usageMetrics[number][0], number>>
  daily: Array<{ startDate: string; tokens: number }> | null
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
/** Narrow read-only projection of GetAccountTokenUsageResponse. No local aggregation. */
export function normalizeAccountUsage(value: unknown): AccountUsage | null {
  if (value == null) return null
  const row = record(value)
  const summary = record(row?.summary)
  if (!summary) throw new Error('Incompatible account usage response')
  const result: AccountUsage = { summary: {}, daily: null }
  for (const [key] of usageMetrics) {
    if (summary[key] != null && !count(summary[key])) throw new Error(`Invalid account usage metric: ${key}`)
    if (count(summary[key])) result.summary[key] = summary[key]
  }
  if (row?.dailyUsageBuckets != null) {
    if (!Array.isArray(row.dailyUsageBuckets)) throw new Error('Invalid daily usage history')
    result.daily = row.dailyUsageBuckets.map(value => {
      const bucket = record(value)
      if (typeof bucket?.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bucket.startDate) || !count(bucket.tokens)) throw new Error('Invalid daily usage bucket')
      return { startDate: bucket.startDate, tokens: bucket.tokens }
    })
  }
  return result
}
export async function getAccountUsage(): Promise<AccountUsage | null> {
  return normalizeAccountUsage(await rpcCall('account/usage/read', null))
}
