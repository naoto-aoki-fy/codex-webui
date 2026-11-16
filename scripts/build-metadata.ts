import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function getBuildMetadata() {
  let commitSha = process.env.GITHUB_SHA?.trim() || ''
  if (!commitSha) {
    try {
      commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim()
    } catch {
      // Source archives and build environments without Git are supported.
    }
  }

  return {
    commitSha: commitSha || 'Unknown',
    timestamp: new Date().toISOString(),
  }
}
