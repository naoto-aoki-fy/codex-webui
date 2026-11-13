import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('loads the public CJS adapter CLI without starting a listener', () => {
  const output = execFileSync(process.execPath, ['adapters/codex-0.168.0/forwarder.cjs', '--help'], { encoding: 'utf8' })
  expect(output).toContain('Responses compatibility adapter:')
  expect(output).toContain('does not change Codex configuration')
  execFileSync(process.execPath, ['--check', 'adapters/codex-0.168.0/verify-live.cjs'])
})
