import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFilesWithRipgrep, runCommand, runCommandCapture, runCommandCaptureRaw } from './bridgeCommands.js'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const nodeArgs = (code: string) => ['-e', code]
const runners = [runCommand, runCommandCaptureRaw, runCommandCapture]

describe('real subprocess contracts', () => {
  it('returns void, raw stdout, or trimmed stdout and ignores successful stderr', async () => {
    const args = nodeArgs('process.stdout.write("  héllo\\n"); process.stderr.write("warning")')
    expect(await runCommand(process.execPath, args)).toBeUndefined()
    expect(await runCommandCaptureRaw(process.execPath, args)).toBe('  héllo\n')
    expect(await runCommandCapture(process.execPath, args)).toBe('héllo')
  })
  it('preserves empty output and large output without a size cap', async () => {
    expect(await runCommandCaptureRaw(process.execPath, nodeArgs(''))).toBe('')
    expect(await runCommandCapture(process.execPath, nodeArgs(''))).toBe('')
    const args = nodeArgs('process.stdout.write("x".repeat(2 * 1024 * 1024))')
    expect((await runCommandCaptureRaw(process.execPath, args)).length).toBe(2 * 1024 * 1024)
    expect(await runCommand(process.execPath, args)).toBeUndefined()
  })
  it.each(runners)('preserves failure details and partial output (%#)', async runner => {
    const args = nodeArgs('process.stdout.write("  partial\\n"); process.stderr.write("  problem\\n"); process.exitCode = 7')
    await expect(runner(process.execPath, args)).rejects.toThrow(
      `Command failed (${process.execPath} ${args.join(' ')}): problem\npartial`,
    )
    const emptyArgs = nodeArgs('process.exitCode = 3')
    await expect(runner(process.execPath, emptyArgs)).rejects.toThrow(
      `Command failed (${process.execPath} ${emptyArgs.join(' ')})`,
    )
  })
  it.each(runners)('preserves native spawn failures (%#)', async runner => {
    await expect(runner('/nonexistent/bridge-command-fixture', [])).rejects.toMatchObject({ code: 'ENOENT', syscall: 'spawn /nonexistent/bridge-command-fixture' })
    await expect(runner(process.execPath, [], { cwd: '/nonexistent/bridge-command-cwd' })).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('passes cwd and arguments with spaces literally', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bridge commands ')); directories.push(cwd)
    expect(await runCommandCaptureRaw(process.execPath, [...nodeArgs('process.stdout.write(JSON.stringify([process.cwd(), process.argv[1]]))'), 'a b'] , { cwd })).toBe(JSON.stringify([cwd, 'a b']))
  })
  it('lists hidden files and paths with spaces while excluding git and node_modules', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bridge rg ')); directories.push(cwd)
    for (const dir of ['.git', 'node_modules', 'with spaces']) await mkdir(join(cwd, dir))
    for (const file of ['.hidden', 'with spaces/file name.txt', '.git/config', 'node_modules/ignored']) await writeFile(join(cwd, file), '')
    expect((await listFilesWithRipgrep(cwd)).sort()).toEqual(['.hidden', 'with spaces/file name.txt'])
  })
})
