/** Diagnostic reports intentionally exclude all free-form strings, URLs and paths. */
export type DiagnosticWarning = { atIso: string; message: string }
export const WARNING_LIMIT = 20
export function redactDiagnosticText(value: string): string {
  return value.slice(0, 6000)
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[URL omitted]')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[credential header omitted]')
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, '[credential omitted]')
    .replace(/\b(?:[\w-]*(?:token|secret|password|api[_-]?key|credential)[\w-]*)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[secret omitted]')
    .replace(/\bsk-[\w-]+/g, '[key omitted]')
    .slice(0, 600)
}
export function appendDiagnosticWarning(previous: DiagnosticWarning[], params: unknown, atIso: string): DiagnosticWarning[] {
  const row = params && typeof params === 'object' ? params as Record<string, unknown> : null
  const message = typeof row?.message === 'string' ? redactDiagnosticText(row.message) : 'Runtime warning (message unavailable)'
  return [...previous.slice(-(WARNING_LIMIT - 1)), { atIso: validTime(atIso), message }]
}
function validTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return 'unavailable'
  return Number.isFinite(Date.parse(value)) ? value : 'unavailable'
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
const methods = ['fs/getMetadata', 'fs/readDirectory', 'fs/readFile', 'fs/createDirectory', 'fs/writeFile', 'fuzzyFileSearch', 'command/exec']
const supports = ['supported', 'unsupported', 'unknown']
const diagnoses = ['available', 'unsupported-api', 'missing-path', 'permission', 'transport', 'incompatible-response', 'operation-failed', 'not-observed']
export function sanitizedDiagnosticReport(value: unknown, warnings: DiagnosticWarning[]): string {
  const row = record(value)
  const capabilities = record(row.capabilities)
  return JSON.stringify({
    format: 'codex-webui-diagnostics-v1',
    connection: row.connection === 'initialized' ? 'initialized' : 'unknown-or-disconnected',
    runtimeVersion: 'unavailable',
    platform: ['macos', 'linux', 'windows'].includes(String(row.platformOs)) ? row.platformOs : 'unavailable',
    capabilities: Object.fromEntries(methods.map(method => {
      const entry = record(capabilities[method])
      return [method, {
        support: supports.includes(String(entry.support)) ? entry.support : 'unknown',
        diagnosis: diagnoses.includes(String(entry.diagnosis)) ? entry.diagnosis : 'not-observed',
      }]
    })),
    warnings: warnings.slice(-WARNING_LIMIT).map(warning => ({ kind: 'runtime-warning', atIso: validTime(warning.atIso) })),
    excluded: 'Warning messages, error details, profile names, endpoints, paths, logs, environment, configuration and conversation content are omitted.',
  }, null, 2)
}
