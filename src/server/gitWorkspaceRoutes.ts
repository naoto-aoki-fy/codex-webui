import type { CommandExecParams } from './protocol/0.167.2/v2/CommandExecParams.js'
import type { CommandExecResponse } from './protocol/0.167.2/v2/CommandExecResponse.js'
import { randomUUID } from 'node:crypto'
import { ProjectFileService, projectPath } from './appServerFileSystem.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppServerClient } from './appServerClient.js'
import { asRecord, getErrorMessage, setJson } from './bridgeHttpUtils.js'

type GitWorkspaceRouteContext = {
  appServer?: Pick<AppServerClient, 'rpc' | 'getInitializationMetadata'>
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  getCodexHomeDir: () => string
  persistWorkspaceRoot: (path: string, label?: string) => Promise<void>
}

// Storage and shared path validation remain owned by the bridge.
export function createGitWorkspaceRoutes(context: GitWorkspaceRouteContext) {
  const { readJsonBody, persistWorkspaceRoot } = context

  const remote = context.appServer
  const rpc = async (method: string, params: unknown) => {
    if (!remote) throw new Error('Remote project operations require App Server command/exec and filesystem capabilities')
    try { return await remote.rpc(method, params) } catch (error) {
      if ((error as { code?: number }).code === -32601) throw new Error(`Connected App Server does not support ${method}; this operation is unavailable`)
      throw error
    }
  }
  const files = new ProjectFileService({ rpc })
  const stat = async (path: string) => {
    const metadata = await files.getMetadata(path)
    return { isDirectory: () => metadata.isDirectory }
  }
  const mkdir = async (path: string, _options: unknown) => rpc('fs/createDirectory', { path, recursive: true })
  const rm = async (path: string, _options: unknown) => rpc('fs/remove', { path, recursive: true, force: true })
  const runCommandCapture = async (command: string, args: string[], options: { cwd: string }) => {
    const result = await rpc('command/exec', { command: [command, ...args], cwd: options.cwd, outputBytesCap: 1024 * 1024 } satisfies CommandExecParams) as CommandExecResponse
    if (result.exitCode !== 0) throw new Error(result.stderr || `Remote ${command} exited ${result.exitCode}`)
    return result.stdout.trim()
  }
  const runCommand = runCommandCapture

  function isNotGitRepositoryError(error: unknown): boolean {
    const message = getErrorMessage(error, '').toLowerCase()
    return message.includes('not a git repository') || message.includes('fatal: not a git repository')
  }

  function normalizeBranchRefName(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('refs/heads/')) return trimmed.slice('refs/heads/'.length)
    if (trimmed.startsWith('refs/remotes/')) return trimmed.slice('refs/remotes/'.length)
    return trimmed
  }

  async function rollbackCreatedWorktree(
    gitRoot: string,
    worktreeCwd: string,
    cleanupDirectory?: string,
  ): Promise<void> {
    try {
      await runCommand('git', ['worktree', 'remove', '--force', worktreeCwd], { cwd: gitRoot })
    } catch {
      return // Unknown remote outcome: retain files for manual reconciliation.
    }

    if (cleanupDirectory && cleanupDirectory !== worktreeCwd) {
      await rm(cleanupDirectory, { recursive: true, force: true }).catch(() => undefined)
    }

  }

  async function handleWorktreeRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method === 'POST' && url.pathname === '/codex-api/worktree/create') {
      const payload = asRecord(await readJsonBody(req))
      const rawSourceCwd = typeof payload?.sourceCwd === 'string' ? payload.sourceCwd.trim() : ''
      const baseBranch = typeof payload?.baseBranch === 'string' ? payload.baseBranch.trim() : ''
      if (!rawSourceCwd) {
        setJson(res, 400, { error: 'Missing sourceCwd' })
        return true
      }

      const sourceCwd = rawSourceCwd
      if (!projectPath(sourceCwd).isAbsolute(sourceCwd)) { setJson(res, 400, { error: 'Expected absolute remote sourceCwd' }); return true }
      try {
        const sourceInfo = await stat(sourceCwd)
        if (!sourceInfo.isDirectory()) {
          setJson(res, 400, { error: 'sourceCwd is not a directory' })
          return true
        }
      } catch (error) {
        setJson(res, 502, { error: getErrorMessage(error, 'Remote sourceCwd validation failed') })
        return true
      }

      try {
        const gitRoot = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
        // Validate before allocating any directories. Never initialize or commit for the user.
        await runCommandCapture('git', ['rev-parse', '--verify', '--end-of-options', baseBranch || 'HEAD'], { cwd: gitRoot })
        const repoName = projectPath(gitRoot).basename(gitRoot) || 'repo'
        const remoteHome = remote?.getInitializationMetadata()?.codexHome
        if (!remoteHome) throw new Error('Remote CODEX_HOME metadata unavailable; worktree creation is unsupported')
        const join = projectPath(gitRoot).join
        const worktreesRoot = join(remoteHome, 'worktrees')
        await mkdir(worktreesRoot, { recursive: true })

        // Match Codex desktop layout so project grouping resolves to repo name:
        // ~/.codex/worktrees/<id>/<repoName>
        const worktreeParent = join(worktreesRoot, randomUUID())
        const worktreeCwd = join(worktreeParent, repoName)
        const startPoint = baseBranch || 'HEAD'

        await mkdir(worktreeParent, { recursive: true })
        try {
          await runCommand('git', ['worktree', 'add', '--detach', worktreeCwd, startPoint], { cwd: gitRoot })
        } catch (error) {
          throw error // Do not remove files after an ambiguous command result.
        }
        try {
          await persistWorkspaceRoot(worktreeCwd)
        } catch (error) {
          await rollbackCreatedWorktree(gitRoot, worktreeCwd, worktreeParent)
          throw error
        }

        setJson(res, 200, {
          data: {
            cwd: worktreeCwd,
            branch: null,
            gitRoot,
          },
        })
      } catch (error) {
        setJson(res, 500, { error: getErrorMessage(error, 'Failed to create worktree') })
      }
      return true
    }

    if (req.method === 'GET' && url.pathname === '/codex-api/worktree/branches') {
      const rawSourceCwd = (url.searchParams.get('sourceCwd') ?? '').trim()
      if (!rawSourceCwd) {
        setJson(res, 400, { error: 'Missing sourceCwd' })
        return true
      }
      const sourceCwd = rawSourceCwd
      if (!projectPath(sourceCwd).isAbsolute(sourceCwd)) { setJson(res, 400, { error: 'Expected absolute remote sourceCwd' }); return true }
      try {
        const sourceInfo = await stat(sourceCwd)
        if (!sourceInfo.isDirectory()) {
          setJson(res, 400, { error: 'sourceCwd is not a directory' })
          return true
        }
      } catch (error) {
        setJson(res, 502, { error: getErrorMessage(error, 'Remote sourceCwd validation failed') })
        return true
      }

      try {
        let gitRoot = ''
        try {
          gitRoot = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
        } catch (error) {
          if (!isNotGitRepositoryError(error)) throw error
          setJson(res, 200, { data: [] })
          return true
        }
        const output = await runCommandCapture(
          'git',
          ['for-each-ref', '--format=%(committerdate:unix)\t%(refname)', 'refs/heads', 'refs/remotes'],
          { cwd: gitRoot },
        )
        const branchActivityByName = new Map<string, number>()
        for (const line of output.split('\n')) {
          const [rawTimestamp = '', rawRefName = ''] = line.split('\t')
          const normalized = normalizeBranchRefName(rawRefName)
          if (!normalized || normalized === 'origin/HEAD') continue
          const parsedTimestamp = Number.parseInt(rawTimestamp.trim(), 10)
          const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0
          const current = branchActivityByName.get(normalized) ?? Number.MIN_SAFE_INTEGER
          if (timestamp > current) {
            branchActivityByName.set(normalized, timestamp)
          }
        }

        const branches = Array.from(branchActivityByName.entries())
          .map(([value]) => ({ value, label: value }))
          .sort((a, b) => {
            const aActivity = branchActivityByName.get(a.value) ?? 0
            const bActivity = branchActivityByName.get(b.value) ?? 0
            if (bActivity !== aActivity) return bActivity - aActivity
            return a.value.localeCompare(b.value)
          })
        setJson(res, 200, { data: branches })
      } catch (error) {
        setJson(res, 500, { error: getErrorMessage(error, 'Failed to list branches') })
      }
      return true
    }

    if (req.method === 'GET' && url.pathname === '/codex-api/git/repository-status') {
      const rawCwd = (url.searchParams.get('cwd') ?? '').trim()
      if (!rawCwd) {
        setJson(res, 400, { error: 'Missing cwd' })
        return true
      }
      const cwd = rawCwd
      if (!projectPath(cwd).isAbsolute(cwd)) { setJson(res, 400, { error: 'Expected absolute remote cwd' }); return true }
      try {
        const cwdInfo = await stat(cwd)
        if (!cwdInfo.isDirectory()) {
          setJson(res, 400, { error: 'cwd is not a directory' })
          return true
        }
      } catch (error) {
        setJson(res, 502, { error: getErrorMessage(error, 'Remote cwd validation failed') })
        return true
      }

      try {
        const gitRoot = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd })
        setJson(res, 200, {
          data: {
            isGitRepo: true,
            gitRoot,
          },
        })
      } catch (error) {
        if (!isNotGitRepositoryError(error)) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to read Git repository status') })
          return true
        }
        setJson(res, 200, {
          data: {
            isGitRepo: false,
            gitRoot: '',
          },
        })
      }
      return true
    }

    return false
  }

  return { handleWorktreeRoutes }
}
