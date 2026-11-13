/** Evidence from this connection, never a version or the bundled method catalog. */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown'
export type CapabilityDiagnosis = 'available' | 'unsupported-api' | 'missing-path' | 'permission' | 'transport' | 'incompatible-response' | 'operation-failed' | 'not-observed'
export type CapabilityEvidence = { support: CapabilitySupport; diagnosis: CapabilityDiagnosis; detail: string }
export const WORKFLOW_CAPABILITIES = {
  conversation: ['fs/getMetadata'], browsing: ['fs/getMetadata', 'fs/readDirectory'],
  filePreview: ['fs/readFile'], uploads: ['fs/createDirectory', 'fs/writeFile'],
  fileSearch: ['fuzzyFileSearch'], git: ['command/exec'],
} as const
const methods = new Set<string>(Object.values(WORKFLOW_CAPABILITIES).flat())
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null }
export function classifyCapabilityError(error: unknown): CapabilityEvidence {
  const row = record(error)
  const detail = error instanceof Error ? error.message : String(error)
  const code = row?.code
  if (code === -32601) return { support: 'unsupported', diagnosis: 'unsupported-api', detail }
  const diagnosis: CapabilityDiagnosis = /permission denied|access denied|EACCES|EPERM/iu.test(detail) ? 'permission'
    : /ENOENT|not found|does not exist/iu.test(detail) ? 'missing-path'
    : /disconnect|socket|transport|deadline|timeout|connect/iu.test(detail) ? 'transport'
    : /invalid .*response|incompatible/iu.test(detail) ? 'incompatible-response' : 'operation-failed'
  return { support: 'unknown', diagnosis, detail }
}
function validResponse(method: string, value: unknown): boolean {
  const row = record(value)
  if (!row) return false
  switch (method) {
    case 'fs/getMetadata': return typeof row.isFile === 'boolean' && typeof row.isDirectory === 'boolean' && typeof row.isSymlink === 'boolean'
    case 'fs/readDirectory': return Array.isArray(row.entries) && row.entries.every(entry => typeof record(entry)?.fileName === 'string' && typeof record(entry)?.isDirectory === 'boolean')
    case 'fs/readFile': return typeof row.dataBase64 === 'string'
    case 'fuzzyFileSearch': return Array.isArray(row.files)
    case 'command/exec': return typeof row.exitCode === 'number' && typeof row.stdout === 'string' && typeof row.stderr === 'string'
    default: return true
  }
}
export class RemoteCapabilities {
  private probes = new Map<string, Promise<unknown>>()
  coalesceProbe<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.probes.get(key)
    if (existing) return existing as Promise<T>
    const promise = run().finally(() => { if (this.probes.get(key) === promise) this.probes.delete(key) })
    this.probes.set(key, promise)
    return promise
  }
  private evidence = new Map<string, CapabilityEvidence>()
  reset(): void { this.evidence.clear(); this.probes.clear() }
  observe(method: string, result: unknown, error?: unknown): void {
    if (!methods.has(method)) return
    const previous = this.evidence.get(method)
    const next = error !== undefined ? classifyCapabilityError(error)
      : validResponse(method, result) ? { support: 'supported' as const, diagnosis: 'available' as const, detail: 'Observed a valid response on this connection.' }
        : { support: 'unknown' as const, diagnosis: 'incompatible-response' as const, detail: `Invalid ${method} response` }
    // Permission/path errors prove neither absence nor availability. Retain positive evidence.
    if (next.support === 'unknown' && previous?.support === 'supported' && next.diagnosis !== 'incompatible-response') next.support = 'supported'
    this.evidence.set(method, next)
  }
  snapshot() {
    return Object.fromEntries([...methods].map(method => [method, this.evidence.get(method) ?? { support: 'unknown', diagnosis: 'not-observed', detail: 'No safe observation on this connection. Write APIs are observed only during requested uploads.' }]))
  }
}
