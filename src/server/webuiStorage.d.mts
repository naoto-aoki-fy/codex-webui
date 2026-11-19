import type { PlatformPath } from 'node:path'

export function resolveWebuiStorage(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): {
  config: string
  data: string
  cache: string
  logs: string
}
export function requireConnectionProfile(value?: string): string
export const profileDirectoryPattern: RegExp
export function profileDirectoryName(id: string): string
export function remoteUploadsDirectory(root: string, id: string): string
export const storageNames: Record<'profiles' | 'global' | 'state' | 'modelPreferences' | 'authSessions' |
  'uploads' | 'inventory' | 'journal' | 'inlineMedia' | 'rolloutCache', string>
export function projectPath(path: string): PlatformPath
