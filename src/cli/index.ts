import { getConnectionProfileId } from '../server/connectionProfile.js'
import { createCodexBridgeMiddleware } from '../server/codexAppServerBridge.js'
import { isAbsoluteLikePath } from '../pathUtils.js'
import { resolveAppServerUrl } from '../server/appServerWebSocketClient.js'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Command } from 'commander'
import { updateCodexGlobalState } from '../server/codexGlobalState.js'
import { createServer as createApp } from '../server/httpServer.js'

const program = new Command().name('codexui').description('Web interface for Codex app-server')
const __dirname = dirname(fileURLToPath(import.meta.url))
async function readCliVersion(): Promise<string> {
  try {
    const packageJsonPath = join(__dirname, '..', 'package.json')
    const raw = await readFile(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? { cmd: 'open', args: [url] }
    : process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
      : { cmd: 'xdg-open', args: [url] }

  const child = spawn(command.cmd, command.args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function getAccessibleUrls(port: number): string[] {
  const urls = new Set<string>([`http://localhost:${String(port)}`])
  try {
    const interfaces = networkInterfaces()
    for (const entries of Object.values(interfaces)) {
      if (!entries) {
        continue
      }
      for (const entry of entries) {
        if (entry.internal) {
          continue
        }
        if (entry.family === 'IPv4') {
          urls.add(`http://${entry.address}:${String(port)}`)
        }
      }
    }
  } catch {}
  return Array.from(urls)
}

function listenWithFallback(server: ReturnType<typeof createServer>, startPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          attempt(port + 1)
          return
        }
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(port)
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    }

    attempt(startPort)
  })
}

function normalizeUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const next: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || next.includes(trimmed)) continue
    next.push(trimmed)
  }
  return next
}

async function persistLaunchProject(projectPath: string): Promise<void> {
  const trimmed = projectPath.trim()
  if (!trimmed) return
  if (!isAbsoluteLikePath(trimmed)) throw new Error('Use an absolute project path on the App Server host')
  const normalizedPath = trimmed
  const bridge = createCodexBridgeMiddleware()
  try {
    const info = await bridge.files.getMetadata(normalizedPath)
    if (!info.isDirectory) throw new Error(`Not a remote directory: ${normalizedPath}`)
  } finally { bridge.dispose() }

  await updateCodexGlobalState((payload) => {
    for (const key of ['electron-saved-workspace-roots', 'active-workspace-roots', 'project-order']) {
      const values = normalizeUniqueStrings(payload[key])
      payload[key] = [normalizedPath, ...values.filter((value) => value !== normalizedPath)]
    }
  })
}

async function addProjectOnly(projectPath: string): Promise<void> {
  const trimmed = projectPath.trim()
  if (!trimmed) {
    throw new Error('Missing project path')
  }
  await persistLaunchProject(trimmed)
}

async function startServer(options: {
  connectionProfile?: string
  appServerUrl?: string
  host: string
  port: string
  password: string | boolean
  open: boolean
  projectPath?: string
}) {
  if (options.connectionProfile) process.env.CODEXUI_CONNECTION_PROFILE = options.connectionProfile
  getConnectionProfileId()
  process.env.CODEXUI_APP_SERVER_URL = resolveAppServerUrl(options.appServerUrl)
  const version = await readCliVersion()
  const password = typeof options.password === 'string' ? options.password : undefined
  const { app, dispose, attachWebSocket } = createApp({ password })
  const projectPath = options.projectPath?.trim() ?? ''
  if (projectPath.length > 0) {
    try {
      await persistLaunchProject(projectPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`\n[project] Could not open launch project: ${message}\n`)
    }
  }
  const requestedPort = parseInt(options.port, 10)
  const server = createServer(app)
  attachWebSocket(server)
  const port = await listenWithFallback(server, requestedPort, options.host)
  const lines = [
    '',
    'Codex Web Local is running!',
    `  Version:  ${version}`,
    '',
    `  Bind:     http://${options.host}:${String(port)}`,
    `  App-server: ${process.env.CODEXUI_APP_SERVER_URL}`,
    '  Runtime configuration and authentication: managed externally',
  ]
  const accessUrls = ['127.0.0.1', '::1', 'localhost'].includes(options.host) ? [`http://${options.host === '::1' ? '[::1]' : options.host}:${port}`] : getAccessibleUrls(port)
  if (accessUrls.length > 0) {
    lines.push(`  Local:    ${accessUrls[0]}`)
    for (const accessUrl of accessUrls.slice(1)) {
      lines.push(`  Network:  ${accessUrl}`)
    }
  }

  if (port !== requestedPort) {
    lines.push(`  Requested port ${String(requestedPort)} was unavailable; using ${String(port)}.`)
  }

  lines.push('')
  console.log(lines.join('\n'))
  if (options.open) openBrowser(`http://localhost:${String(port)}`)

  function shutdown() {
    console.log('\nShutting down...')
    server.close(() => {
      dispose()
      process.exit(0)
    })
    // Force exit after timeout
    setTimeout(() => {
      dispose()
      process.exit(1)
    }, 5000).unref()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function runLogin(): Promise<void> {
  throw new Error('Manage authentication in the independently running Codex app-server (codex login), then reconnect the web application.')
}

program
  .argument('[projectPath]', 'project directory to open on launch')
  .option('--open-project <path>', 'open project directory on launch (Codex desktop parity)')
  .option('--host <address>', 'HTTP bind address (use 127.0.0.1 for loopback)', '0.0.0.0')
  .option('-p, --port <port>', 'port to listen on', '5900')
  .option('--password <pass>', 'enable password protection with a specific password', false)
  .option('--no-password', 'disable password protection (default)')
  .option('--open', 'open browser on startup', true)
  .option('--no-open', 'do not open browser on startup')
  .option('--connection-profile <id>', 'stable remote machine identity (env CODEXUI_CONNECTION_PROFILE; default legacy)')
  .option('--app-server-url <url>', 'external Codex app-server URL (ws://, wss://, unix:///path.sock)')
  .action(async (
    projectPath: string | undefined,
    opts: {
      connectionProfile?: string
      appServerUrl?: string
      host: string
      port: string
      password: string | boolean
      open: boolean
      openProject?: string
    },
  ) => {
    if (opts.connectionProfile) process.env.CODEXUI_CONNECTION_PROFILE = opts.connectionProfile
    getConnectionProfileId()
    const rawArgv = process.argv.slice(2)
    const openProjectFlagIndex = rawArgv.findIndex((arg) => arg === '--open-project' || arg.startsWith('--open-project='))

    let openProjectOnly = (opts.openProject ?? '').trim()
    if (!openProjectOnly && openProjectFlagIndex >= 0 && projectPath?.trim()) {
      // Commander may map "--open-project ." to the positional arg in this command layout.
      openProjectOnly = projectPath.trim()
    }
    if (openProjectOnly.length > 0) {
      process.env.CODEXUI_APP_SERVER_URL = resolveAppServerUrl(opts.appServerUrl)
      await addProjectOnly(openProjectOnly)
      console.log(`Added project: ${openProjectOnly}`)
      return
    }

    const launchProject = (projectPath ?? '').trim()
    await startServer({ ...opts, projectPath: launchProject })
  })

program.command('login').description('Explain external server authentication').action(runLogin)

program.command('help').description('Show codexui command help').action(() => {
  program.outputHelp()
})

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\nFailed to run codexui: ${message}`)
  process.exit(1)
})
