import { readFileSync, type Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { Request, Response, NextFunction } from 'express'

const suffixes = { zstd: '.zst', br: '.br', gzip: '.gz', identity: '' } as const
type Encoding = keyof typeof suffixes
const encodings = Object.keys(suffixes) as Encoding[]

function encodingPreferences(header: string | undefined): Encoding[][] {
  if (!header?.trim()) return [['identity']]
  const values = new Map<string, number>()
  for (const item of header.split(',')) {
    const [name, ...params] = item.toLowerCase().split(';').map(part => part.trim())
    if (!name) continue
    let q = 1
    for (const param of params) {
      const match = /^q\s*=\s*(.*)$/.exec(param)
      if (!match) continue
      const raw = match[1]
      q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Math.min(q, Number(raw)) : 0
    }
    values.set(name, Math.min(values.get(name) ?? 1, q))
  }

  const wildcard = values.get('*')
  const groups = new Map<number, Encoding[]>()
  for (const encoding of encodings) {
    const q = values.get(encoding) ?? (encoding === 'identity' ? 0 : wildcard ?? 0)
    if (q === 0) continue
    const group = groups.get(q)
    if (group) group.push(encoding)
    else groups.set(q, [encoding])
  }
  const preferences = [...groups].sort(([a], [b]) => b - a).map(([, group]) => group)
  // With no explicit identity weight, use it only as an acceptable fallback.
  if (!values.has('identity') && wildcard !== 0) preferences.push(['identity'])
  return preferences
}

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
  if (extname(file) === '.html') res.setHeader('Cache-Control', 'no-cache')
  else if (immutable) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.vary('Accept-Encoding')
  const selected = await selectRepresentation(file, encodingPreferences(req.headers['accept-encoding']), originalMetadata)
  if (!selected) {
    res.status(406).end()
    return
  }

  const { encoding, path, metadata } = selected
  res.setHeader('ETag', 'W/"' + encoding + '-' + metadata.size.toString(16) + '-' + metadata.mtimeMs.toString(16) + '"')
  res.type(extname(file))
  if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding)
  // sendFile computes length, modification date, ranges and freshness for the selected file.
  res.sendFile(path, (error) => {
    if (!error) return
    if (res.headersSent) return next(error)
    res.removeHeader('Content-Encoding')
    next(error)
  })
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
