import { join } from 'node:path'
import { profileDirectoryName, requireConnectionProfile, resolveWebuiStorage, storageNames } from './webuiStorage.mjs'

export function getConnectionProfileId(value = process.env.CODEXUI_CONNECTION_PROFILE): string {
  return requireConnectionProfile(value)
}

/** Process-wide identity. Change the App Server ID by restarting the backend. */
export function profileStorageDirectory(kind: 'data' | 'cache', id = getConnectionProfileId()): string {
  return join(resolveWebuiStorage()[kind], storageNames.profiles, profileDirectoryName(id))
}
