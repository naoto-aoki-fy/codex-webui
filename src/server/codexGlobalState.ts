import { storageNames } from './webuiStorage.mjs'
import { profileStorageDirectory } from './connectionProfile.js'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readlink, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import lockfile from 'proper-lockfile'

export type CodexGlobalState = Record<string, unknown>

const mutationsByPath = new Map<string, Promise<unknown>>()
const lockOptions = {
  realpath: false,
  stale: 10_000,
  update: 2_000,
  retries: { retries: 50, factor: 1, minTimeout: 100, maxTimeout: 100, maxRetryTime: 5_000 },
}

export function getCodexGlobalStatePath(): string {
  return join(profileStorageDirectory('data'), storageNames.state)
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

// Resolve both directory aliases and dangling file symlinks without replacing the link.
async function resolveDestination(path: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error('Too many symbolic links in WebUI state path')
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  try {
    if ((await lstat(absolute)).isSymbolicLink()) {
      return resolveDestination(resolve(dirname(absolute), await readlink(absolute)), depth + 1)
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  return join(await resolveDestination(parent, depth + 1), basename(absolute))
}

async function readState(path: string, recoverMalformed = false, maxBytes?: number): Promise<CodexGlobalState> {
  let raw: string
  try {
    if (maxBytes === undefined) raw = await readFile(path, 'utf8')
    else {
      const file = await open(path, 'r')
      try {
        if ((await file.stat()).size > maxBytes) throw new Error('WebUI state exceeds read budget')
        raw = await file.readFile('utf8')
      } finally { await file.close() }
    }
  } catch (error) {
    if (isMissing(error)) return {}
    throw error
  }
  let state: unknown
  try { state = JSON.parse(raw) } catch (error) {
    if (recoverMalformed && error instanceof SyntaxError) return {}
    throw error
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    if (recoverMalformed) return {}
    throw new Error(`Invalid WebUI state object: ${path}`)
  }
  return state as CodexGlobalState
}

export async function readCodexGlobalState(path = getCodexGlobalStatePath(), recoverMalformed = false): Promise<CodexGlobalState> {
  return readState(await resolveDestination(path), recoverMalformed)
}

async function withStateLock<T>(path: string, mutate: (destination: string, checkLock: () => void) => Promise<T>): Promise<T> {
  const destination = await resolveDestination(path)
  const previous = mutationsByPath.get(destination) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(destination), { recursive: true })
    let compromised: Error | null = null
    const release = await lockfile.lock(destination, {
      ...lockOptions,
      onCompromised: (error) => { compromised = error },
    })
    try {
      return await mutate(destination, () => { if (compromised) throw compromised })
    } finally {
      if (!compromised) await release()
    }
  })
  mutationsByPath.set(destination, run)
  try {
    return await run
  } finally {
    if (mutationsByPath.get(destination) === run) mutationsByPath.delete(destination)
  }
}

export async function updateCodexGlobalState<T>(
  update: (state: CodexGlobalState) => T | Promise<T>,
  path = getCodexGlobalStatePath(),
  recoverMalformed = false,
  maxBytes?: number,
): Promise<T> {
  return withStateLock(path, async (destination, checkLock) => {
    let temporaryPath: string | undefined
    try {
      const state = await readState(destination, recoverMalformed, maxBytes)
      const before: unknown = JSON.parse(JSON.stringify(state))
      const result = await update(state)
      checkLock()
      if (isDeepStrictEqual(before, state)) return result

      const mode = await stat(destination).then((info) => info.mode & 0o7777).catch((error: unknown) => {
        if (isMissing(error)) return 0o600
        throw error
      })
      temporaryPath = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
      const file = await open(temporaryPath, 'wx', mode)
      try {
        await file.writeFile(JSON.stringify(state), 'utf8')
        await file.chmod(mode)
        await file.sync()
      } finally {
        await file.close()
      }
      checkLock()
      await rename(temporaryPath, destination)
      temporaryPath = undefined
      return result
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true })
    }
  })
}

export async function deleteCodexGlobalState(path: string): Promise<void> {
  await withStateLock(path, async (destination, checkLock) => {
    checkLock()
    await rm(destination, { force: true })
  })
}
