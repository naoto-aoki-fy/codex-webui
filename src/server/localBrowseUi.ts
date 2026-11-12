import { projectPath } from './appServerFileSystem.js'
import type { ProjectFileService } from './appServerFileSystem.js'

export type LocalDirectoryListingEntry = {
  name: string
  path: string
}

export type LocalDirectoryListing = {
  path: string
  parentPath: string
  entries: LocalDirectoryListingEntry[]
}

type LocalDirectoryListingOptions = {
  showHidden?: boolean
}

export function normalizeLocalPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed)
      const path = decodeURIComponent(url.pathname)
      return url.hostname && url.hostname !== 'localhost'
        ? `\\\\${url.hostname}${path.replace(/\//gu, '\\')}`
        : path.replace(/^\/([a-z]:\/)/iu, '$1')
    } catch {
      return trimmed.replace(/^file:\/\//u, '')
    }
  }
  return trimmed
}

function isHiddenName(value: string): boolean {
  return value.startsWith('.')
}

export async function getLocalDirectoryListing(
  localPath: string,
  files: ProjectFileService,
  options: LocalDirectoryListingOptions = {},
): Promise<LocalDirectoryListing> {
  const entries = (await files.readDirectory(localPath)).entries
  const directories = entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({
      name: entry.fileName,
      path: projectPath(localPath).join(localPath, entry.fileName),
    }))
    .filter((entry) => options.showHidden === true || !isHiddenName(entry.name))
    .sort((a, b) => {
      const aHidden = isHiddenName(a.name)
      const bHidden = isHiddenName(b.name)
      if (aHidden !== bHidden) return aHidden ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })

  return {
    path: localPath,
    parentPath: projectPath(localPath).dirname(localPath),
    entries: directories,
  }
}
