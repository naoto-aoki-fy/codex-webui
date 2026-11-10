import type { IncomingMessage, ServerResponse } from 'node:http'

type SubscribeNotifications = (
  listener: (value: { method: string; params: unknown; atIso: string }) => void,
) => () => void

// Request-local lifecycle only; the caller retains runtime and error handling ownership.
export function handleSseRequest(
  req: IncomingMessage,
  res: ServerResponse,
  subscribeNotifications: SubscribeNotifications,
): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const unsubscribe = subscribeNotifications((notification: { method: string; params: unknown; atIso: string }) => {
    if (res.writableEnded || res.destroyed) return
    res.write(`data: ${JSON.stringify(notification)}\n\n`)
  })

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n')
  }, 15000)

  const close = () => {
    clearInterval(keepAlive)
    unsubscribe()
    if (!res.writableEnded) {
      res.end()
    }
  }

  req.on('close', close)
  req.on('aborted', close)
}
