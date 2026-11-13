import { describe, expect, it } from 'vitest'
import { classifyCapabilityError, RemoteCapabilities } from './remoteCapabilities.js'

describe('remote capability evidence', () => {
  it('only JSON-RPC method-not-found confirms unsupported', () => {
    expect(classifyCapabilityError(Object.assign(new Error('Method not found'), { code: -32601 }))).toMatchObject({ support: 'unsupported', diagnosis: 'unsupported-api' })
    for (const [message, diagnosis] of [['ENOENT: directory not found', 'missing-path'], ['EACCES permission denied', 'permission'], ['socket disconnected', 'transport'], ['deadline exceeded', 'transport'], ['Method not found', 'missing-path']]) {
      expect(classifyCapabilityError(new Error(message))).toMatchObject({ support: 'unknown', diagnosis })
    }
  })
  it('validates actual responses and resets evidence per generation', () => {
    const capabilities = new RemoteCapabilities()
    expect(capabilities.snapshot()['fs/writeFile']?.support).toBe('unknown')
    capabilities.observe('fs/getMetadata', { isFile: false, isDirectory: true, isSymlink: false })
    expect(capabilities.snapshot()['fs/getMetadata']?.support).toBe('supported')
    capabilities.observe('fs/getMetadata', undefined, new Error('EACCES'))
    expect(capabilities.snapshot()['fs/getMetadata']).toMatchObject({ support: 'supported', diagnosis: 'permission' })
    capabilities.observe('fs/getMetadata', { directory: true })
    expect(capabilities.snapshot()['fs/getMetadata']).toMatchObject({ support: 'unknown', diagnosis: 'incompatible-response' })
    capabilities.reset()
    expect(capabilities.snapshot()['fs/getMetadata']?.support).toBe('unknown')
  })
  it('does not infer optional write or Git support from metadata', () => {
    const capabilities = new RemoteCapabilities()
    capabilities.observe('fs/getMetadata', { isFile: false, isDirectory: true, isSymlink: false })
    expect(capabilities.snapshot()['fs/writeFile']?.support).toBe('unknown')
    expect(capabilities.snapshot()['command/exec']?.support).toBe('unknown')
    capabilities.observe('command/exec', { exitCode: 127, stdout: '', stderr: 'git not found' })
    expect(capabilities.snapshot()['command/exec']?.support).toBe('supported')
  })
})
