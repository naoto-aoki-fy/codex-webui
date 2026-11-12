import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
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
it.each([false, true])('rejects missing worktree prerequisites without mutations, empty Git=%s', async emptyGit => {
  if (emptyGit) await run('git', ['init'], { cwd: repo })
  const spy = vi.spyOn(commands, 'runCommand')
  expect((await create()).status).toBe(500)
  expect(spy).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
  await expect(stat(join(repo, 'AGENTS.md'))).rejects.toThrow()
  await expect(stat(join(root, 'home'))).rejects.toThrow()
  if (!emptyGit) await expect(stat(join(repo, '.git'))).rejects.toThrow()
})
it('creates a detached worktree from an existing commit', async () => {
  await init()
  const result = await create()
  expect(result.status).toBe(200)
  expect(result.body.data.branch).toBeNull()
  expect(await capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: result.body.data.cwd })).toBe('HEAD')
  expect(persist).toHaveBeenCalledExactlyOnceWith(result.body.data.cwd)
})
it('cleans up a worktree when persistence fails', async () => {
  await init()
  persist.mockRejectedValueOnce(new Error('storage failed'))
  expect(await create()).toMatchObject({ status: 500, body: { error: 'storage failed' } })
  expect(await capture('git', ['worktree', 'list', '--porcelain'], { cwd: repo })).not.toContain('/home/worktrees/')
})
it('does not handle the retired permanent-worktree route', async () => {
  expect((await create(true)).handled).toBe(false)
})
it('returns the Git error for an invalid start point', async () => {
  await init()
  payload = { sourceCwd: repo, baseBranch: 'missing-branch' }
  expect((await create()).status).toBe(500)
  expect(persist).not.toHaveBeenCalled()
})
it.each([
  ['POST', '/codex-api/worktree/create', {}, 400, 'Missing sourceCwd'],
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
