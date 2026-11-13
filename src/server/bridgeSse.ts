import { getConnectionProfileId } from './connectionProfile.js'
import { backendInstanceId } from './backendInstance.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

type SubscribeNotifications = (
  listener: (value: { method: string; params: unknown; atIso: string }) => void,
) => () => void

// The caller owns registration and runtime release; each request owns its resources.
export function handleSseRequest(
  req: IncomingMessage,
  res: ServerResponse,
  subscribeNotifications: SubscribeNotifications,
  register: (dispose: () => void) => void,
  unregister: (dispose: () => void) => void,
): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  let cleaned = false
  let unsubscribe: (() => void) | undefined
  let keepAlive: ReturnType<typeof setInterval> | undefined

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    req.removeListener('close', close)
    req.removeListener('aborted', close)
    if (keepAlive !== undefined) clearInterval(keepAlive)
    unregister(close)
    unsubscribe?.()
  }
  const close = () => {
    if (cleaned) return
    try {
      cleanup()
    } finally {
      if (!res.writableEnded) res.end()
    }
  }

  try {
    unsubscribe = subscribeNotifications((notification: { method: string; params: unknown; atIso: string }) => {
      if (cleaned || res.writableEnded || res.destroyed) return
      res.write(`data: ${JSON.stringify(notification)}\n\n`)
    })

    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, backendInstanceId, connectionProfile: getConnectionProfileId() })}\n\n`)
    keepAlive = setInterval(() => {
      res.write(': ping\n\n')
    }, 15000)

    req.on('close', close)
    req.on('aborted', close)
    if (!cleaned) register(close)
  } catch (error) {
    // Release partial setup without ending the response: the caller handles errors.
    try {
      cleanup()
    } finally {
      throw error
    }
  }
}
