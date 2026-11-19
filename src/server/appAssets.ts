import { basename, join } from 'node:path'
import { getConnectionProfileId, profileStorageDirectory } from './connectionProfile.js'
import { profileDirectoryName, storageNames } from './webuiStorage.mjs'

// Web-owned presentation data has a separate namespace from project paths.
export const inlineMediaDirectory = () => join(profileStorageDirectory('cache'), storageNames.inlineMedia)
export function inlineAssetPath(id: string): string | null {
  return /^[a-zA-Z0-9_.-]+$/u.test(id) && !id.endsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(id)
    ? join(inlineMediaDirectory(), id) : null
}

export function inlineAssetUrl(path: string): string {
  const namespace = profileDirectoryName(getConnectionProfileId())
  return `/codex-app-asset?id=${namespace}.${encodeURIComponent(basename(path))}`
}

export function resolveInlineAssetPath(id: string): string | null {
  const separator = id.indexOf('.')
  if (separator < 0 || id.slice(0, separator) !== profileDirectoryName(getConnectionProfileId())) return null
  return inlineAssetPath(id.slice(separator + 1))
}
