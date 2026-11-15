import { describe, it, expect } from 'vitest'
import { appendDiagnosticWarning, sanitizedDiagnosticReport, redactDiagnosticText, type DiagnosticWarning } from './diagnostics'
describe('bounded read-only diagnostics', () => {
  it('retains only the latest 20 bounded warnings', () => {
    let rows: DiagnosticWarning[] = []
    for (let i = 0; i < 100; i++) rows = appendDiagnosticWarning(rows, { message: `${i}:` + 'x'.repeat(2000) }, '2026-11-15T00:00:00Z')
    expect(rows).toHaveLength(20); expect(rows[0]?.message).toMatch(/^80:/)
    expect(rows.every(row => row.message.length <= 600)).toBe(true)
  })
  it('redacts warning credentials and excludes every free-form field from reports', () => {
    const secrets = ['Bearer abc123', 'Cookie: session=hello', 'https://user:pass@host/path?token=abcd', 'api_key="mysecret"', 'sk-longkeyvalue']
    for (const secret of secrets) expect(redactDiagnosticText(secret)).not.toContain(secret)
    const report = sanitizedDiagnosticReport({
      connection: 'initialized', platformOs: 'linux', runtimeVersion: 'FAKE-VERSION',
      profile: 'secret-profile', endpoint: secrets[2], env: { KEY: 'secret' }, logs: 'secret',
      capabilities: { 'fs/readFile': { support: 'supported', diagnosis: 'available', detail: 'secret' }, secret: { support: 'supported' } },
    }, [{ message: secrets.join('\n'), atIso: 'secret-time' }])
    for (const secret of [...secrets, 'FAKE-VERSION', 'secret-profile', 'secret-time']) expect(report).not.toContain(secret)
    expect(report).toContain('"runtimeVersion": "unavailable"')
    expect(JSON.parse(report).capabilities['fs/readFile'].support).toBe('supported')
  })
  it('treats absent diagnostics and unknown enum values as unknown', () => {
    const report = JSON.parse(sanitizedDiagnosticReport({ platformOs: 'secret', capabilities: { 'fs/readFile': { support: 'secret' } } }, []))
    expect(report.platform).toBe('unavailable')
    expect(report.capabilities['fs/readFile'].support).toBe('unknown')
    expect(JSON.parse(sanitizedDiagnosticReport(null, [])).connection).toBe('unknown-or-disconnected')
  })
})
