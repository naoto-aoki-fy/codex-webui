import { describe, expect, it } from 'vitest'
import { formatTurnDuration, parseIsoTimestamp } from './turnTiming'

describe('parseIsoTimestamp', () => {
  it.each([
    ['1970-01-01T00:00:00.000Z', 0],
    ['2026-11-11T13:00:00.123Z', 1794402000123],
    ['1970-01-01T09:00:00+09:00', 0],
    ['1969-12-31T23:59:59.000Z', -1000],
  ])('parses %s as epoch milliseconds', (value, expected) => {
    expect(parseIsoTimestamp(value)).toBe(expected)
  })

  it.each(['', '   ', 'invalid', '2026-13-01T00:00:00Z'])('returns null for %j', (value) => {
    expect(parseIsoTimestamp(value)).toBeNull()
  })

  it('preserves the runtime guard for missing inputs without widening the string signature', () => {
    // @ts-expect-error Missing input is outside the public signature, but guarded at runtime.
    expect(parseIsoTimestamp()).toBeNull()
    // @ts-expect-error Undefined input is outside the public signature.
    expect(parseIsoTimestamp(undefined)).toBeNull()
    // @ts-expect-error Null input is outside the public signature.
    expect(parseIsoTimestamp(null)).toBeNull()
  })
})

describe('formatTurnDuration', () => {
  it.each([0, -0, -1, -1000, NaN, Infinity, -Infinity])('formats %s as <1s', (value) => {
    expect(formatTurnDuration(value)).toBe('<1s')
  })

  // Existing behavior: every positive duration displays at least 1s, even below 500ms.
  it.each([
    [0.1, '1s'],
    [499, '1s'],
    [500, '1s'],
    [1000, '1s'],
    [1499.9, '1s'],
    [1500, '2s'],
    [59499.9, '59s'],
    [59500, '1m 0s'],
    [60000, '1m 0s'],
    [61000, '1m 1s'],
    [3599499.9, '59m 59s'],
    [3599500, '1h 0m 0s'],
    [3600000, '1h 0m 0s'],
    [3601000, '1h 0m 1s'],
    [3660000, '1h 1m 0s'],
    [7323000, '2h 2m 3s'],
  ])('formats %sms as %s', (value, expected) => {
    expect(formatTurnDuration(value)).toBe(expected)
  })
})
