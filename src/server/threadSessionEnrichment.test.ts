import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const fs = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }))
vi.mock('node:fs/promises', async original => ({ ...await original<object>(), ...fs }))
let module: typeof import('./threadSessionEnrichment.js')
let api: ReturnType<typeof module.createThreadSessionEnrichment>
const store = { mergeIntoTurns: vi.fn(async (_id: string, turns: unknown[], _execution: unknown) => turns), saveMany: vi.fn(async () => {}) }
const row = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + '\n'
const skill = row('turn_context', { turn_id: 't', model: 'model-a' }) + row('response_item', {
  type: 'message', role: 'user', content: [{ type: 'input_text', text: '<skill><name>Example</name><path>/skills/example</path></skill>' }],
})
const result = (id = 'fork', path = '/session') => ({ thread: { id, path, turns: [{ id: 't', items: [{ type: 'userMessage', content: [] }] }] } })
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  fs.stat.mockResolvedValue({ size: 100, mtimeMs: 1, dev: 1, ino: 1 })
  fs.readFile.mockResolvedValue(skill)
  module = await import('./threadSessionEnrichment.js')
  api = module.createThreadSessionEnrichment(store)
})
afterEach(() => vi.restoreAllMocks())

it('recovers skills and generation evidence while skipping malformed records', async () => {
  fs.readFile.mockResolvedValue('invalid\n' + skill + '{partial')
  const enriched = await api.mergeSessionSkillInputsIntoThreadResult(result())
  expect(enriched).toMatchObject({ thread: { turns: [{ items: [{ content: [{ type: 'skill', name: 'Example', path: '/skills/example' }] }] }] } })
  expect(store.mergeIntoTurns.mock.calls[0]?.[2]).toEqual(new Map([['t', { model: 'model-a', modelSource: 'execution' }]]))
})
it('uses submitted metadata when files are missing and leaves empty results intact', async () => {
  fs.stat.mockRejectedValue(new Error('ENOENT'))
  const input = result()
  expect(await api.mergeSessionSkillInputsIntoThreadResult(input)).toEqual(input)
  expect(store.mergeIntoTurns).toHaveBeenCalled()
  const empty = { thread: { id: 'empty', turns: [] } }
  expect(await api.mergeSessionSkillInputsIntoThreadResult(empty)).toBe(empty)
})
it('hits by path/size/mtime and invalidates on size or mtime changes', async () => {
  await api.mergeSessionSkillInputsIntoThreadResult(result())
  await api.mergeSessionSkillInputsIntoThreadResult(result())
  expect(fs.readFile).toHaveBeenCalledTimes(1)
  fs.stat.mockResolvedValue({ size: 101, mtimeMs: 1, dev: 1, ino: 1 })
  await api.mergeSessionSkillInputsIntoThreadResult(result())
  fs.stat.mockResolvedValue({ size: 101, mtimeMs: 2, dev: 1, ino: 1 })
  await api.mergeSessionSkillInputsIntoThreadResult(result())
  expect(fs.readFile).toHaveBeenCalledTimes(3)
  expect(fs.stat).toHaveBeenCalledTimes(4)
})
it('evicts the oldest of 64 paths without refreshing insertion order on hits', async () => {
  for (let i = 0; i < 64; i++) await api.mergeSessionSkillInputsIntoThreadResult(result('id', `/s${i}`))
  await api.mergeSessionSkillInputsIntoThreadResult(result('id', '/s0'))
  expect(fs.readFile).toHaveBeenCalledTimes(64)
  await api.mergeSessionSkillInputsIntoThreadResult(result('id', '/s64'))
  await api.mergeSessionSkillInputsIntoThreadResult(result('id', '/s1'))
  expect(fs.readFile).toHaveBeenCalledTimes(65)
  await api.mergeSessionSkillInputsIntoThreadResult(result('id', '/s0'))
  expect(fs.readFile).toHaveBeenCalledTimes(66)
})
it('preserves skill identity and targets the last user message without duplicates', () => {
  const input = result().thread.turns
  const enriched = module.mergeSessionSkillInputsIntoTurns(input, skill)
  expect(module.mergeSessionSkillInputsIntoTurns(enriched, skill)).toBe(enriched)
  expect(module.mergeSessionSkillInputsIntoTurns(input, 'malformed')).toBe(input)
})
it('deduplicates concurrent fork recovery and tracks successful recovery across factories', async () => {
  let release!: (value: unknown) => void
  const rpc = vi.fn(() => new Promise(resolve => { release = resolve }))
  const input = result()
  const first = api.recoverForkMetadata({ rpc }, input, 'parent')
  const second = api.recoverForkMetadata({ rpc }, input, 'parent')
  release(result('parent'))
  await first
  expect(await second).toBe(input)
  await module.createThreadSessionEnrichment(store).recoverForkMetadata({ rpc }, input, 'parent')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/read', { threadId: 'parent', includeTurns: true })
  expect(store.saveMany).toHaveBeenCalledTimes(1)
})
it('retains the original response after failure and retries only after 30 seconds', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const rpc = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result('parent'))
  const input = result()
  expect(await api.recoverForkMetadata({ rpc }, input, 'parent')).toBe(input)
  await api.recoverForkMetadata({ rpc }, input, 'parent')
  expect(rpc).toHaveBeenCalledTimes(1)
  now.mockReturnValue(31000)
  await api.recoverForkMetadata({ rpc }, input, 'parent')
  expect(rpc).toHaveBeenCalledTimes(2)
})
it.each(['forked_from_id', 'forkedFromId'])('reads explicit %s parents but ignores subagent parent metadata', async key => {
  fs.readFile.mockResolvedValue(row('session_meta', { parent_thread_id: 'agent', [key]: 'parent' }))
  const rpc = vi.fn().mockResolvedValue(result('parent'))
  await api.recoverForkMetadata({ rpc }, result())
  expect(rpc).toHaveBeenCalledWith('thread/read', { threadId: 'parent', includeTurns: true })
})
it('ignores self parents, spawned-agent parents and absent parent metadata', async () => {
  fs.readFile.mockResolvedValue(row('session_meta', { parent_thread_id: 'agent' }))
  const rpc = vi.fn()
  await api.recoverForkMetadata({ rpc }, result())
  await api.recoverForkMetadata({ rpc }, result(), 'fork')
  expect(rpc).not.toHaveBeenCalled()
})
it.each(['success', 'failure'])('bounds %s recovery tracking to 64 entries in insertion order', async mode => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const rpc = vi.fn().mockImplementation(async () => {
    if (mode === 'failure') throw new Error('offline')
    return result('parent')
  })
  for (let i = 0; i < 64; i++) await api.recoverForkMetadata({ rpc }, result(`fork${i}`), 'parent')
  await api.recoverForkMetadata({ rpc }, result('fork0'), 'parent')
  expect(rpc).toHaveBeenCalledTimes(64)
  await api.recoverForkMetadata({ rpc }, result('fork64'), 'parent')
  await api.recoverForkMetadata({ rpc }, result('fork1'), 'parent')
  expect(rpc).toHaveBeenCalledTimes(65)
  await api.recoverForkMetadata({ rpc }, result('fork0'), 'parent')
  expect(rpc).toHaveBeenCalledTimes(66)
})
it('inherits generation metadata while preserving fork message content before persistence', async () => {
  const source = { thread: { id: 'parent', turns: [{ id: 't', generationMetadata: { model: 'source-model', modelSource: 'execution', effort: 'high', effortSource: 'execution' }, items: [{ type: 'userMessage', content: [{ type: 'skill', name: 'Source', path: '/source' }] }] }] } }
  const input = result('fork', '')
  const enriched = await api.recoverForkMetadata({ rpc: vi.fn().mockResolvedValue(source) }, input, 'parent')
  expect(enriched).toMatchObject({ thread: { turns: [{ generationMetadata: { model: 'source-model', effort: 'high' }, items: [{ content: [] }] }] } })
  expect(store.saveMany).toHaveBeenCalledWith('fork', expect.any(Array))
})
