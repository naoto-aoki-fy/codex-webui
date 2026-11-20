import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { setJson } from './bridgeHttpUtils.js'
import { encodingPreferences } from './httpContentEncoding.js'

const MIN_COMPRESSION_BYTES = 1024
const encodings = ['br', 'gzip', 'identity'] as const
const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)

type JsonWriter = (statusCode: number, payload: unknown) => void | Promise<void>

export function createRpcJsonWriter(
  req: IncomingMessage,
  res: ServerResponse,
  onEncodedResponse?: (decodedBytes: number) => void,
): JsonWriter | null {
  const vary = String(res.getHeader?.('Vary') ?? '')
  const varyFields = vary.toLowerCase().split(',').map(field => field.trim())
  if (!varyFields.includes('*') && !varyFields.includes('accept-encoding')) {
    res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
  }

  const preferences = encodingPreferences(req.headers['accept-encoding'], encodings)
  const encoding = preferences[0]?.[0]
  if (!encoding) return null
  if (encoding === 'identity') {
    return (statusCode, payload) => {
      if (!res.destroyed) setJson(res, statusCode, payload)
    }
  }

  const allowsIdentity = preferences.some(group => group.includes('identity'))
  return async (statusCode, payload) => {
    if (res.destroyed) return
    const body = JSON.stringify(payload)
    const bytes = Buffer.byteLength(body, 'utf8')
    let compressed: Buffer | undefined
    if (!allowsIdentity || bytes >= MIN_COMPRESSION_BYTES) {
      try {
        compressed = encoding === 'br'
          ? await compressBrotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
          : await compressGzip(body, { level: 1 })
      } catch {
        // Send the completed RPC result even if encoding fails.
      }
    }

    if (res.destroyed) return
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (compressed && (!allowsIdentity || compressed.length < bytes)) {
      res.setHeader('Content-Encoding', encoding)
      res.setHeader('Content-Length', compressed.length)
      onEncodedResponse?.(bytes)
      res.end(compressed)
      return
    }
    res.end(body)
  }
}
