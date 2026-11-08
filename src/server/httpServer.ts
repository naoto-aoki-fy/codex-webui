import { precompressedStatic, sendPrecompressed } from './precompressedStatic.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Server as HttpServer } from 'node:http'
import { existsSync } from 'node:fs'
import express, { type Express } from 'express'
import { createCodexBridgeMiddleware } from './codexAppServerBridge.js'
import { createAuthSession } from './authMiddleware.js'
import { createLocalFileMiddleware } from './localFileHttp.js'
import { attachBrowserNotificationTransport } from './browserNotificationTransport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const spaEntryFile = join(distDir, 'index.html')

export type ServerOptions = {
  password?: string
}

export type ServerInstance = {
  app: Express
  dispose: () => void
  attachWebSocket: (server: HttpServer) => void
}

function renderFrontendMissingHtml(message: string, details?: string[]): string {
  const lines = details && details.length > 0 ? `<pre>${details.join('\n')}</pre>` : ''
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Codex Web UI Error</title></head>',
    '<body>',
    `<h1>${message}</h1>`,
    lines,
    '<p>Redirecting to chat in 3 seconds...</p>',
    '<p><a href="/">Back to chat</a></p>',
    '<script>',
    'setTimeout(() => { window.location.assign("/") }, 3000)',
    '</script>',
    '</body>',
    '</html>',
  ].join('')
}

export function createServer(options: ServerOptions = {}): ServerInstance {
  const app = express()
  const bridge = createCodexBridgeMiddleware()
  const authSession = options.password ? createAuthSession(options.password) : null

  // 1. Auth middleware (if password is set)
  if (authSession) {
    app.use(authSession.middleware)
  }

  // 2. Bridge middleware for /codex-api/*
  app.use(bridge)

  app.use(createLocalFileMiddleware())

  const hasFrontendAssets = existsSync(spaEntryFile)

  // 7. Static files from Vue build
  if (hasFrontendAssets) {
    app.use(precompressedStatic(distDir))
  }

  // 8. SPA fallback
  app.use((req, res, next) => {
    if (!hasFrontendAssets) {
      res
        .status(503)
        .type('text/html; charset=utf-8')
        .send(
          renderFrontendMissingHtml('Codex web UI assets are missing.', [
            `Expected: ${spaEntryFile}`,
            'If running from source, build frontend assets with: pnpm run build:frontend',
            'If running with npx, clear the npx cache and reinstall codexapp.',
          ]),
        )
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    return sendPrecompressed(req, res, next, spaEntryFile)
  })

  const transports = new Set<() => void>()
  return {
    app,
    dispose: () => {
      for (const dispose of transports) dispose()
      transports.clear()
      bridge.dispose()
    },
    attachWebSocket: (server: HttpServer) => {
      transports.add(attachBrowserNotificationTransport(
        server,
        bridge.subscribeNotifications,
        authSession ? (req) => authSession.isRequestAuthorized(req) : undefined,
      ))
    },
  }
}
