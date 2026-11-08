import WebSocket from 'ws'
import { createConnection } from 'node:net'

export function resolveAppServerUrl(cli?: string, env = process.env.CODEXUI_APP_SERVER_URL): string {
  const value = cli ?? env ?? 'ws://127.0.0.1:4500'
  let url: URL
  try { url = new URL(value) } catch {
    throw new Error('Invalid app-server URL; use ws://, wss://, or unix:///absolute/path.sock')
  }
  if (url.protocol === 'unix:') {
    if (process.platform === 'win32') {
      throw new Error('Unix app-server sockets are unsupported on Windows; use ws:// or wss://')
    }
    let path: string
    try { path = decodeURIComponent(url.pathname) } catch {
      throw new Error('Invalid percent encoding in Unix app-server socket path')
    }
    if (!/^unix:\/\/\//i.test(value) || url.host || url.username || url.password ||
      value.includes('?') || value.includes('#') || !path.startsWith('/') ||
      path === '/' || path.endsWith('/') || /[\x00-\x1f\x7f\\]/.test(path) ||
      /[\x00-\x20\x7f\\]/.test(value)) {
      throw new Error('Unix app-server URL must use unix:///absolute/path.sock without host, query, fragment, or control characters')
    }
    return url.href
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.hash || url.username || url.password) {
    throw new Error('App-server URL must use ws://, wss://, or unix:///absolute/path.sock without credentials or a fragment')
  }
  return url.href
}

/** One shared handshake per connection; never replays an application request. */
export class AppServerWebSocketClient {
  private socket: WebSocket | null = null
  private ready: Promise<void> | null = null
  private reconnecting: Promise<void> | null = null
  private nextId = 1
  private disposed = false
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  constructor(private message: (frame: string) => void, private disconnected: () => void,
    private url = resolveAppServerUrl(), private timeoutMs = 10_000) {}

  private fail(socket: WebSocket, error: Error): void {
    if (this.socket !== socket) return
    this.socket = null
    this.ready = null
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
    this.disconnected()
    socket.terminate()
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('App-server client disposed'))
    if (this.ready) return this.ready
    const endpoint = resolveAppServerUrl(this.url)
    const unixPath = endpoint.startsWith('unix:') ? decodeURIComponent(new URL(endpoint).pathname) : null
    // ws performs its normal HTTP Upgrade and framing over this AF_UNIX stream.
    const socket = new WebSocket(unixPath ? 'ws://localhost/' : endpoint, {
      handshakeTimeout: this.timeoutMs,
      ...(unixPath ? { createConnection: () => createConnection({ path: unixPath }) } : {}),
    })
    this.socket = socket
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(socket, new Error(`App-server connection/initialization timed out: ${this.url}`)), this.timeoutMs)
      const id = this.nextId++
      this.pending.set(id, {
        resolve: () => { clearTimeout(timer); try { this.send({ method: 'initialized' }); resolve() } catch (error) { reject(error); this.fail(socket, error as Error) } },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      socket.on('open', () => this.send({ id, method: 'initialize', params: {
        clientInfo: { name: 'codex-web-local', version: '0.1.0' }, capabilities: { experimentalApi: true },
      } }))
      socket.on('message', (data, binary) => {
        if (this.socket !== socket) return
        if (binary) { this.fail(socket, new Error('Expected app-server text frame')); return }
        try {
          const frame = JSON.parse(data.toString())
          if (!frame.method && this.pending.has(frame.id)) {
            const request = this.pending.get(frame.id)!
            this.pending.delete(frame.id)
            if (frame.error) { request.reject(new Error(frame.error.message)); this.fail(socket, new Error('App-server initialization rejected')) }
            else request.resolve(frame.result)
          } else this.message(data.toString())
        } catch { this.fail(socket, new Error('Invalid app-server JSON frame')) }
      })
      socket.on('error', (error) => this.fail(socket, new Error(`Cannot connect to app-server ${this.url}: ${error.message}`)))
      socket.on('close', () => this.fail(socket, new Error(`App-server disconnected: ${this.url}. Retry the operation to reconnect; check whether the previous turn was accepted.`)))
    })
    return this.ready
  }

  send(payload: Record<string, unknown>): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('App-server is disconnected; retry to reconnect')
    socket.send(JSON.stringify(payload), (error) => { if (error) this.fail(socket, error) })
  }

  reconnect(): Promise<void> {
    if (this.reconnecting) return this.reconnecting
    if (this.socket) this.fail(this.socket, new Error('App-server connection reset'))
    this.reconnecting = this.connect().finally(() => { this.reconnecting = null })
    return this.reconnecting
  }

  dispose(): void {
    this.disposed = true
    if (this.socket) this.fail(this.socket, new Error('App-server client disposed'))
  }
}
