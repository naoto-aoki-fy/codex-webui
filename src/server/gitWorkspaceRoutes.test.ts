import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, stat, lstat, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as commands from './bridgeCommands.js'
import { createGitWorkspaceRoutes } from './gitWorkspaceRoutes.js'

let root: string
let repo: string
const run = commands.runCommand
const capture = commands.runCommandCapture
let payload: unknown
const persist = vi.fn<(path: string, label?: string) => Promise<void>>()
let routes: ReturnType<typeof createGitWorkspaceRoutes>
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-routes-'))
  repo = join(root, 'repo')
  await mkdir(repo)
  payload = { sourceCwd: repo }
  persist.mockReset()
  routes = createGitWorkspaceRoutes({
    readJsonBody: async () => payload,
    getCodexHomeDir: () => join(root, 'home'),
    persistWorkspaceRoot: persist,
    ensureRealDirectory: async (path, label) => {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`)
    },
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
async function request(method: string, path: string) {
  const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
  const url = new URL(path, 'http://localhost')
  const req = { method } as IncomingMessage
  const handled = await routes.handleWorktreeRoutes(req, res as unknown as ServerResponse, url)
    || await routes.handleCloneRoutes(req, res as unknown as ServerResponse, url)
  if (handled) expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
  return { handled, status: res.statusCode, body: res.end.mock.calls[0] ? JSON.parse(res.end.mock.calls[0][0]) : undefined }
}
const create = (permanent = false) => request('POST', '/codex-api/worktree/create' + (permanent ? '-permanent' : ''))
async function init() {
  await run('git', ['init'], { cwd: repo })
  await writeFile(join(repo, 'file'), 'initial')
  await run('git', ['add', '.'], { cwd: repo })
  await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'initial'], { cwd: repo })
}
it.each([false, true])('creates from an empty/non-Git repository, permanent=%s', async permanent => {
  payload = { sourceCwd: repo, worktreeName: 'permanent' }
  const result = await create(permanent)
  expect(result.status).toBe(200)
  expect(result.body).toEqual({ data: { cwd: expect.any(String), branch: permanent ? 'permanent' : null, gitRoot: repo } })
  const cwd = result.body.data.cwd
  expect(await stat(join(cwd, 'AGENTS.md'))).toBeDefined()
  expect(persist).toHaveBeenCalledExactlyOnceWith(cwd)
  expect(await capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).toBe(permanent ? 'permanent' : 'HEAD')
})
it('allocates a collision suffix and supports a detached source HEAD', async () => {
  await init()
  await run('git', ['branch', 'feature'], { cwd: repo })
  await run('git', ['checkout', '--detach'], { cwd: repo })
  payload = { sourceCwd: repo, worktreeName: 'feature' }
  expect((await create(true)).body.data.branch).toBe('feature-2')
  expect((await create(true)).status).toBe(409)
})
it.each([false, true])('rolls back persistence failures in exact command order, permanent=%s', async permanent => {
  await init()
  const spy = vi.spyOn(commands, 'runCommand')
  persist.mockRejectedValueOnce(new Error('storage failed'))
  payload = { sourceCwd: repo, worktreeName: 'feature' }
  expect(await create(permanent)).toMatchObject({ status: 500, body: { error: 'storage failed' } })
  const args = spy.mock.calls.map(call => call[1])
  const add = args.findIndex(row => row[0] === 'worktree' && row[1] === 'add')
  const cwd = args[add]![permanent ? 4 : 3]!
  expect(args.slice(add + 1)).toEqual([
    ['worktree', 'remove', '--force', cwd],
    ...(permanent ? [['branch', '-D', 'feature']] : []),
  ])
  await expect(stat(cwd)).rejects.toThrow()
  if (!permanent) await expect(stat(join(cwd, '..'))).rejects.toThrow()
})
it('falls back to filesystem cleanup and still removes the branch when Git removal fails', async () => {
  await init()
  vi.spyOn(commands, 'runCommand').mockImplementation(async (cmd, args, options) => {
    if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('remove failed')
    return run(cmd, args, options)
  })
  persist.mockRejectedValueOnce(new Error('storage failed'))
  payload = { sourceCwd: repo, worktreeName: 'feature' }
  expect((await create(true)).status).toBe(500)
  await expect(stat(join(root, 'feature'))).rejects.toThrow()
})
it('preserves partial add failure behavior without attempting rollback or persistence', async () => {
  await init()
  let partial = ''
  const spy = vi.spyOn(commands, 'runCommand').mockImplementation(async (_cmd, args) => {
    partial = args[3]!
    await mkdir(partial, { recursive: true })
    throw new Error('partial add failed')
  })
  expect(await create()).toMatchObject({ status: 500, body: { error: 'partial add failed' } })
  expect(spy.mock.calls.map(call => call[1][0])).toEqual(['worktree'])
  expect(persist).not.toHaveBeenCalled()
  expect((await stat(partial)).isDirectory()).toBe(true)
})
it('returns the Git error for an invalid start point', async () => {
  await init()
  payload = { sourceCwd: repo, baseBranch: 'missing-branch' }
  expect((await create()).status).toBe(500)
  expect(persist).not.toHaveBeenCalled()
})
it.each([
  ['POST', '/codex-api/worktree/create', {}, 400, 'Missing sourceCwd'],
  ['POST', '/codex-api/worktree/create-permanent', { sourceCwd: '/tmp', worktreeName: '..' }, 400, 'Worktree name must be a single folder name'],
  ['GET', '/codex-api/git/repository-status', {}, 400, 'Missing cwd'],
  ['GET', '/codex-api/worktree/branches', {}, 400, 'Missing sourceCwd'],
])('validates %s %s', async (method, path, body, status, error) => {
  payload = body
  expect(await request(method, path)).toMatchObject({ status, body: { error } })
})
it('preserves missing and non-directory path responses', async () => {
  payload = { sourceCwd: join(root, 'missing') }
  expect((await create()).status).toBe(404)
  await writeFile(join(root, 'file'), '')
  payload = { sourceCwd: join(root, 'file') }
  expect(await create()).toMatchObject({ status: 400, body: { error: 'sourceCwd is not a directory' } })
})
it('returns repository status and branches for non-Git, empty and initialized repositories', async () => {
  const status = () => request('GET', '/codex-api/git/repository-status?cwd=' + encodeURIComponent(repo))
  const branches = () => request('GET', '/codex-api/worktree/branches?sourceCwd=' + encodeURIComponent(repo))
  expect((await status()).body).toEqual({ data: { isGitRepo: false, gitRoot: '' } })
  expect((await branches()).body).toEqual({ data: [] })
  await run('git', ['init'], { cwd: repo })
  expect((await status()).body).toEqual({ data: { isGitRepo: true, gitRoot: repo } })
  expect((await branches()).body).toEqual({ data: [] })
  await init()
  const branch = await capture('git', ['branch', '--show-current'], { cwd: repo })
  expect((await branches()).body).toEqual({ data: [{ value: branch, label: branch }] })
})
it.each(['GET', 'PUT', 'DELETE'])('falls through for wrong method %s without reading a body', async method => {
  expect(await request(method, '/codex-api/worktree/create')).toEqual({ handled: false, status: 0, body: undefined })
  expect((await request('POST', '/codex-api/worktree/create/')).handled).toBe(false)
  expect((await request('POST', '/unrelated')).handled).toBe(false)
})
it.each([false, true])('clones with the original arguments and cleans partial failures=%s', async fail => {
  const target = join(root, 'example')
  const spy = vi.spyOn(commands, 'runCommand').mockImplementation(async () => {
    await mkdir(target)
    if (fail) throw new Error('clone failed')
  })
  payload = { url: 'https://github.com/owner/example', basePath: root }
  expect(await request('POST', '/codex-api/github-clone')).toMatchObject(fail
    ? { status: 400, body: { error: 'clone failed' } }
    : { status: 200, body: { data: { path: target } } })
  expect(spy).toHaveBeenCalledExactlyOnceWith('git', ['clone', 'https://github.com/owner/example.git', target], { cwd: root, timeoutMs: 300000 })
  if (fail) {
    await expect(stat(target)).rejects.toThrow()
    expect(persist).not.toHaveBeenCalled()
  } else expect(persist).toHaveBeenCalledExactlyOnceWith(target, '')
})
it('preserves a successful clone when persistence fails and rejects symlink destinations', async () => {
  const target = join(root, 'example')
  vi.spyOn(commands, 'runCommand').mockImplementation(async () => { await mkdir(target) })
  persist.mockRejectedValueOnce(new Error('storage failed'))
  payload = { url: 'git@github.com:owner/example.git', basePath: root }
  expect(await request('POST', '/codex-api/github-clone')).toMatchObject({ status: 400, body: { error: 'storage failed' } })
  expect((await stat(target)).isDirectory()).toBe(true)
  const link = join(root, 'link')
  await symlink(repo, link)
  payload = { url: 'https://github.com/owner/example', basePath: link }
  expect((await request('POST', '/codex-api/github-clone')).body).toEqual({ error: 'Clone destination folder must be a real directory' })
})
it('preserves branch activity sorting, normalization and origin/HEAD exclusion', async () => {
  vi.spyOn(commands, 'runCommandCapture')
    .mockResolvedValueOnce(repo)
    .mockResolvedValueOnce('10\trefs/heads/old\n20\trefs/remotes/origin/new\n30\trefs/remotes/origin/HEAD\n20\trefs/heads/alpha')
  expect((await request('GET', '/codex-api/worktree/branches?sourceCwd=' + repo)).body).toEqual({
    data: ['alpha', 'origin/new', 'old'].map(value => ({ value, label: value })),
  })
})
it('returns exact status and branch errors for non-repository-independent command failures', async () => {
  vi.spyOn(commands, 'runCommandCapture').mockRejectedValue(new Error('permission denied'))
  expect(await request('GET', '/codex-api/git/repository-status?cwd=' + repo))
    .toMatchObject({ status: 500, body: { error: 'permission denied' } })
  expect(await request('GET', '/codex-api/worktree/branches?sourceCwd=' + repo))
    .toMatchObject({ status: 500, body: { error: 'permission denied' } })
})
it('keeps the bounded branch collision loop and never adds or persists a worktree on exhaustion', async () => {
  await init()
  const spy = vi.spyOn(commands, 'runCommand').mockResolvedValue()
  payload = { sourceCwd: repo, worktreeName: 'feature' }
  expect(await create(true)).toMatchObject({ status: 500, body: { error: 'Failed to allocate a unique branch name for worktree' } })
  expect(spy.mock.calls).toHaveLength(100)
  expect(spy.mock.calls[99]![1]).toEqual(['show-ref', '--verify', '--quiet', 'refs/heads/feature-50'])
  expect(persist).not.toHaveBeenCalled()
})
it('rejects invalid clone URLs and existing destinations without issuing commands', async () => {
  const spy = vi.spyOn(commands, 'runCommand')
  payload = { url: 'https://example.com/owner/repo', basePath: root }
  expect(await request('POST', '/codex-api/github-clone'))
    .toMatchObject({ status: 400, body: { error: 'Only github.com repository URLs are supported' } })
  payload = { url: 'https://github.com/owner/repo', basePath: root }
  expect(await request('POST', '/codex-api/github-clone'))
    .toMatchObject({ status: 400, body: { error: `Destination already exists: ${repo}` } })
  expect(spy).not.toHaveBeenCalled()
})
it('keeps bridge dispatch at the original route boundaries', async () => {
  const { readFile } = await import('node:fs/promises')
  const bridge = await readFile(new URL('./codexAppServerBridge.ts', import.meta.url), 'utf8')
  const positions = [
    "url.pathname === '/codex-api/home-directory'",
    'await gitWorkspaceRoutes.handleWorktreeRoutes(req, res, url)',
    "url.pathname === '/codex-api/workspace-roots-state'",
    "url.pathname === '/codex-api/local-directory'",
    'await gitWorkspaceRoutes.handleCloneRoutes(req, res, url)',
    "url.pathname === '/codex-api/projectless-thread-cwd'",
  ].map((marker, index) => index === 2
    ? bridge.indexOf(marker, bridge.indexOf('await gitWorkspaceRoutes.handleWorktreeRoutes'))
    : bridge.indexOf(marker))
  expect(positions.every(position => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
})
