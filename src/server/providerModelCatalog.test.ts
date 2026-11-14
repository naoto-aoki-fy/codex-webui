import { expect, it, vi } from 'vitest'
import { readProviderModelCatalog, MODEL_CATALOG_OUTPUT_CAP } from './providerModelCatalog'

const raw = { models: [{ slug: 'same', display_name: 'Shared', description: 'Description', visibility: 'list', priority: 1,
  default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'high', description: 'More thinking' }, 'low'],
  base_instructions: 'PRIVATE TEMPLATE', model_messages: { instructions_template: 'PRIVATE TEMPLATE' } },
{ slug: 'hidden', visibility: 'hide' }, {}, null] }
const result = (stdout = JSON.stringify(raw), exitCode = 0) => ({ stdout, exitCode, stderr: 'PRIVATE TEMPLATE' })
it('executes buffered argv remotely and only returns allowed metadata', async () => {
  const rpc = vi.fn().mockResolvedValue(result())
  const catalog = await readProviderModelCatalog(rpc, 'local')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('command/exec', { command: ['codex', 'debug', 'models', '-c', 'model_provider=local'],
    timeoutMs: 30000, outputBytesCap: MODEL_CATALOG_OUTPUT_CAP, tty: false, streamStdin: false, streamStdoutStderr: false })
  expect(catalog.data[0]).toEqual({ id: 'same', model: 'same', modelProvider: 'local', displayName: 'Shared',
    description: 'Description', visibility: 'list', hidden: false, priority: 1, defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'More thinking' }, 'low'] })
  expect(catalog.data[1]).toMatchObject({ id: 'hidden', hidden: true })
  expect(JSON.stringify(catalog)).not.toContain('PRIVATE TEMPLATE')
})
it.each([
  ['missing binary', result('', 127)], ['nonzero', result('', 1)], ['invalid JSON', result('PRIVATE TEMPLATE')],
  ['truncated JSON', result('{"models":[')], ['wrong shape', result('{}')], ['empty', result('{"models":[]}')],
  ['invalid models', result('{"models":[null,{}, {"slug":""}]}')], ['missing output', { exitCode: 0 }],
  ['cap reached', result(' '.repeat(MODEL_CATALOG_OUTPUT_CAP))],
])('rejects %s without leaking captured output', async (_name, value) => {
  await expect(readProviderModelCatalog(vi.fn().mockResolvedValue(value), 'local')).rejects.toThrow(/Remote|remote|Invalid/)
})
it.each(['method not found PRIVATE TEMPLATE', 'timeout PRIVATE TEMPLATE'])('sanitizes RPC failures: %s', async message => {
  await expect(readProviderModelCatalog(vi.fn().mockRejectedValue(new Error(message)), 'local'))
    .rejects.toThrow('Remote provider catalog command failed or is unsupported')
})

it.each(['true', '123', 'a"b', 'with space'])('preserves provider ID %s as a string config override', async provider => {
  const rpc = vi.fn().mockResolvedValue(result())
  await readProviderModelCatalog(rpc, provider)
  expect(rpc.mock.calls[0]?.[1].command[4]).toBe(`model_provider=${JSON.stringify(provider)}`)
})

it('preserves provider-declared defaults and model defaults without copying private metadata', async () => {
  const catalog = await readProviderModelCatalog(vi.fn().mockResolvedValue(result(JSON.stringify({ ...raw, default_model: 'same', models: [{ ...raw.models[0], is_default: true }] }))), 'Q')
  expect(catalog.data[0]).toMatchObject({ modelProvider: 'Q', providerDefaultModel: 'same', isDefault: true })
  expect(JSON.stringify(catalog)).not.toContain('PRIVATE TEMPLATE')
})
