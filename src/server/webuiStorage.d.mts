import type { PlatformPath } from 'node:path'

export function resolveWebuiStorage(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): {
  config: string
  data: string
  cache: string
  logs: string
}
export function requireConnectionProfile(value?: string): string
export function profileDirectoryName(id: string): string
export function isAbsoluteUploadPath(value: string): boolean
export function remoteUploadsDirectory(root: string, id: string): string
export const storageNames: Record<'profiles' | 'global' | 'state' | 'modelPreferences' | 'goalTemplates' | 'authSessions' |
  'uploads' | 'inventory' | 'journal' | 'inlineMedia' | 'rolloutCache', string>
export function projectPath(path: string): PlatformPath
