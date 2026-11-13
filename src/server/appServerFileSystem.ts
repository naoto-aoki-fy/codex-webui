import { posix, win32 } from 'node:path'
import type { AppServerClient } from './appServerClient.js'
import type { FsReadDirectoryResponse } from './protocol/0.167.2/v2/FsReadDirectoryResponse.js'
import type { FsGetMetadataResponse } from './protocol/0.167.2/v2/FsGetMetadataResponse.js'
import type { FsReadFileResponse } from './protocol/0.167.2/v2/FsReadFileResponse.js'

export const PROJECT_FILE_CODEX_VERSION = '0.167.2'

// Choose lexical path rules from the remote path, never the Web host OS.
export function projectPath(path: string) {
  return /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\') || /^\/\/[^/]+\/[^/]+/u.test(path) ? win32 : posix
}

/** Read-only project access through the existing connection. No local fallback,
 * persistent cache, retry, or independent connection is created here. */
export class ProjectFileService {
  constructor(private readonly client: Pick<AppServerClient, 'rpc'>) {}

  async readFile(path: string): Promise<Buffer> {
    const result = await this.client.rpc('fs/readFile', { path }) as FsReadFileResponse
    if (typeof result?.dataBase64 !== 'string') throw new Error('Invalid fs/readFile response')
    return Buffer.from(result.dataBase64, 'base64')
  }

  async getMetadata(path: string): Promise<FsGetMetadataResponse> {
    const result = await this.client.rpc('fs/getMetadata', { path }) as FsGetMetadataResponse
    if (typeof result?.isFile !== 'boolean' || typeof result?.isDirectory !== 'boolean') throw new Error('Invalid fs/getMetadata response')
    return result
  }

  async readDirectory(path: string): Promise<FsReadDirectoryResponse> {
    const result = await this.client.rpc('fs/readDirectory', { path }) as FsReadDirectoryResponse
    if (!Array.isArray(result?.entries) || result.entries.some(entry => typeof entry.fileName !== 'string' || typeof entry.isDirectory !== 'boolean')) throw new Error('Invalid fs/readDirectory response')
    return result
  }
}
