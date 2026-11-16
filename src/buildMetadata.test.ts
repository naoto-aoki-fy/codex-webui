import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBuildMetadata } from '../scripts/build-metadata'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const sha = '1234567890abcdef1234567890abcdef12345678'

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('build metadata', () => {
  it('prefers GITHUB_SHA without invoking Git and records build time in UTC', () => {
    vi.stubEnv('GITHUB_SHA', ` ${sha}\n`)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T01:02:03.456Z'))
    expect(getBuildMetadata()).toEqual({ commitSha: sha, timestamp: '2026-11-16T01:02:03.456Z' })
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '  '])('uses the repository HEAD when GITHUB_SHA is %j', value => {
    vi.stubEnv('GITHUB_SHA', value)
    vi.mocked(execFileSync).mockReturnValue(`${sha}\n`)
    expect(getBuildMetadata().commitSha).toBe(sha)
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith('git', ['rev-parse', 'HEAD'], expect.objectContaining({
      cwd: expect.any(String), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }))
  })

  it.each([
    Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' }),
    new Error('fatal: not a git repository'),
    Object.assign(new Error('Git timed out'), { code: 'ETIMEDOUT' }),
  ])('falls back safely when Git fails: %s', error => {
    vi.stubEnv('GITHUB_SHA', undefined)
    vi.mocked(execFileSync).mockImplementation(() => { throw error })
    const metadata = getBuildMetadata()
    expect(metadata.commitSha).toBe('Unknown')
    expect(new Date(metadata.timestamp).toISOString()).toBe(metadata.timestamp)
  })

  it('falls back when Git returns no SHA', () => {
    vi.stubEnv('GITHUB_SHA', undefined)
    vi.mocked(execFileSync).mockReturnValue('\n')
    expect(getBuildMetadata().commitSha).toBe('Unknown')
  })
})
