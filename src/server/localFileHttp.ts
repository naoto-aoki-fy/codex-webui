import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, extname } from 'node:path'
import { stat, writeFile } from 'node:fs/promises'
import express from 'express'
import { createDirectoryListingHtml, createTextEditorHtml, getLocalDirectoryListing, isTextEditableFile, normalizeLocalPath } from './localBrowseUi.js'

export const LOCAL_EDIT_BODY_LIMIT = 10 * 1024 * 1024
const imageTypes: Record<string, string> = {
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.gif': 'image/gif',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
}

class RequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// Absolute local paths are intentional. Reject ambiguous encodings and traversal,
// without introducing a workspace sandbox or changing dotfile/symlink access.
function validatePath(value: string, directory: boolean): string {
  if (!value || !isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/u).includes('..')) {
    throw new RequestError(400, `Expected absolute local ${directory ? 'directory' : 'file'} path.`)
  }
  return value
}

async function readEditBody(req: IncomingMessage): Promise<string> {
  if (Number(req.headers['content-length']) > LOCAL_EDIT_BODY_LIMIT) {
    req.resume()
    throw new RequestError(413, 'Request body too large.')
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    req.resume()
    throw new RequestError(415, 'Unsupported content encoding.')
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
    }
    const onError = () => { cleanup(); reject(new RequestError(500, 'Write failed.')) }
    const onAborted = () => { cleanup(); reject(new RequestError(400, 'Request aborted.')) }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, size).toString('utf8')) }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > LOCAL_EDIT_BODY_LIMIT) {
        cleanup()
        req.resume()
        reject(new RequestError(413, 'Request body too large.'))
      } else chunks.push(chunk)
    }
    req.on('data', onData).once('end', onEnd).once('error', onError).once('aborted', onAborted)
  })
}

/** Connect and Express both accept this Node HTTP middleware directly. */
export function createLocalFileMiddleware() {
  // Reuse the existing transfer implementation for MIME types, HEAD and ranges.
  const serveFile = express.static('/', { dotfiles: 'allow', index: false, redirect: false, cacheControl: false })
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
    const rawUrl = req.url ?? ''
    const pathname = rawUrl.split('?')[0] ?? ''
    const kind = pathname === '/codex-local-image' ? 'image'
      : pathname === '/codex-local-directories' ? 'directories'
      : pathname.startsWith('/codex-local-browse/') ? 'browse'
      : pathname.startsWith('/codex-local-edit/') ? 'edit' : null
    if (!kind || !(['GET', 'HEAD'].includes(req.method ?? '') || (kind === 'edit' && req.method === 'PUT'))) return next()
    const send = (status: number, body: string, type = 'application/json; charset=utf-8') => {
      if (res.destroyed || res.writableEnded) return
      res.statusCode = status
      res.setHeader('Content-Type', type)
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    const json = (status: number, value: unknown) => send(status, JSON.stringify(value))
    void (async () => {
      let localPath: string
      const query = new URLSearchParams(rawUrl.slice(pathname.length))
      try {
        localPath = kind === 'image' || kind === 'directories'
          ? normalizeLocalPath(query.get('path') ?? '')
          : decodeURIComponent(pathname.slice(`/codex-local-${kind}`.length))
      } catch { throw new RequestError(400, 'Expected absolute local file path.') }
      validatePath(localPath, kind === 'directories')
      if (kind === 'image' && !imageTypes[extname(localPath).toLowerCase()]) throw new RequestError(415, 'Unsupported image type.')
      const info = await stat(localPath)
      if (kind === 'directories') {
        if (!info.isDirectory()) throw new RequestError(400, 'Expected directory path.')
        const showHidden = ['1', 'true', 'yes', 'on'].includes((query.get('showHidden') ?? '').toLowerCase())
        json(200, { data: await getLocalDirectoryListing(localPath, { showHidden }) })
      } else if (kind === 'edit') {
        if (!info.isFile()) throw new RequestError(400, 'Expected file path.')
        if (req.method === 'PUT') {
          if (!(await isTextEditableFile(localPath))) throw new RequestError(415, 'Only text-like files are editable.')
          const body = await readEditBody(req)
          await writeFile(localPath, body, 'utf8')
          json(200, { ok: true })
        } else send(200, await createTextEditorHtml(localPath), 'text/html; charset=utf-8')
      } else {
        res.setHeader('Cache-Control', kind === 'image' ? 'private, max-age=300' : 'private, no-store')
        if (kind === 'browse' && info.isDirectory()) {
          send(200, await createDirectoryListingHtml(localPath, { newProjectName: query.get('newProjectName') ?? '' }), 'text/html; charset=utf-8')
          return
        }
        if (!info.isFile()) throw new Error('Not a regular file')
        if (kind === 'image') res.setHeader('Content-Type', imageTypes[extname(localPath).toLowerCase()]!)
        req.url = localPath.split('/').map(encodeURIComponent).join('/')
        const restore = () => { req.url = rawUrl }
        res.once('finish', restore)
        res.once('close', restore)
        serveFile(req as express.Request, res as express.Response, (error?: unknown) => {
          restore()
          if (res.headersSent) { res.destroy(); return }
          const status = (error as { status?: number } | undefined)?.status
          json(status === 416 ? 416 : 404, { error: kind === 'image' ? 'Image file not found.' : 'File not found.' })
        })
      }
    })().catch((error: unknown) => {
      if (req.method === 'PUT') req.resume()
      if (res.headersSent) { res.destroy(); return }
      json(error instanceof RequestError ? error.status : 404, {
        error: error instanceof RequestError ? error.message
          : kind === 'directories' ? 'Directory not found.' : kind === 'image' ? 'Image file not found.' : 'File not found.',
      })
    })
  }
}
