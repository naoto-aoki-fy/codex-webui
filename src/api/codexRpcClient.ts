import type { RpcEnvelope, RpcMethodCatalog } from '../types/codex'
import { CodexApiError, extractErrorMessage } from './codexErrors'

type RpcRequestBody = {
  method: string
  params?: unknown
}

export type RpcNotification = {
  method: string
  params: unknown
  atIso: string
}

type ServerRequestReplyBody = {
  id: number
  result?: unknown
  error?: {
    code?: number
    message: string
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function rpcCall<T>(method: string, params?: unknown): Promise<T> {
  const body: RpcRequestBody = { method, params: params ?? null }

  let response: Response
  try {
    response = await fetch('/codex-api/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : `RPC ${method} failed before request was sent`,
      { code: 'network_error', method },
    )
  }

  let payload: unknown = null
  let rawText: string | null = null
  try {
    rawText = await response.text()
    payload = JSON.parse(rawText)
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail = extractErrorMessage(payload, '') || rawText?.slice(0, 500) || ''
    const prefix = `RPC ${method} failed with HTTP ${response.status}`
    throw new CodexApiError(
      detail ? `${prefix}: ${detail}` : prefix,
      {
        code: 'http_error',
        method,
        status: response.status,
      },
    )
  }

  const envelope = payload as RpcEnvelope<T> | null
  if (!envelope || typeof envelope !== 'object' || !('result' in envelope)) {
    throw new CodexApiError(`RPC ${method} returned malformed envelope`, {
      code: 'invalid_response',
      method,
      status: response.status,
    })
  }
  return envelope.result
}

export async function fetchRpcMethodCatalog(): Promise<string[]> {
  const response = await fetch('/codex-api/meta/methods')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Method catalog failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'meta/methods',
        status: response.status,
      },
    )
  }

  const catalog = payload as RpcMethodCatalog
  return Array.isArray(catalog.data) ? catalog.data : []
}

function toNotification(value: unknown): RpcNotification | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.method !== 'string' || record.method.length === 0) return null

  const atIso = typeof record.atIso === 'string' && record.atIso.length > 0
    ? record.atIso
    : new Date().toISOString()

  return {
    method: record.method,
    params: record.params ?? null,
    atIso,
  }
}

function emitReadyNotification(
  onNotification: (value: RpcNotification) => void,
  params: unknown = { ok: true },
): void {
  onNotification({
    method: 'ready',
    params,
    atIso: new Date().toISOString(),
  })
}

