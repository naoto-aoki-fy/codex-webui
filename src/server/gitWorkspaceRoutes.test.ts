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
    // Same-host protocol fixture: these functions represent B, not a production fallback.
    appServer: {
      rpc: async (method, raw) => {
        const p = raw as any
        if (method === 'fs/getMetadata') { const info = await stat(p.path); return { isFile: info.isFile(), isDirectory: info.isDirectory() } }
        if (method === 'fs/createDirectory') return mkdir(p.path, { recursive: true })
        if (method === 'fs/remove') return rm(p.path, { recursive: true, force: true })
        if (method === 'command/exec') return { exitCode: 0, stdout: await commands.runCommandCapture(p.command[0], p.command.slice(1), { cwd: p.cwd }), stderr: '' }
        throw new Error('Unexpected RPC ' + method)
      },
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
  if (handled) expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
  return { handled, status: res.statusCode, body: res.end.mock.calls[0] ? JSON.parse(res.end.mock.calls[0][0]) : undefined }
}
it('retires creation and starting-branch endpoints without mutations', async () => {
  for (const [method, path] of [['POST', '/codex-api/worktree/create'], ['GET', '/codex-api/worktree/branches']]) {
    expect((await request(method!, path!)).handled).toBe(false)
  }
  expect(persist).not.toHaveBeenCalled()
})
it('reads existing directory repository status', async () => {
  const status = () => request('GET', '/codex-api/git/repository-status?cwd=' + encodeURIComponent(repo))
  expect((await status()).body).toEqual({ data: { isGitRepo: false, gitRoot: '' } })
  await run('git', ['init'], { cwd: repo })
  expect((await status()).body).toEqual({ data: { isGitRepo: true, gitRoot: repo } })
})
