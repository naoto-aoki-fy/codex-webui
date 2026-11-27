import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

const app = 'codex-webui'

/** Resolve paths on the WebUI backend only. Relative XDG paths are ignored. */
export function resolveWebuiStorage(env = process.env, platform = process.platform, home = homedir()) {
  const path = platform === 'win32' ? win32 : posix
  function absolute(value, fallback) {
    if (!value || !path.isAbsolute(value) || /[\x00-\x1f]/u.test(value)) return fallback
    return platform === 'win32' && path.parse(value).root.length === 1 ? fallback : value
  }

  if (platform === 'win32') {
    const roaming = absolute(env.APPDATA, path.join(home, 'AppData', 'Roaming'))
    const local = absolute(env.LOCALAPPDATA, path.join(home, 'AppData', 'Local'))
    return {
      config: path.join(roaming, app),
      data: path.join(local, app),
      cache: path.join(local, app, 'Cache'),
      logs: path.join(local, app, 'Logs'),
    }
  }
  if (platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support', app)
    return {
      config: support,
      data: support,
      cache: path.join(home, 'Library', 'Caches', app),
      logs: path.join(home, 'Library', 'Logs', app),
    }
  }
  return {
    config: path.join(absolute(env.XDG_CONFIG_HOME, path.join(home, '.config')), app),
    data: path.join(absolute(env.XDG_DATA_HOME, path.join(home, '.local', 'share')), app),
    cache: path.join(absolute(env.XDG_CACHE_HOME, path.join(home, '.cache')), app),
    logs: path.join(absolute(env.XDG_STATE_HOME, path.join(home, '.local', 'state')), app),
  }
}

export function requireConnectionProfile(value = process.env.CODEXUI_CONNECTION_PROFILE) {
  const id = value?.trim()
  if (!id) throw new Error('App Server ID is required. Set --connection-profile <id> or CODEXUI_CONNECTION_PROFILE.')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(id)) {
    throw new Error('Invalid App Server ID. Use 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit.')
  }
  return id
}

// Case-sensitive IDs get distinct, portable directory names, including on Windows.
export function profileDirectoryName(id) {
  return createHash('sha256').update(requireConnectionProfile(id)).digest('hex')
}

export const storageNames = {
  profiles: 'app-servers',
  global: 'global',
  state: 'state.json',
  modelPreferences: 'model-preferences.json',
  goalTemplates: 'goal-templates.json',
  authSessions: 'auth-sessions.json',
  uploads: 'uploads',
  inventory: 'inventory.json',
  journal: 'journal.jsonl',
  inlineMedia: 'inline-media',
  rolloutCache: 'model-history',
}

// Choose path syntax from the App Server path, independently of the backend OS.
export function projectPath(path) {
  return /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\') || /^\/\/[^/]+\/[^/]+/u.test(path) ? win32 : posix
}

export function isAbsoluteUploadPath(value) {
  const path = projectPath(value)
  if (!path.isAbsolute(value) || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) return false
  const parts = value.split(/[\\/]/u)
  if (parts.some(part => part === '.' || part === '..')) return false
  if (path === posix) return !value.includes('\\') && !value.startsWith('//')
  if (/^[a-z]:[\\/]/iu.test(value)) parts.shift()
  else if (!/^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(value)) return false
  // Reject device/extended paths, streams, short-name aliases and Win32 normalization.
  return parts.every(part => !/[<>:"|?*~]|[. ]$/u.test(part)
    && !/^(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³])(?:\.|$)/iu.test(part))
}

export function remoteUploadsDirectory(root, id) {
  // The root is interpreted using the App Server path syntax.
  const path = projectPath(root)
  if (!isAbsoluteUploadPath(root) ||
      root.split(/[\\/]/u).some(part => /^\.codex[. ]*$/iu.test(part))) {
    throw new Error('Set CODEXUI_REMOTE_UPLOAD_DIR to an absolute dedicated path outside Codex home on the App Server host')
  }
  return path.join(root, 'codexapp-uploads', profileDirectoryName(id))
}
