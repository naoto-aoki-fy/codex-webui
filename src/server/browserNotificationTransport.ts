import type { IncomingMessage } from 'node:http'
import type { EventEmitter } from 'node:events'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

type Notification = { method: string; params: unknown; atIso: string }
type Subscribe = (listener: (notification: Notification) => void) => () => void

/** One bridge subscription per browser, retired once on error, close or disposal. */
export function connectBrowserNotifications(ws: WebSocket, subscribe: Subscribe): () => void {
  ws.send(JSON.stringify({ method: 'ready', params: { ok: true }, atIso: new Date().toISOString() }))
  let unsubscribe: (() => void) | undefined = subscribe((notification) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(notification))
  })
  const cleanup = () => {
    const release = unsubscribe
    unsubscribe = undefined
    release?.()
  }
  // Keep an error listener until close, including after explicit disposal.
  ws.on('error', cleanup)
  ws.once('close', () => {
    cleanup()
    ws.off('error', cleanup)
  })
  return cleanup
}

/** Leaves other upgrade endpoints (including Vite HMR) to their existing owners. */
export function attachBrowserNotificationTransport(
  server: Pick<EventEmitter, 'on' | 'once' | 'off'>,
  subscribe: Subscribe,
  isAuthorized?: (req: IncomingMessage) => boolean,
): () => void {
  const wss = new WebSocketServer({ noServer: true })
  const connections = new Set<() => void>()
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== '/codex-api/ws') return
    if (isAuthorized && !isAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }
  wss.on('connection', (ws) => {
    const cleanup = connectBrowserNotifications(ws, subscribe)
    const retire = () => { cleanup(); connections.delete(retire) }
    connections.add(retire)
    ws.once('close', retire)
    ws.once('error', retire)
  })
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    server.off('upgrade', upgrade)
    server.off('close', dispose)
    for (const cleanup of connections) cleanup()
    wss.close()
  }
  server.on('upgrade', upgrade)
  server.once('close', dispose)
  return dispose
}
