import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), resolve: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../commandResolution.js', () => ({ resolveRipgrepCommand: mocks.resolve }))
import { listFilesWithRipgrep, runCommand, runCommandCaptureRaw } from './bridgeCommands.js'

let proc: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.useFakeTimers()
  mocks.spawn.mockReset(); mocks.resolve.mockReset()
  proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
  mocks.spawn.mockReturnValue(proc)
  mocks.resolve.mockReturnValue('fixture rg')
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it.each([false, true])('sends SIGTERM and escalates only while open: %s', async closeOnTerm => {
  const promise = runCommand('tool', ['a b'], { cwd: '/working dir', timeoutMs: 100 })
  const rejection = expect(promise).rejects.toThrow('Command timed out after 100ms (tool a b)')
  proc.stdout.emit('data', Buffer.from('partial'))
  await vi.advanceTimersByTimeAsync(100)
  expect(proc.kill.mock.calls).toEqual([['SIGTERM']])
  if (closeOnTerm) proc.emit('close', 0)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(proc.kill.mock.calls).toEqual(closeOnTerm ? [['SIGTERM']] : [['SIGTERM'], ['SIGKILL']])
  if (!closeOnTerm) proc.emit('close', null)
  await rejection
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('tool', ['a b'], { cwd: '/working dir', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
})
it('clears timeout after spawn error and preserves error identity', async () => {
  const error = new Error('spawn failure')
  const promise = runCommand('tool', [], { timeoutMs: 100 })
  const rejection = expect(promise).rejects.toBe(error)
  proc.emit('error', error)
  await rejection
  await vi.advanceTimersByTimeAsync(6_000)
  expect(proc.kill).not.toHaveBeenCalled()
})
it.each([undefined, 0, -1, Infinity, NaN])('does not schedule invalid timeout %s', async timeoutMs => {
  const promise = runCommand('tool', [], { timeoutMs })
  expect(vi.getTimerCount()).toBe(0)
  proc.emit('close', 0)
  await promise
})
it('clears timeout on success', async () => {
  const promise = runCommand('tool', [], { timeoutMs: 100 })
  proc.emit('close', 0)
  await promise
  expect(vi.getTimerCount()).toBe(0)
})
it('preserves chunk toString decoding and raw whitespace', async () => {
  const promise = runCommandCaptureRaw('tool', [])
  proc.stdout.emit('data', Buffer.from([0xc3]))
  proc.stdout.emit('data', Buffer.from([0xa9, 10]))
  proc.emit('close', 0)
  expect(await promise).toBe('��\n')
})
it('preserves missing ripgrep error without spawning', async () => {
  mocks.resolve.mockReturnValue(null)
  await expect(listFilesWithRipgrep('/cwd')).rejects.toThrow(/ripgrep \(rg\) is not available.*rg --version.*CODEXUI_RG_COMMAND/)
  expect(mocks.spawn).not.toHaveBeenCalled()
})
it.each([['', '', 'rg --files failed'], [' partial\n', ' error\n', 'error\npartial']])('preserves rg nonzero failure %j', async (stdout, stderr, message) => {
  const promise = listFilesWithRipgrep('/cwd')
  proc.stdout.emit('data', Buffer.from(stdout)); proc.stderr.emit('data', Buffer.from(stderr))
  proc.emit('close', 1)
  await expect(promise).rejects.toThrow(message)
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('fixture rg', ['--files', '--hidden', '-g', '!.git', '-g', '!node_modules'], { cwd: '/cwd', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
})
it('preserves rg CRLF splitting and per-line trimming', async () => {
  const promise = listFilesWithRipgrep('/cwd')
  proc.stdout.emit('data', Buffer.from(' a b \r\n\n.hidden\n'))
  proc.emit('close', 0)
  expect(await promise).toEqual(['a b', '.hidden'])
})

it('preserves rg spawn errors when the executable disappears after resolution', async () => {
  const promise = listFilesWithRipgrep('/cwd')
  const error = Object.assign(new Error('spawn fixture rg ENOENT'), { code: 'ENOENT' })
  proc.emit('error', error)
  await expect(promise).rejects.toBe(error)
})
