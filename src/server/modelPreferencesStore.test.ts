import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModelPreferencesStore, modelPreferencesPath } from './modelPreferencesStore'
import { preferenceModelKey as key } from '../modelPreferences'
import { createModelPreferenceUsage } from './modelPreferenceUsage'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'model-preferences-')); vi.stubEnv('CODEX_HOME', home); vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy') })
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) })
const settings = (modelId = 'A', providerId = 'openai') => ({ providerId, modelId, reasoningEffort: 'high', collaborationMode: 'plan' as const })

it('persists accepted settings/counts/UTC timestamps across store recreation without counting selections', async () => {
  const store = new ModelPreferencesStore()
  await store.update({ preferred: settings() })
  expect((await store.read()).modelUsage).toEqual({})
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T01:30:00Z'))
  await store.recordUsage(settings(), 't', '1')
  vi.setSystemTime(new Date('2026-11-16T01:31:00Z'))
  await new ModelPreferencesStore().recordUsage(settings(), 't', '2')
  const restarted = await new ModelPreferencesStore().read()
  expect(restarted.lastUsed).toEqual(settings())
  expect(restarted.modelUsage[key('openai', 'A')]).toEqual({ providerId: 'openai', modelId: 'A', lastUsedAt: '2026-11-16T01:31:00.000Z', usageCount: 2 })
  expect(JSON.parse(await readFile(modelPreferencesPath(), 'utf8')).schemaVersion).toBe(1)
})

it('serializes concurrent clients and field patches without losing increments or independent preferences', async () => {
  const a = new ModelPreferencesStore(), b = new ModelPreferencesStore()
  await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).recordUsage(settings(), 't', String(i))))
  await Promise.all([
    a.update({ reasoning: { providerId: 'openai', modelId: 'B', effort: 'low' } }),
    b.update({ reasoning: { providerId: 'local', modelId: 'B', effort: 'medium' } }),
  ])
  const state = await a.read()
  expect(state.modelUsage[key('openai', 'A')]?.usageCount).toBe(24)
  expect(state.reasoningByModel).toMatchObject({ [key('openai', 'B')]: 'low', [key('local', 'B')]: 'medium' })
  expect(await b.read()).toEqual(state)
})

it('keeps last successful settings distinct from an unused preference change', async () => {
  const store = new ModelPreferencesStore()
  await store.recordUsage(settings('A'), 't', '1')
  await store.update({ preferred: settings('B') })
  expect((await store.read()).lastUsed).toEqual(settings('A'))
  expect((await store.read()).preferred).toEqual(settings('B'))
})

it('isolates connection profiles and provider/model identities including IDs containing slashes', async () => {
  const store = new ModelPreferencesStore()
  await store.recordUsage(settings('b/c', 'a'), 't', '1')
  await store.recordUsage(settings('c', 'a/b'), 't', '2')
  expect(Object.keys((await store.read()).modelUsage)).toHaveLength(2)
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'other')
  expect((await store.read()).preferred).toBeNull()
  await store.recordUsage(settings('other'), 't', '1')
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy')
  expect((await store.read()).lastUsed?.modelId).toBe('c')
})

it.each(['{invalid', 'null', '[]', '{"schemaVersion":1,"preferred":{},"modelUsage":{"bad":{}}}'])('recovers missing/corrupt data safely: %s', async raw => {
  const store = new ModelPreferencesStore()
  expect((await store.read()).preferred).toBeNull()
  await writeFile(modelPreferencesPath(), raw)
  expect((await store.read()).lastUsed).toBeNull()
  await store.recordUsage(settings(), 't', '1')
  expect((await store.read()).modelUsage[key('openai', 'A')]?.usageCount).toBe(1)
})

it('preserves future schemas and rejects invalid writes without corrupting valid data', async () => {
  const store = new ModelPreferencesStore()
  await writeFile(modelPreferencesPath(), '{"schemaVersion":2,"future":true}')
  await expect(store.read()).rejects.toThrow('Unsupported')
  await expect(store.update({ preferred: settings() })).rejects.toThrow('Unsupported')
  expect(await readFile(modelPreferencesPath(), 'utf8')).toContain('"future":true')
  await writeFile(modelPreferencesPath(), '{}')
  await expect(store.update({ preferred: { modelId: 'A' } })).rejects.toThrow('Invalid')
  expect((await store.read()).preferred).toBeNull()
})

it('records accepted effective request settings exactly once, including collaboration mode overrides', async () => {
  const store = new ModelPreferencesStore(), usage = createModelPreferenceUsage(store)
  usage.observe('thread/resume', { thread: { id: 't', modelProvider: 'local' }, model: 'A' })
  const params = { threadId: 't', model: 'A', effort: 'low', collaborationMode: { mode: 'plan', settings: { model: 'B', reasoning_effort: 'high' } } }
  const rpc = vi.fn()
  await usage.accepted(params, { turn: { id: '1' } }, rpc)
  await usage.accepted(params, { turn: { id: '1' } }, rpc)
  await usage.accepted(params, { error: 'rejected' }, rpc)
  expect(rpc).not.toHaveBeenCalled()
  expect((await store.read()).lastUsed).toEqual(settings('B', 'local'))
  expect((await store.read()).modelUsage[key('local', 'B')]?.usageCount).toBe(1)
})

it('resolves a missing thread provider from backend evidence and never guesses the default provider', async () => {
  const store = new ModelPreferencesStore(), usage = createModelPreferenceUsage(store)
  const rpc = vi.fn(async () => ({ thread: { id: 't', modelProvider: 'remote' } }))
  await usage.accepted({ threadId: 't', model: 'A' }, { turn: { id: '1' } }, rpc)
  expect(rpc).toHaveBeenCalledWith('thread/read', { threadId: 't', includeTurns: false })
  expect((await store.read()).lastUsed?.providerId).toBe('remote')
  await expect(usage.accepted({ threadId: 'unknown', model: 'A' }, { turn: { id: '2' } }, vi.fn(async () => ({})))).rejects.toThrow('provider')
  expect(Object.values((await store.read()).modelUsage)).toHaveLength(1)
})
