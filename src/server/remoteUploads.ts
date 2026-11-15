import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectPath } from './appServerFileSystem.js'
import { getConnectionProfileId } from './connectionProfile.js'
import { updateCodexGlobalState } from './codexGlobalState.js'
import type { AppServerClient } from './appServerClient.js'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const DEFAULT_UPLOAD_CAPACITY_BYTES = 1024 * 1024 * 1024

type UploadRecord = { path: string; at: string; profile?: string; bytes?: number; status?: 'unknown' | 'staged'; root?: string }
function capacityBytes(): number {
  const value = Number(process.env.CODEXUI_UPLOAD_CAPACITY_BYTES || DEFAULT_UPLOAD_CAPACITY_BYTES)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('CODEXUI_UPLOAD_CAPACITY_BYTES must be a nonnegative integer')
  return value
}
async function legacyInventory(stateDirectory: string): Promise<UploadRecord[]> {
  try {
    const lines = (await readFile(join(stateDirectory, 'codexapp-uploads.jsonl'), 'utf8')).split('\n').filter(Boolean)
    // Never silently ignore a corrupt journal: it may describe retained files.
    return lines.map(line => JSON.parse(line) as UploadRecord)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
async function withInventory<T>(stateDirectory: string, operation: (records: UploadRecord[]) => T): Promise<T> {
  return updateCodexGlobalState(async state => {
    if (!Array.isArray(state.records)) state.records = await legacyInventory(stateDirectory)
    return operation(state.records as UploadRecord[])
  }, join(stateDirectory, 'codexapp-upload-inventory.json'))
}

/** Shared across profiles because upload roots can be shared. Byte counts cover
 * tracked attempted uploads, not the remote directory; unknown legacy sizes are
 * listed separately. No history scan can prove these files unreferenced. */
export async function inspectRemoteUploads(stateDirectory: string) {
  return withInventory(stateDirectory, records => {
    const trackedBytes = records.reduce((sum, record) => sum + (record.bytes ?? 0), 0)
    const capacity = capacityBytes()
    return {
      accountingScope: 'tracked-attempts-only', trackedBytes, capacityBytes: capacity,
      unknownSizeCount: records.filter(record => record.bytes === undefined).length,
      capacityWarning: trackedBytes >= capacity * 0.8,
      retention: 'indefinite; automatic deletion disabled',
      cleanup: { eligiblePaths: [] as string[], supported: false, reason: 'Reference and submission status cannot be proven complete across profiles and remote histories. Operator review required; no deletion endpoint is enabled.' },
      uploads: records.map(record => ({ ...record, protected: true, protectionReason: 'unknown-reference-or-submission-status' })),
    }
  })
}


/** Indefinite retention, including unknown outcomes. No automatic deletion:
 * accepted turns and durable history may refer to these files after restart. */
export async function stageRemoteUpload(
  client: Pick<AppServerClient, 'rpc' | 'resolveCodexHome'>,
  name: string, bytes: Buffer, stateDirectory: string,
): Promise<string> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Upload exceeds 20 MiB file limit')
  const root = process.env.CODEXUI_REMOTE_UPLOAD_DIR?.trim() || await client.resolveCodexHome()
  if (!root || !projectPath(root).isAbsolute(root)) throw new Error('Set CODEXUI_REMOTE_UPLOAD_DIR to an absolute path on the App Server host')
  const directory = projectPath(root).join(root, 'codexapp-uploads')
  await client.rpc('fs/createDirectory', { path: directory, recursive: true })
  const path = projectPath(root).join(directory, `${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)}`)
  await mkdir(stateDirectory, { recursive: true })
  const intent: UploadRecord = { path, at: new Date().toISOString(), profile: getConnectionProfileId(), root: directory, bytes: bytes.length, status: 'unknown' }
  // Locked, atomic reservation across instances and profiles; ambiguous writes
  // consume capacity until an operator audits them. Never retry remote writes.
  await withInventory(stateDirectory, records => {
    const used = records.reduce((sum, record) => sum + (record.bytes ?? 0), 0)
    if (used + bytes.length > capacityBytes()) throw new Error('Managed upload capacity reached; inspect /codex-api/uploads and audit retained files before raising CODEXUI_UPLOAD_CAPACITY_BYTES')
    records.push(intent)
  })
  // Record intent before sending a mutation: a lost response can leave a remote file.
  await appendFile(join(stateDirectory, 'codexapp-uploads.jsonl'), JSON.stringify(intent) + '\n', { mode: 0o600 })
  await client.rpc('fs/writeFile', { path, dataBase64: bytes.toString('base64') })
  await withInventory(stateDirectory, records => { const record = records.find(record => record.path === path); if (record) record.status = 'staged' })
  return path
}
