import { randomUUID } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// Fixed across checkouts, connection profiles and TMPDIR overrides.
function coordinationDirectory() {
  const directory = `/tmp/codex-webui-maintenance-${process.getuid()}`
  const parent = lstatSync('/tmp')
  if (!parent.isDirectory() || !(parent.mode & 0o1000)) throw new Error('WebUI maintenance requires a sticky /tmp directory')
  try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
    throw new Error(`Unsafe WebUI maintenance directory: ${directory}`)
  }
  return directory
}

let writerLease

export function holdWebuiWriterLease() {
  if (process.platform !== 'linux' || writerLease) return
  const directory = coordinationDirectory()
  const lease = join(directory, `writer-${process.pid}-${randomUUID()}`)
  closeSync(openSync(lease, 'wx', 0o600))
  try {
    try {
      lstatSync(join(directory, 'reset'))
      throw new Error('A Codex WebUI reset is in progress. Start WebUI after it has finished.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  } catch (error) {
    unlinkSync(lease)
    throw error
  }
  writerLease = lease
  // Keep the lease through shutdown, including pending asynchronous persistence.
  process.once('exit', () => { try { unlinkSync(lease) } catch { /* Dead PIDs are pruned by reset. */ } })
}

export function acquireWebuiResetLease() {
  if (process.platform !== 'linux') throw new Error('Reset execution requires Linux')
  const directory = coordinationDirectory()
  const lock = join(directory, 'reset')
  try { mkdirSync(lock, { mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`WebUI reset lock already exists: ${lock}`)
    throw error
  }
  try {
    for (const name of readdirSync(directory)) {
      if (name === 'reset') continue
      const match = /^writer-([1-9]\d*)-[0-9a-f-]{36}$/u.exec(name)
      const pid = Number(match?.[1])
      if (!Number.isSafeInteger(pid) || pid > 0x7fffffff) throw new Error(`Unknown maintenance entry: ${join(directory, name)}`)
      try {
        process.kill(pid, 0)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
        try { unlinkSync(join(directory, name)) } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup }
        continue
      }
      // An exiting writer can remove its lease before the PID disappears.
      try { lstatSync(join(directory, name)) } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      throw new Error(`A Codex WebUI server or build is running (PID ${pid})`)
    }
  } catch (error) {
    rmdirSync(lock)
    throw error
  }
  return () => rmdirSync(lock)
}
