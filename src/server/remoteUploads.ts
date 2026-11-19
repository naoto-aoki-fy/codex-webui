import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectPath } from './appServerFileSystem.js'
import { remoteUploadsDirectory, storageNames } from './webuiStorage.mjs'
import { getConnectionProfileId, profileStorageDirectory } from './connectionProfile.js'
import { updateCodexGlobalState } from './codexGlobalState.js'
import type { AppServerClient } from './appServerClient.js'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const DEFAULT_UPLOAD_CAPACITY_BYTES = 1024 * 1024 * 1024

type UploadRecord = { path: string; at: string; bytes: number; status: 'unknown' | 'staged' }
function capacityBytes(): number {
  const value = Number(process.env.CODEXUI_UPLOAD_CAPACITY_BYTES || DEFAULT_UPLOAD_CAPACITY_BYTES)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('CODEXUI_UPLOAD_CAPACITY_BYTES must be a nonnegative integer')
  return value
}
function uploadRecord(value: unknown): UploadRecord {
  const record = value as Partial<UploadRecord> | null
  if (!record || typeof record.path !== 'string' || typeof record.at !== 'string' ||
      typeof record.bytes !== 'number' || !Number.isSafeInteger(record.bytes) || record.bytes < 0 ||
      (record.status !== 'unknown' && record.status !== 'staged')) {
    throw new Error('Invalid WebUI upload accounting record')
  }
  return record as UploadRecord
}

async function recoverInventoryFromJournal(stateDirectory: string): Promise<UploadRecord[]> {
  try {
    const lines = (await readFile(join(stateDirectory, storageNames.journal), 'utf8')).split('\n').filter(Boolean)
    // Never silently ignore a corrupt journal: it may describe retained files.
    return lines.map(line => uploadRecord(JSON.parse(line)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
async function withInventory<T>(stateDirectory: string, operation: (records: UploadRecord[]) => T): Promise<T> {
  return updateCodexGlobalState(async state => {
    if (state.records === undefined) state.records = await recoverInventoryFromJournal(stateDirectory)
    if (!Array.isArray(state.records)) throw new Error('Invalid WebUI upload inventory')
    return operation(state.records as UploadRecord[])
  }, join(stateDirectory, storageNames.inventory))
}

/** Indefinite retention, including unknown outcomes. No automatic deletion:
 * accepted turns and durable history may refer to these files after restart. */
export async function stageRemoteUpload(
  client: Pick<AppServerClient, 'rpc' | 'resolveCodexHome'>,
  name: string, bytes: Buffer,
): Promise<string> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Upload exceeds 20 MiB file limit')
  const id = getConnectionProfileId()
  const directory = remoteUploadsDirectory(process.env.CODEXUI_REMOTE_UPLOAD_DIR?.trim() ?? '', id)
  const rules = projectPath(directory)
  const codexHome = await client.resolveCodexHome({ discover: false })
  if (codexHome) {
    const relative = rules.relative(codexHome, directory)
    if (!relative || (!rules.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + rules.sep))) {
      throw new Error('CODEXUI_REMOTE_UPLOAD_DIR must be outside the App Server Codex home')
    }
  }

  const stateDirectory = join(profileStorageDirectory('data', id), storageNames.uploads)
  const path = rules.join(directory, `${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)}`)
  await client.rpc('fs/createDirectory', { path: directory, recursive: true })
  await mkdir(stateDirectory, { recursive: true })
  const intent: UploadRecord = { path, at: new Date().toISOString(), bytes: bytes.length, status: 'unknown' }
  // Locked, atomic reservation across instances with this App Server ID; ambiguous writes
  // consume capacity until an operator audits them. Never retry remote writes.
  await withInventory(stateDirectory, records => {
    const used = records.reduce((sum, record) => sum + uploadRecord(record).bytes, 0)
    if (used + bytes.length > capacityBytes()) throw new Error('Managed upload capacity reached; audit the retained attachments and local upload inventory before raising CODEXUI_UPLOAD_CAPACITY_BYTES')
    records.push(intent)
  })
  // Keep a second record of each reservation for recovery if the inventory is lost.
  await appendFile(join(stateDirectory, storageNames.journal), JSON.stringify(intent) + '\n', { mode: 0o600 })
  await client.rpc('fs/writeFile', { path, dataBase64: bytes.toString('base64') })
  await withInventory(stateDirectory, records => { const record = records.find(record => record.path === path); if (record) record.status = 'staged' })
  return path
}
