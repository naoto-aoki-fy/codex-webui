import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('ships the exact normalizer tested by the probe in the upstream patch', () => {
  const helper = readFileSync(resolve('adapters/codex-0.168.0/responses_compat.rs'), 'utf8')
  const patch = readFileSync(resolve('patches/codex-0.168.0-request-projection.patch'), 'utf8')
  const addition = patch.split('+++ b/codex-rs/core/src/responses_compat.rs\n')[1]!
  const source = addition.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') + '\n'
  expect(source).toBe(helper)
  expect(patch).toContain('input.splice(0..0, prefix)')
})
