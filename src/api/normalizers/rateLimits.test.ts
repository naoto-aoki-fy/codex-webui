import { describe, expect, it } from 'vitest'
import { pickCodexRateLimitSnapshot as gatewayPick } from '../codexGateway'
import { pickCodexRateLimitSnapshot as pick } from './rateLimits'

const window = { usedPercent: 25, windowDurationMins: 300, resetsAt: 1234 }
const normalizedWindow = { ...window, windowMinutes: 300 }
const emptySnapshot = {
  limitId: null, limitName: null, primary: null, secondary: null, credits: null, planType: null,
}

describe('rate limit normalization', () => {
  it('preserves the gateway export as the same function', () => {
    expect(gatewayPick).toBe(pick)
    expect(gatewayPick({ rateLimits: { primary: window } })).toEqual(pick({ rateLimits: { primary: window } }))
  })

  it('normalizes camelCase fields and both windows without mutating or reusing input objects', () => {
    const credits = Object.freeze({ hasCredits: true, unlimited: false, balance: '12.50' })
    const primary = Object.freeze({ ...window })
    const secondary = Object.freeze({ usedPercent: 75, windowDurationMins: 10080, resetsAt: 5678 })
    const bucket = Object.freeze({ limitId: 'codex', limitName: 'Codex', planType: 'pro', primary, secondary, credits })
    const result = pick({ rateLimits: bucket })!
    expect(result).toEqual({ ...bucket, primary: normalizedWindow, secondary: { ...secondary, windowMinutes: 10080 } })
    expect(result).not.toBe(bucket)
    expect(result.primary).not.toBe(primary)
    expect(result.secondary).not.toBe(secondary)
    expect(result.credits).not.toBe(credits)
    expect(pick({ rateLimits: bucket })).not.toBe(result)
    expect(Object.keys(result)).toEqual(['limitId', 'limitName', 'primary', 'secondary', 'credits', 'planType'])
  })

  it('normalizes snake_case aliases including the codex bucket map', () => {
    expect(pick({ rate_limits_by_limit_id: { codex: {
      limit_id: 'codex', limit_name: 'Codex', plan_type: 'plus',
      primary: { used_percent: 25, window_minutes: 300, resets_at: 1234 },
      secondary: { used_percent: 0 },
      credits: { has_credits: false, unlimited: true, balance: '0' },
    } } })).toEqual({
      limitId: 'codex', limitName: 'Codex', planType: 'plus', primary: normalizedWindow,
      secondary: { usedPercent: 0, windowDurationMins: null, windowMinutes: null, resetsAt: null },
      credits: { hasCredits: false, unlimited: true, balance: '0' },
    })
  })

  it('prefers codex regardless of bucket insertion order and falls back only to rateLimits', () => {
    const fallback = { secondary: window }
    for (const buckets of [
      { other: fallback, codex: { primary: window } },
      { codex: { primary: window }, other: fallback },
    ]) {
      expect(pick({ rateLimitsByLimitId: buckets, rateLimits: fallback })?.primary).toEqual(normalizedWindow)
    }
    for (const codex of [undefined, null, {}, [], { primary: { usedPercent: '25' } }]) {
      expect(pick({ rateLimitsByLimitId: { other: { primary: window }, codex }, rateLimits: fallback }))
        .toEqual({ ...emptySnapshot, secondary: normalizedWindow })
    }
    expect(pick({ rateLimitsByLimitId: { other: { primary: window } } })).toBeNull()
  })

  it.each([undefined, null, '', 0, false, [], {}, { rateLimits: null }, { rateLimits: [] },
    { rateLimits: { limitId: 'metadata-only' } },
    { rateLimits: { primary: [], secondary: 'bad', credits: {} } },
  ])('returns null for empty or malformed input: %j', (payload) => {
    expect(pick(payload)).toBeNull()
  })

  it.each(['25', '', true, null, undefined, NaN, Infinity, -Infinity])('rejects invalid usedPercent: %s', (usedPercent) => {
    expect(pick({ rateLimits: { primary: { usedPercent } } })).toBeNull()
  })

  it.each(['300', NaN, Infinity, -Infinity, {}, null, undefined])('nulls invalid optional numbers: %s', (value) => {
    expect(pick({ rateLimits: { primary: { usedPercent: -1.5, windowDurationMins: value, resetsAt: value } } }))
      .toEqual({ ...emptySnapshot, primary: { usedPercent: -1.5, windowDurationMins: null, windowMinutes: null, resetsAt: null } })
  })

  it('uses nullish alias precedence without retrying invalid preferred values', () => {
    expect(pick({ rateLimits: { primary: { usedPercent: 'bad', used_percent: 25 } } })).toBeNull()
    expect(pick({ rateLimits: {}, rate_limits: { primary: window } })).toBeNull()
    expect(pick({ rateLimitsByLimitId: [], rate_limits_by_limit_id: { codex: { primary: window } } })).toBeNull()
    expect(pick({ rateLimits: {
      limitId: '', limit_id: 'fallback', limitName: 42, limit_name: 'fallback', planType: null, plan_type: 'plus',
      primary: { usedPercent: null, used_percent: 25, windowDurationMins: 'bad', window_minutes: 300, resetsAt: NaN, resets_at: 1234 },
    } })).toEqual({ ...emptySnapshot, planType: 'plus', primary: { usedPercent: 25, windowDurationMins: null, windowMinutes: null, resetsAt: null } })
  })

  it.each(['12.50', '0', ' ', '', 12.5, null, undefined])('preserves string-only credit balances: %s', (balance) => {
    expect(pick({ rateLimits: { credits: { hasCredits: false, unlimited: false, balance } } }))
      .toEqual({ ...emptySnapshot, credits: { hasCredits: false, unlimited: false, balance: typeof balance === 'string' && balance.length > 0 ? balance : null } })
  })

  it.each([{}, [], null, { hasCredits: true }, { unlimited: false }, { hasCredits: 'true', unlimited: false },
    { hasCredits: 1, has_credits: true, unlimited: false }, { hasCredits: true, unlimited: 0 },
  ])('discards malformed credits while preserving a valid secondary window: %j', (credits) => {
    expect(pick({ rateLimits: { credits, secondary: window } })).toEqual({ ...emptySnapshot, secondary: normalizedWindow })
  })

  it('keeps finite zero, negative and out-of-range numbers and ignores unrecognized remaining fields', () => {
    expect(pick({ rateLimits: { primary: { usedPercent: 125, windowDurationMins: -5, resetsAt: 0, remaining: 10 } } }))
      .toEqual({ ...emptySnapshot, primary: { usedPercent: 125, windowDurationMins: -5, windowMinutes: -5, resetsAt: 0 } })
    expect(pick({ rateLimits: { remaining: 10, credits: { balance: '10' } } })).toBeNull()
  })
})
