import { afterEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolveRipgrepCommand } from './commandResolution.js'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('node:fs', () => ({ existsSync: () => true }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it.each(['linux', 'win32'] as const)('resolves an explicit executable with spaces on %s', platform => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  vi.stubEnv('CODEXUI_RG_COMMAND', '/tools with spaces/rg')
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>)
  expect(resolveRipgrepCommand()).toBe('/tools with spaces/rg')
  expect(spawnSync).toHaveBeenLastCalledWith('/tools with spaces/rg', ['--version'], { stdio: 'ignore', windowsHide: true })
})

it.each(['linux', 'win32'] as const)('falls back from an inaccessible override to PATH on %s', platform => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  vi.stubEnv('CODEXUI_RG_COMMAND', '/invalid/rg')
  vi.mocked(spawnSync).mockImplementation(command => ({ status: command === 'rg' ? 0 : null, error: command === 'rg' ? undefined : new Error('EACCES') }) as ReturnType<typeof spawnSync>)
  expect(resolveRipgrepCommand()).toBe('rg')
})

it('returns null when all candidates fail without throwing during module import', () => {
  vi.mocked(spawnSync).mockReturnValue({ status: null, error: new Error('ENOENT') } as ReturnType<typeof spawnSync>)
  expect(resolveRipgrepCommand()).toBeNull()
})
