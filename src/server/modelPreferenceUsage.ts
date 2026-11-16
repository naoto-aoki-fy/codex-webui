import type { ModelSettings } from '../modelPreferences.js'
import { asRecord } from './bridgeHttpUtils.js'
import type { ModelPreferencesStore } from './modelPreferencesStore.js'

/** Request settings are preference evidence after acceptance, never CAP-003 metadata. */
export function createModelPreferenceUsage(store: ModelPreferencesStore) {
  const threads = new Map<string, { provider: string; model: string; effort: string }>()
  const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
  function observe(method: string, result: unknown) {
    if (!['thread/start', 'thread/resume', 'thread/read', 'thread/fork'].includes(method)) return
    const r = asRecord(result), t = asRecord(r?.thread)
    const id = text(t?.id), provider = text(r?.modelProvider) || text(t?.modelProvider)
    if (!id || !provider) return
    threads.delete(id)
    threads.set(id, { provider, model: text(r?.model) || text(t?.model), effort: text(r?.reasoningEffort) })
    if (threads.size > 1000) threads.delete(threads.keys().next().value!)
  }
  async function accepted(params: unknown, result: unknown, rpc: (method: string, params: unknown) => Promise<unknown>) {
    const p = asRecord(params), turn = asRecord(asRecord(result)?.turn)
    const threadId = text(p?.threadId), turnId = text(turn?.id)
    if (!threadId || !turnId) return null
    if (!threads.has(threadId)) observe('thread/read', await rpc('thread/read', { threadId, includeTurns: false }))
    const thread = threads.get(threadId)
    if (!thread) throw new Error('Accepted model usage could not resolve the thread provider')
    const collaboration = asRecord(p?.collaborationMode), modeSettings = asRecord(collaboration?.settings)
    const used: ModelSettings = {
      providerId: thread.provider,
      modelId: text(modeSettings?.model) || text(p?.model) || thread.model,
      reasoningEffort: modeSettings && Object.prototype.hasOwnProperty.call(modeSettings, 'reasoning_effort') ? text(modeSettings.reasoning_effort)
        : p && Object.prototype.hasOwnProperty.call(p, 'effort') ? text(p.effort) : thread.effort,
      collaborationMode: collaboration?.mode === 'plan' ? 'plan' : 'default',
    }
    const state = await store.recordUsage(used, threadId, turnId)
    thread.model = used.modelId; thread.effort = used.reasoningEffort
    return state
  }
  return { observe, accepted }
}
