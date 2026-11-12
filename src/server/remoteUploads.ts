import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { projectPath } from './appServerFileSystem.js'
import type { AppServerClient } from './appServerClient.js'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Indefinite retention, including unknown outcomes. No automatic deletion:
 * accepted turns and durable history may refer to these files after restart. */
export async function stageRemoteUpload(
  client: Pick<AppServerClient, 'rpc' | 'getInitializationMetadata'>,
  name: string, bytes: Buffer, stateDirectory: string,
): Promise<string> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Upload exceeds 20 MiB file limit')
  await client.rpc('config/read', {})
  const root = process.env.CODEXUI_REMOTE_UPLOAD_DIR?.trim() || client.getInitializationMetadata()?.codexHome
  if (!root || !projectPath(root).isAbsolute(root)) throw new Error('Set CODEXUI_REMOTE_UPLOAD_DIR to an absolute path on the App Server host')
  const directory = projectPath(root).join(root, 'codexapp-uploads')
  await client.rpc('fs/createDirectory', { path: directory, recursive: true })
  const path = projectPath(root).join(directory, `${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)}`)
  await mkdir(stateDirectory, { recursive: true })
  // Record intent before sending a mutation: a lost response can leave a remote file.
  await appendFile(join(stateDirectory, 'codexapp-uploads.jsonl'), JSON.stringify({ path, at: new Date().toISOString(), server: process.env.CODEXUI_APP_SERVER_URL ?? 'default' }) + '\n', { mode: 0o600 })
  await client.rpc('fs/writeFile', { path, dataBase64: bytes.toString('base64') })
  return path
}
