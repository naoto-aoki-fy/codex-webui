import { randomBytes } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { runCommand, runCommandCapture } from './bridgeCommands.js'
import { asRecord, getErrorMessage, setJson } from './bridgeHttpUtils.js'

type GitWorkspaceRouteContext = {
  readJsonBody: (req: IncomingMessage) => Promise<unknown>
  getCodexHomeDir: () => string
  persistWorkspaceRoot: (path: string, label?: string) => Promise<void>
  ensureRealDirectory: (path: string, label: string) => Promise<void>
}

// Storage and shared path validation remain owned by the bridge.
export function createGitWorkspaceRoutes(context: GitWorkspaceRouteContext) {
  const { readJsonBody, getCodexHomeDir, persistWorkspaceRoot, ensureRealDirectory } = context

  function normalizeGithubCloneUrl(rawUrl: string): { url: string; repoName: string } {
    const trimmedUrl = rawUrl.trim()
    if (!trimmedUrl) throw new Error('Missing GitHub repository URL')

    const sshMatch = trimmedUrl.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u)
    if (sshMatch) {
      const repoName = sshMatch[2]
      return { url: `git@github.com:${sshMatch[1]}/${repoName}.git`, repoName }
    }

    let parsed: URL
    try {
      parsed = new URL(trimmedUrl)
    } catch {
      throw new Error('Enter a valid GitHub repository URL')
    }
    if (parsed.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Only github.com repository URLs are supported')
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length < 2) {
      throw new Error('Enter a GitHub repository URL with owner and repository name')
    }
    const owner = segments[0]
    const repoName = segments[1].replace(/\.git$/iu, '')
    if (!/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repoName)) {
      throw new Error('GitHub repository owner or name contains unsupported characters')
    }
    return { url: `https://github.com/${owner}/${repoName}.git`, repoName }
  }

  async function cloneGithubRepositoryIntoBase(rawUrl: string, rawBasePath: string): Promise<string> {
    const basePath = rawBasePath.trim()
    if (!basePath) throw new Error('Missing clone destination folder')
    const normalizedBasePath = isAbsolute(basePath) ? basePath : resolve(basePath)
    await ensureRealDirectory(normalizedBasePath, 'Clone destination folder')

    const { url, repoName } = normalizeGithubCloneUrl(rawUrl)
    const targetPath = join(normalizedBasePath, repoName)
    try {
      await stat(targetPath)
      throw new Error(`Destination already exists: ${targetPath}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    }

    try {
      await runCommand('git', ['clone', url, targetPath], { cwd: normalizedBasePath, timeoutMs: 5 * 60_000 })
    } catch (error) {
      await rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    await persistWorkspaceRoot(targetPath, '')
    return targetPath
  }

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
      await rm(worktreeCwd, { recursive: true, force: true }).catch(() => undefined)
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

      const sourceCwd = isAbsolute(rawSourceCwd) ? rawSourceCwd : resolve(rawSourceCwd)
      try {
        const sourceInfo = await stat(sourceCwd)
        if (!sourceInfo.isDirectory()) {
          setJson(res, 400, { error: 'sourceCwd is not a directory' })
          return true
        }
      } catch {
        setJson(res, 404, { error: 'sourceCwd does not exist' })
        return true
      }

      try {
        const gitRoot = await runCommandCapture('git', ['rev-parse', '--show-toplevel'], { cwd: sourceCwd })
        // Validate before allocating any directories. Never initialize or commit for the user.
        await runCommandCapture('git', ['rev-parse', '--verify', baseBranch || 'HEAD'], { cwd: gitRoot })
        const repoName = basename(gitRoot) || 'repo'
        const worktreesRoot = join(getCodexHomeDir(), 'worktrees')
        await mkdir(worktreesRoot, { recursive: true })

        // Match Codex desktop layout so project grouping resolves to repo name:
        // ~/.codex/worktrees/<id>/<repoName>
        let worktreeId = ''
        let worktreeParent = ''
        let worktreeCwd = ''
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const candidate = randomBytes(2).toString('hex')
          const parent = join(worktreesRoot, candidate)
          try {
            await stat(parent)
            continue
          } catch {
            worktreeId = candidate
            worktreeParent = parent
            worktreeCwd = join(parent, repoName)
            break
          }
        }
        if (!worktreeId || !worktreeParent || !worktreeCwd) {
          throw new Error('Failed to allocate a unique worktree id')
        }
        const startPoint = baseBranch || 'HEAD'

        await mkdir(worktreeParent, { recursive: true })
        try {
          await runCommand('git', ['worktree', 'add', '--detach', worktreeCwd, startPoint], { cwd: gitRoot })
        } catch (error) {
          await rm(worktreeParent, { recursive: true, force: true })
          throw error
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
      const sourceCwd = isAbsolute(rawSourceCwd) ? rawSourceCwd : resolve(rawSourceCwd)
      try {
        const sourceInfo = await stat(sourceCwd)
        if (!sourceInfo.isDirectory()) {
          setJson(res, 400, { error: 'sourceCwd is not a directory' })
          return true
        }
      } catch {
        setJson(res, 404, { error: 'sourceCwd does not exist' })
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
      const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(rawCwd)
      try {
        const cwdInfo = await stat(cwd)
        if (!cwdInfo.isDirectory()) {
          setJson(res, 400, { error: 'cwd is not a directory' })
          return true
        }
      } catch {
        setJson(res, 404, { error: 'cwd does not exist' })
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

  async function handleCloneRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method === 'POST' && url.pathname === '/codex-api/github-clone') {
      const payload = asRecord(await readJsonBody(req))
      const repoUrl = typeof payload?.url === 'string' ? payload.url.trim() : ''
      const basePath = typeof payload?.basePath === 'string' ? payload.basePath.trim() : ''
      try {
        const clonedPath = await cloneGithubRepositoryIntoBase(repoUrl, basePath)
        setJson(res, 200, { data: { path: clonedPath } })
      } catch (error) {
        setJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to clone GitHub repository' })
      }
      return true
    }

    return false
  }

  return { handleWorktreeRoutes, handleCloneRoutes }
}
