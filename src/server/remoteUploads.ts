import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, win32, type PlatformPath } from 'node:path'
import { isAbsoluteUploadPath, projectPath, remoteUploadsDirectory, storageNames } from './webuiStorage.mjs'
import { getConnectionProfileId, profileStorageDirectory } from './connectionProfile.js'
import { updateCodexGlobalState } from './codexGlobalState.js'
import { asRecord } from './bridgeHttpUtils.js'
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

type UploadClient = Pick<AppServerClient, 'uploadRpc' | 'resolveCodexHome' | 'resolveUploadUserHome' | 'getConnectionGeneration'>
const homeError = 'Cannot verify the App Server Codex home. Ensure the App Server reports its absolute Codex home in initialization or config/read before using CODEXUI_REMOTE_UPLOAD_DIR.'

function inside(rules: PlatformPath, parent: string, child: string): boolean {
  // Treat case and Unicode normalization variants as aliases, including on macOS.
  const normalized = (path: string) => path.normalize('NFC').toLowerCase()
  const relative = rules.relative(normalized(parent), normalized(child))
  return !rules.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + rules.sep)
}

async function validateUploadDirectory(
  client: UploadClient, generation: number, rules: PlatformPath, root: string, directory: string,
  home: string, userHome: string,
): Promise<void> {
  if (projectPath(home) !== rules) {
    throw new Error('CODEXUI_REMOTE_UPLOAD_DIR must use the same absolute path syntax as the App Server Codex home')
  }
  if (inside(rules, home, root) || inside(rules, home, directory) || inside(rules, directory, home)) {
    throw new Error('CODEXUI_REMOTE_UPLOAD_DIR must be outside the App Server Codex home')
  }

  const checks = new Map<string, Promise<boolean>>()
  function check(path: string): Promise<boolean> {
    const existing = checks.get(path)
    if (existing) return existing
    const result = client.uploadRpc('fs/getMetadata', { path }, generation).then(value => {
      const info = asRecord(value)
      if (info?.isDirectory !== true || info.isSymlink !== false) {
        throw new Error('Expected a directory without symbolic links')
      }
      return true
    }, error => {
      // Codex forwards OS errors as internal errors. Only an explicit missing
      // file (or Windows missing path) permits creating descendants.
      const missing = rules === win32 ? /\(os error [23]\)$/u : /\(os error 2\)$/u
      if (error?.code === -32603 && typeof error.message === 'string' && missing.test(error.message)) return false
      throw error
    })
    checks.set(path, result)
    return result
  }

  async function checkAncestors(path: string, allowMissing: boolean): Promise<void> {
    const paths = []
    for (let component = rules.resolve(path); ; component = rules.dirname(component)) {
      paths.push(component)
      if (rules.dirname(component) === component) break
    }
    for (const [index, component] of paths.reverse().entries()) {
      if (await check(component)) continue
      if (allowMissing && index > 0) return
      throw new Error('Required directory is missing')
    }
  }

  try {
    await Promise.all([
      checkAncestors(home, false),
      checkAncestors(directory, true),
      userHome && checkAncestors(userHome, false),
    ])
  } catch (cause) {
    throw Object.assign(new Error('Cannot safely verify CODEXUI_REMOTE_UPLOAD_DIR. Use a dedicated path on the App Server outside Codex home, with no symbolic links in either path, and ensure fs/getMetadata can inspect them.'), { cause })
  }
}

/** Indefinite retention, including unknown outcomes. No automatic deletion:
 * accepted turns and durable history may refer to these files after restart. */
export async function stageRemoteUpload(
  client: UploadClient,
  name: string, bytes: Buffer,
): Promise<string> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Upload exceeds 20 MiB file limit')
  const id = getConnectionProfileId()
  const configuredRoot = process.env.CODEXUI_REMOTE_UPLOAD_DIR?.trim() ?? ''
  const configuredDirectory = configuredRoot && remoteUploadsDirectory(configuredRoot, id)
  const generation = client.getConnectionGeneration()
  const home = await client.resolveCodexHome().catch(cause => {
    throw Object.assign(new Error(homeError), { cause })
  })
  if (!isAbsoluteUploadPath(home)) throw new Error(homeError)
  const userHome = configuredRoot ? '' : await client.resolveUploadUserHome(home, generation)
  const root = configuredRoot || projectPath(userHome).join(userHome, '.codex-webui-uploads')
  const directory = configuredDirectory || remoteUploadsDirectory(root, id)
  const rules = projectPath(directory)
  await validateUploadDirectory(client, generation, rules, root, directory, home, userHome)

  const stateDirectory = join(profileStorageDirectory('data', id), storageNames.uploads)
  const path = rules.join(directory, `${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)}`)
  await client.uploadRpc('fs/createDirectory', { path: directory, recursive: true }, generation)
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
  await client.uploadRpc('fs/writeFile', { path, dataBase64: bytes.toString('base64') }, generation)
  await withInventory(stateDirectory, records => { const record = records.find(record => record.path === path); if (record) record.status = 'staged' })
  return path
}