export function subscribeRpcNotifications(onNotification: (value: RpcNotification) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  let cleanup: (() => void) | null = null
  let closed = false
  let offline = typeof navigator !== 'undefined' && navigator.onLine === false
  let interrupted = offline
  let useSse = typeof WebSocket === 'undefined'
  let reconnectTimer: number | null = null
  let recoveryTimer: number | null = null
  let wasHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'

  const detach = () => {
    const previous = cleanup
    cleanup = null
    previous?.()
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer === null) return
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const scheduleReconnect = (attach: () => void, attempt: number) => {
    if (closed || offline || reconnectTimer !== null || recoveryTimer !== null) return
    interrupted = true
    const delayMs = Math.min(1000 * (2 ** attempt), 10000)
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      if (closed || offline) return
      attach()
    }, delayMs)
  }

  const emitNotification = (notification: RpcNotification) => {
    // Even the first ready can follow an interruption while startup/history was loading.
    onNotification(notification.method === 'ready' && interrupted
      ? { ...notification, params: { ...asRecord(notification.params), reconnected: true } }
      : notification)
  }

  const handleNotificationPayload = (payload: unknown) => {
    const notification = toNotification(payload)
    if (notification) {
      emitNotification(notification)
    }
  }

  const attachSse = (attempt = 0) => {
    if (typeof EventSource === 'undefined' || closed || offline) return
    useSse = true
    detach()
    const source = new EventSource('/codex-api/events')
    let isConnectionClosed = false

    source.onmessage = (event) => {
      if (closed || isConnectionClosed) return
      try {
        handleNotificationPayload(JSON.parse(event.data) as unknown)
      } catch {
        // Ignore malformed event payloads and keep stream alive.
      }
    }

    source.addEventListener('ready', (event: MessageEvent<string>) => {
      if (closed || isConnectionClosed) return
      try {
        const parsed = event.data ? JSON.parse(event.data) as unknown : { ok: true }
        emitReadyNotification(emitNotification, parsed)
      } catch {
        emitReadyNotification(emitNotification)
      }
    })

    source.onerror = () => {
      if (closed || isConnectionClosed) return
      interrupted = true
      if (source.readyState === EventSource.CLOSED) {
        isConnectionClosed = true
        source.close()
        scheduleReconnect(() => attachSse(attempt + 1), attempt)
      }
    }

    cleanup = () => {
      if (isConnectionClosed) return
      isConnectionClosed = true
      source.close()
    }
  }

  const attachWebSocket = (attempt = 0) => {
    if (closed || offline) return
    if (typeof WebSocket === 'undefined') {
      attachSse()
      return
    }

    detach()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/codex-api/ws`)
    let didOpen = false
    let intentionallyClosed = false
    let fallbackTimer: number | null = window.setTimeout(() => {
      if (didOpen || closed || intentionallyClosed) return
      attachSse()
    }, 2500)

    socket.onopen = () => {
      if (closed || intentionallyClosed) return
      didOpen = true
      clearReconnectTimer()
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
    }

    socket.onmessage = (event) => {
      if (closed || intentionallyClosed) return
      try {
        handleNotificationPayload(JSON.parse(String(event.data)) as unknown)
      } catch {
        // Ignore malformed event payloads and keep stream alive.
      }
    }

    socket.onerror = () => {
      // Wait for close so we do not race duplicate reconnect/fallback paths.
    }

    socket.onclose = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      if (closed || intentionallyClosed) {
        return
      }
      if (!didOpen) {
        attachSse()
        return
      }
      scheduleReconnect(() => attachWebSocket(attempt + 1), attempt)
    }

    cleanup = () => {
      if (intentionallyClosed) return
      intentionallyClosed = true
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      socket.close()
    }
  }

  const attach = () => {
    if (useSse) attachSse()
    else attachWebSocket()
  }

  const clearRecoveryTimer = () => {
    if (recoveryTimer === null) return
    window.clearTimeout(recoveryTimer)
    recoveryTimer = null
  }

  // A suspended browser can retain a dead socket without receiving close/error.
  // Restart on lifecycle recovery and let the server's ready event reconcile the UI.
  const recover = () => {
    if (closed) return
    interrupted = true
    if (typeof navigator !== 'undefined') offline = navigator.onLine === false
    if (offline) return
    clearReconnectTimer()
    if (recoveryTimer !== null) return
    detach()
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null
      if (closed || offline) return
      attach()
    }, 100)
  }

  const onOffline = () => {
    offline = true
    interrupted = true
    clearReconnectTimer()
    clearRecoveryTimer()
    detach()
  }
  const onOnline = () => {
    offline = false
    recover()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      wasHidden = true
    } else if (document.visibilityState === 'visible' && wasHidden) {
      wasHidden = false
      recover()
    }
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) recover()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('pageshow', onPageShow)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('resume', recover)
  }
  attach()

  return () => {
    if (closed) return
    closed = true
    clearReconnectTimer()
    clearRecoveryTimer()
    detach()
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('pageshow', onPageShow)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('resume', recover)
    }
  }
}

export async function respondServerRequest(body: ServerRequestReplyBody): Promise<void> {
  let response: Response
  try {
    response = await fetch('/codex-api/server-requests/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : 'Failed to reply to server request',
      { code: 'network_error', method: 'server-requests/respond' },
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Server request reply failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'server-requests/respond',
        status: response.status,
      },
    )
  }
}

export async function fetchPendingServerRequests(): Promise<unknown[]> {
  const response = await fetch('/codex-api/server-requests/pending')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Pending server requests failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'server-requests/pending',
        status: response.status,
      },
    )
  }

  const record = asRecord(payload)
  const data = record?.data
  return Array.isArray(data) ? data : []
}
