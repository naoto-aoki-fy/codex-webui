import { readFileSync, type Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { Request, Response, NextFunction } from 'express'
import { encodingPreferences } from './httpContentEncoding.js'

const suffixes = { zstd: '.zst', br: '.br', gzip: '.gz', identity: '' } as const
type Encoding = keyof typeof suffixes
const encodings = Object.keys(suffixes) as Encoding[]

async function fileMetadata(file: string): Promise<Stats | undefined> {
  try {
    const metadata = await stat(file)
    return metadata.isFile() ? metadata : undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

async function selectRepresentation(file: string, preferences: Encoding[][], originalMetadata?: Stats) {
  for (const group of preferences) {
    const candidates = await Promise.all(group.map(async encoding => {
      const path = file + suffixes[encoding]
      const metadata = (encoding === 'identity' ? originalMetadata : undefined) ?? await fileMetadata(path)
      return metadata && { encoding, path, metadata }
    }))
    let smallest: (typeof candidates)[number]
    for (const candidate of candidates) {
      if (candidate && (!smallest || candidate.metadata.size < smallest.metadata.size)) smallest = candidate
    }
    if (smallest) return smallest
  }
}

export async function sendPrecompressed(req: Request, res: Response, next: NextFunction, file: string, immutable = false, originalMetadata?: Stats) {
  const extension = extname(file)
  if (extension === '.html') res.setHeader('Cache-Control', 'no-cache')
  else if (immutable) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.vary('Accept-Encoding')

  const sendAvailable = async (preferences: Encoding[][]) => {
    const selected = await selectRepresentation(file, preferences, originalMetadata)
    if (!selected) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(406).end()
      return
    }

    const { encoding, path, metadata } = selected
    res.setHeader('ETag', 'W/"' + encoding + '-' + metadata.size.toString(16) + '-' + metadata.mtimeMs.toString(16) + '"')
    res.type(extension)
    if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding)
    const originalStatus = res.statusCode
    // sendFile computes length, modification date, ranges and freshness for the selected file.
    res.sendFile(path, (error) => {
      if (!error) return
      if (res.headersSent) return next(error)
      res.removeHeader('Content-Encoding')
      const code = (error as NodeJS.ErrnoException).code
      if (encoding === 'identity' || !['ENOENT', 'ENOTDIR', 'EISDIR'].includes(code ?? '')) {
        return next(error)
      }

      // A sidecar disappeared after negotiation. Discard its headers before trying another file.
      for (const header of ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type', 'ETag', 'Last-Modified']) {
        res.removeHeader(header)
      }
      res.status(originalStatus)
      const remaining = preferences.map(group => group.filter(candidate => candidate !== encoding))
      void sendAvailable(remaining).catch(next)
    })
  }

  return sendAvailable(encodingPreferences(req.headers['accept-encoding'], encodings))
}

export function precompressedStatic(root: string) {
  const base = resolve(root)
  // Only build-manifest entries qualify; public/unversioned files never opt in.
  // Read once at startup, with a safe revalidation fallback for older builds.
  const immutableFiles = new Set<string>()
  try {
    const manifest = JSON.parse(readFileSync(resolve(base, '.vite/manifest.json'), 'utf8'))
    for (const entry of Object.values(manifest) as { file?: unknown }[]) {
      if (typeof entry?.file === 'string' && /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.js$/.test(entry.file)) {
        immutableFiles.add(resolve(base, entry.file))
      }
    }
  } catch { /* Missing or invalid manifest: retain default revalidation. */ }
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let pathname: string
    try { pathname = decodeURIComponent(req.path) } catch { return next() }
    if (pathname.includes('\0') || pathname.split(/[\\/]/).some(part => part.startsWith('.'))) return next()
    const file = resolve(base, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '')
    if (!file.startsWith(base + sep)) return next()
    const metadata = await fileMetadata(file)
    if (!metadata) return next()
    return sendPrecompressed(req, res, next, file, immutableFiles.has(file), metadata)
  }
}
