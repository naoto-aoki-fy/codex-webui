import type { CommandExecParams } from './protocol/0.167.2/v2/CommandExecParams.js'
import type { CommandExecResponse } from './protocol/0.167.2/v2/CommandExecResponse.js'
import { ProjectFileService, projectPath } from './appServerFileSystem.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppServerClient } from './appServerClient.js'
import { getErrorMessage, setJson } from './bridgeHttpUtils.js'

type GitWorkspaceRouteContext = {
  appServer?: Pick<AppServerClient, 'rpc'>
}

// Storage and shared path validation remain owned by the bridge.
export function createGitWorkspaceRoutes(context: GitWorkspaceRouteContext) {

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
  const runCommandCapture = async (command: string, args: string[], options: { cwd: string }) => {
    const result = await rpc('command/exec', { command: [command, ...args], cwd: options.cwd, outputBytesCap: 1024 * 1024 } satisfies CommandExecParams) as CommandExecResponse
    if (result.exitCode !== 0) throw new Error(result.stderr || `Remote ${command} exited ${result.exitCode}`)
    return result.stdout.trim()
  }

  function isNotGitRepositoryError(error: unknown): boolean {
    const message = getErrorMessage(error, '').toLowerCase()
    return message.includes('not a git repository') || message.includes('fatal: not a git repository')
  }


  async function handleWorktreeRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
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
