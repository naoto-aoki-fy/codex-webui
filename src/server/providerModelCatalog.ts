import type { ReasoningModel } from '../api/modelCapabilities.js'
import type { CommandExecParams } from './protocol/0.167.2/v2/CommandExecParams.js'
import { asRecord } from './bridgeHttpUtils.js'

export const MODEL_CATALOG_OUTPUT_CAP = 16 * 1024 * 1024
export const MODEL_CATALOG_TIMEOUT_MS = 30_000

// This function only uses the connected remote server. Never spawn a local CLI.
export async function readProviderModelCatalog(
  rpc: (method: string, params: unknown) => Promise<unknown>, provider: string,
): Promise<{ data: ReasoningModel[] }> {
  if (!provider.trim() || /[\r\n\0]/.test(provider)) throw new Error('Invalid provider ID')
  // TOML literals (for example numeric IDs or `true`) must stay strings.
  const override = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(provider) && !['true', 'false', 'inf', 'nan'].includes(provider)
    ? provider : JSON.stringify(provider)
  let result: Record<string, unknown> | null
  try {
    result = asRecord(await rpc('command/exec', {
      command: ['codex', 'debug', 'models', '-c', `model_provider=${override}`],
      timeoutMs: MODEL_CATALOG_TIMEOUT_MS, outputBytesCap: MODEL_CATALOG_OUTPUT_CAP,
      streamStdoutStderr: false, streamStdin: false, tty: false,
    } satisfies CommandExecParams))
  } catch {
    // RPC errors can include captured command output. Never forward it to clients/logs.
    throw new Error('Remote provider catalog command failed or is unsupported')
  }
  if (result?.exitCode !== 0) throw new Error('Remote provider catalog command exited unsuccessfully')
  if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) >= MODEL_CATALOG_OUTPUT_CAP) {
    throw new Error('Remote provider catalog output is missing or truncated')
  }
  let raw: unknown
  try { raw = JSON.parse(result.stdout) } catch { throw new Error('Invalid remote provider catalog JSON') }
  const rows = asRecord(raw)?.models
  if (!Array.isArray(rows)) throw new Error('Invalid remote provider catalog shape')
  const models: ReasoningModel[] = []
  for (const value of rows) {
    const row = asRecord(value)
    if (!row || typeof row.slug !== 'string' || !row.slug.trim()) continue
    const efforts: NonNullable<ReasoningModel['supportedReasoningEfforts']> = []
    for (const item of Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : []) {
      const entry = asRecord(item)
      if (typeof item === 'string') efforts.push(item)
      else if (typeof entry?.effort === 'string') efforts.push({ reasoningEffort: entry.effort,
        ...(typeof entry.description === 'string' ? { description: entry.description } : {}) })
    }
    // Explicit allowlist: instruction templates and other internal data stay on the backend.
    models.push({ id: row.slug.trim(), model: row.slug.trim(), modelProvider: provider,
      ...(typeof row.display_name === 'string' ? { displayName: row.display_name } : {}),
      ...(typeof row.description === 'string' ? { description: row.description } : {}),
      ...(typeof row.visibility === 'string' ? { visibility: row.visibility, hidden: row.visibility !== 'list' } : {}),
      ...(typeof row.priority === 'number' ? { priority: row.priority } : {}),
      supportedReasoningEfforts: efforts,
      ...(typeof row.default_reasoning_level === 'string' ? { defaultReasoningEffort: row.default_reasoning_level } : {}),
    })
  }
  if (!models.length) throw new Error('Remote provider catalog is empty')
  return { data: models }
}
