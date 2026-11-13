import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inlineAssetPath } from './appAssets.js'
import { projectPath, type ProjectFileService } from './appServerFileSystem.js'
import mime from 'mime-types'
import { getLocalDirectoryListing, normalizeLocalPath } from './localBrowseUi.js'

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
  if (!value || !projectPath(value).isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/u).includes('..')) {
    throw new RequestError(400, `Expected absolute local ${directory ? 'directory' : 'file'} path.`)
  }
  return value
}

/** Connect and Express both accept this Node HTTP middleware directly. */
export function createLocalFileMiddleware(files: ProjectFileService) {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
    const rawUrl = req.url ?? ''
    const pathname = rawUrl.split('?')[0] ?? ''
    const kind = pathname === '/codex-app-asset' ? 'asset' : pathname === '/codex-local-image' ? 'image'
      : pathname === '/codex-local-directories' ? 'directories'
      : pathname.startsWith('/codex-local-browse/') ? 'browse' : null
    if (!kind || !['GET', 'HEAD'].includes(req.method ?? '')) return next()
    const send = (status: number, body: string, type = 'application/json; charset=utf-8') => {
      if (res.destroyed || res.writableEnded) return
      res.statusCode = status
      res.setHeader('Content-Type', type)
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    const json = (status: number, value: unknown) => send(status, JSON.stringify(value))
    void (async () => {
      let localPath: string
      if (kind === 'asset') {
        const id = new URLSearchParams(rawUrl.slice(pathname.length)).get('id') ?? ''
        const path = inlineAssetPath(id)
        if (!path) throw new RequestError(400, 'Invalid application asset ID.')
        let bytes: Buffer
        try { bytes = await readFile(path) } catch { throw new RequestError(404, 'Application asset not found.') }
        res.setHeader('Content-Type', mime.contentType(extname(path)) || 'application/octet-stream')
        res.setHeader('Content-Length', bytes.length)
        res.setHeader('Cache-Control', 'private, max-age=300')
        res.end(req.method === 'HEAD' ? undefined : bytes)
        return
      }
      const query = new URLSearchParams(rawUrl.slice(pathname.length))
      try {
        localPath = kind === 'image' || kind === 'directories'
          ? normalizeLocalPath(query.get('path') ?? '')
          : decodeURIComponent(pathname.slice(`/codex-local-${kind}`.length))
      } catch { throw new RequestError(400, 'Expected absolute local file path.') }
      // Browse links prefix remote Windows drive paths with the route slash.
      if (kind === 'browse') localPath = localPath.replace(/^\/([a-z]:[\\/])/iu, '$1')
      validatePath(localPath, kind === 'directories')
      if (kind === 'image' && !imageTypes[extname(localPath).toLowerCase()]) throw new RequestError(415, 'Unsupported image type.')
      const info = await files.getMetadata(localPath)
      if (kind === 'directories') {
        if (!info.isDirectory) throw new RequestError(400, 'Expected directory path.')
        const showHidden = ['1', 'true', 'yes', 'on'].includes((query.get('showHidden') ?? '').toLowerCase())
        json(200, { data: await getLocalDirectoryListing(localPath, files, { showHidden }) })
      } else {
        res.setHeader('Cache-Control', kind === 'image' ? 'private, no-cache' : 'private, no-store')
        // File links never expose directory contents, including symlink targets.
        if (!info.isFile) throw new RequestError(404, kind === 'image' ? 'Image file not found.' : 'File not found.')
        if (kind === 'image') res.setHeader('Content-Type', imageTypes[extname(localPath).toLowerCase()]!)
        const modified = info.modifiedAtMs > 0 ? new Date(info.modifiedAtMs).toUTCString() : null
        if (modified) res.setHeader('Last-Modified', modified)
        if (req.headers['if-none-match'] === '*') {
          res.statusCode = 304
          res.end()
          return
        }
        // Metadata can satisfy IMS without transferring Base64 bytes. Metadata
        // carries no size, so a cold HEAD still needs a full upstream read.
        if (!req.headers['if-none-match'] && modified && req.headers['if-modified-since'] &&
          Date.parse(req.headers['if-modified-since']) >= Date.parse(modified)) {
          res.statusCode = 304
          res.end()
          return
        }
        const bytes = await files.readFile(localPath, info)
        const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`
        res.setHeader('ETag', etag)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', kind === 'image' ? imageTypes[extname(localPath).toLowerCase()]! : mime.contentType(extname(localPath)) || 'application/octet-stream')
        const match = req.headers['if-none-match']
        if (match === '*' || (typeof match === 'string' && match.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)) ||
          (!match && modified && req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Date.parse(modified))) {
          res.statusCode = 304
          res.end()
          return
        }
        let body = bytes
        const range = req.method === 'GET' ? req.headers.range : undefined
        const ifRange = req.headers['if-range']
        if (range && (!ifRange || ifRange === etag || (modified && Date.parse(typeof ifRange === 'string' ? ifRange : '') >= Date.parse(modified)))) {
          // Multiple/malformed ranges are ignored, as allowed by HTTP.
          const parts = /^bytes=(\d*)-(\d*)$/u.exec(range)
          if (parts && (parts[1] || parts[2])) {
            const start = parts[1] ? Number(parts[1]) : Math.max(0, bytes.length - Number(parts[2]))
            const end = parts[1] && parts[2] ? Math.min(Number(parts[2]), bytes.length - 1) : bytes.length - 1
            if (start > end || start >= bytes.length || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
              res.setHeader('Content-Range', `bytes */${bytes.length}`)
              throw new RequestError(416, 'Requested range not satisfiable.')
            }
            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`)
            body = bytes.subarray(start, end + 1)
          }
        }
        res.setHeader('Content-Length', body.length)
        res.end(req.method === 'HEAD' ? undefined : body)
      }
    })().catch((error: unknown) => {
      if (res.headersSent) { res.destroy(); return }
      const rpc = error as { code?: unknown; data?: unknown; message?: string }
      const message = rpc.message ?? 'App-server file operation failed.'
      const transportFailure = /cannot connect to app-server|app-server (disconnected|connection|client disposed)|retired app-server/iu.test(message)
      const missing = !transportFailure && /no such file|not found|cannot find the (file|path)/iu.test(message) && rpc.code !== -32601
      const denied = /permission denied|access (is )?denied/iu.test(message)
      const status = error instanceof RequestError ? error.status : missing ? 404 : denied ? 403 : 502
      json(status, {
        error: error instanceof RequestError ? error.message : missing
          ? kind === 'directories' ? 'Directory not found.' : kind === 'image' ? 'Image file not found.' : 'File not found.'
          : message,
        ...(rpc.code !== undefined ? { code: rpc.code } : {}),
        ...(rpc.data !== undefined ? { data: rpc.data } : {}),
      })
    })
  }
}
