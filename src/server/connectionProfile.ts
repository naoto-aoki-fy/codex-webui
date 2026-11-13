import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Explicit remote identity; an SSH forwarding URL is not a machine identity.
 * Selection is process-wide: restart the backend when changing machines. */
export function getConnectionProfileId(): string {
  const value = process.env.CODEXUI_CONNECTION_PROFILE?.trim() || 'legacy'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) {
    throw new Error('Connection profile must contain 1–80 letters, digits, dots, underscores or hyphens')
  }
  return value
}

/** Existing state belongs exclusively to legacy. No eager copying or destructive
 * migration is needed; named profiles start empty and use the same atomic stores. */
export function profileStateDirectory(stateDirectory: string): string {
  const profile = getConnectionProfileId()
  return profile === 'legacy' ? stateDirectory : join(stateDirectory, 'codexapp-profiles', createHash('sha256').update(profile).digest('hex'))
}
