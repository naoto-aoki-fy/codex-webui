import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Web-owned presentation data has a separate namespace from project paths.
export const inlineMediaDirectory = () => join(tmpdir(), 'codex-web-inline-media')
export function inlineAssetPath(id: string): string | null {
  return /^[a-zA-Z0-9_.-]+$/u.test(id) && id !== '.' && id !== '..'
    ? join(inlineMediaDirectory(), id) : null
}
