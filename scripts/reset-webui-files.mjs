import {
  closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync,
  rmdirSync, unlinkSync,
} from 'node:fs'
import { basename, dirname, join, parse, relative, sep } from 'node:path'

const linux = process.platform === 'linux'
const noFollow = constants.O_NOFOLLOW ?? 0
const mountPoints = linux ? new Set(readFileSync('/proc/self/mountinfo', 'utf8').trimEnd().split('\n')
  .map(line => line.split(' ')[4].replace(/\\([0-7]{3})/gu, (_, octal) => String.fromCharCode(parseInt(octal, 8))))) : new Set()

export function inside(parent, path) {
  const part = relative(parent, path)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !parse(part).root)
}

export function assertUnmounted(path) {
  if (mountPoints.has(path)) throw new Error(`Refusing a mounted cleanup target: ${JSON.stringify(path)}`)
}

function lstat(path) {
  try { return lstatSync(path, { bigint: true }) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return null
  }
}

function assertSafe(path, info) {
  if (info?.isSymbolicLink()) throw new Error(`Refusing a symbolic link: ${JSON.stringify(path)}`)
  if (info && !info.isDirectory() && (!info.isFile() || info.nlink !== 1n)) {
    throw new Error(`Refusing a special or hard-linked file: ${JSON.stringify(path)}`)
  }
  return info
}

const fdPath = fd => `/proc/self/fd/${fd}`

// Open each directory separately. On Linux all operations below its opened
// descriptor remain anchored even if a pathname is replaced with a symlink.
function inParent(path, action, missing) {
  const root = parse(path).root
  const parts = relative(root, dirname(path)).split(sep).filter(Boolean)
  let directory = root
  let fd
  try {
    if (linux) fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | noFollow)
    for (const part of parts) {
      directory = join(directory, part)
      const child = fd === undefined ? directory : join(fdPath(fd), part)
      const info = assertSafe(directory, lstat(child))
      if (!info) return missing
      if (!info.isDirectory()) throw new Error(`Expected a directory: ${directory}`)
      if (linux) {
        const next = openSync(child, constants.O_RDONLY | constants.O_DIRECTORY | noFollow)
        closeSync(fd)
        fd = next
        if (identity(info) !== identity(fstatSync(fd, { bigint: true }))) {
          throw new Error(`Directory changed during reset: ${JSON.stringify(directory)}`)
        }
      }
    }
    return action(join(fd === undefined ? directory : fdPath(fd), basename(path)))
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export const inspect = path => inParent(path, child => assertSafe(path, lstat(child)), null)

export function list(path, expected) {
  return inParent(path, child => {
    const fd = openSync(child, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollow)
    try {
      sameFile(path, expected, fstatSync(fd, { bigint: true }))
      return readdirSync(linux ? fdPath(fd) : child).sort()
    } finally { closeSync(fd) }
  }, [])
}

function identity(info) {
  if (!info) return ''
  return [info.dev, info.ino].join(':')
}

export function fingerprint(info) {
  if (!info) return ''
  return [identity(info), info.mode, info.uid, info.gid, info.nlink, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

function sameFile(path, expected, actual) {
  if (fingerprint(expected) !== fingerprint(actual)) throw new Error(`Changed during reset: ${path}`)
}

export function apply({ path, info, kind }) {
  let applied = false
  inParent(path, child => {
    const actual = assertSafe(path, lstat(child))
    if (kind === 'rmdir') {
      // Child deletions in this plan changed the directory's timestamps.
      if (identity(info) !== identity(actual)) throw new Error(`Changed during reset: ${path}`)
      rmdirSync(child)
    } else {
      sameFile(path, info, actual)
      unlinkSync(child)
    }
    applied = true
  })
  if (!applied) throw new Error(`Changed during reset: ${path}`)
}
