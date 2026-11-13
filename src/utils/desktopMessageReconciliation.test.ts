import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../types/codex'
import {
  areMessageArraysEqual, areMessageFieldsEqual, areStringArraysEqual,
  hasEquivalentUserMessage, hasOptimisticUserMessages, isOptimisticUserMessage,
  mergeMessages, normalizeMessageText, removeRedundantLiveAgentMessages, upsertMessage,
} from './desktopMessageReconciliation'

const message = (overrides: Partial<UiMessage> = {}): UiMessage => ({
  id: 'a', role: 'user', text: 'prompt', ...overrides,
})
const optimistic = (overrides: Partial<UiMessage> = {}) =>
  message({ messageType: 'userMessage.optimistic', ...overrides })

describe('desktop message reconciliation', () => {
  it('reuses equal message objects and arrays, including empty arrays', () => {
    const original = message()
    const previous = [original]
    expect(mergeMessages(previous, [{ ...original }])).toBe(previous)
    expect(mergeMessages(previous, [{ ...original }])[0]).toBe(original)
    expect(mergeMessages(previous, [{ ...original }], { preserveMissing: true })).toBe(previous)
    expect(upsertMessage(previous, { ...original })).toBe(previous)
    const empty: UiMessage[] = []
    expect(mergeMessages(empty, [])).toBe(empty)
    expect(areMessageArraysEqual(previous, [{ ...original }])).toBe(false)
    expect(areMessageArraysEqual(previous, [original])).toBe(true)
    expect(areMessageArraysEqual(previous, [])).toBe(false)
  })

  it.each([
    { submittedAt: 'submitted' }, { completedAt: 'completed' },
    { importMetadata: { source: 'source-thread (provider / model)' } },
    { generationMetadata: { model: 'new-model' } },
    { generationMetadata: { effort: 'high' } },
    { generationMetadata: { modelSource: 'execution' } },
    { generationMetadata: { effortSource: 'execution' } },
    { turnId: 'turn' }, { turnIndex: 1 }, { isAutomationRun: true },
    { automationDisplayName: 'automation' }, { rawPayload: '{}' }, { isUnhandled: true },
  ] satisfies Partial<UiMessage>[])('replaces metadata-only changes: %j', (change) => {
    const previous = [message()]
    const incoming = message(change)
    expect(areMessageFieldsEqual(previous[0], incoming)).toBe(false)
    expect(mergeMessages(previous, [incoming])[0]).toBe(incoming)
    expect(upsertMessage(previous, incoming)[0]).toBe(incoming)
  })

  it('compares images and file changes by their existing fields', () => {
    const original = message({
      images: ['image'],
      fileChanges: [{ path: 'a.ts', operation: 'update', diff: '+a', addedLineCount: 1, removedLineCount: 0 }],
    })
    const clone = { ...original, images: ['image'], fileChanges: original.fileChanges!.map((file) => ({ ...file })) }
    expect(areMessageFieldsEqual(original, clone)).toBe(true)
    expect(areMessageFieldsEqual(original, { ...clone, images: ['other'] })).toBe(false)
    expect(areMessageFieldsEqual(original, { ...clone, fileChanges: [] })).toBe(false)
    expect(areMessageFieldsEqual(original, { ...clone, fileChanges: [{ ...clone.fileChanges[0], diff: '+b' }] })).toBe(false)
    expect(areMessageFieldsEqual(message(), message({ fileChanges: [] }))).toBe(false)
    // File attachments and skills are intentionally absent from field equality.
    expect(areMessageFieldsEqual(message(), message({ fileAttachments: [], skills: [] }))).toBe(true)
  })

  it('matches attachments using image order and file/skill counts, not file contents', () => {
    const target = optimistic({
      images: ['a', 'b'], fileAttachments: [{ label: 'a', path: '/a' }],
      skills: [{ name: 'skill', path: '/skill' }],
    })
    const server = message({ ...target, id: 'server', messageType: undefined, text: ' prompt ',
      fileAttachments: [{ label: 'b', path: '/b' }] })
    expect(hasEquivalentUserMessage(target, [server])).toBe(true)
    expect(hasEquivalentUserMessage(target, [{ ...server, images: ['b', 'a'] }])).toBe(false)
    expect(hasEquivalentUserMessage(target, [{ ...server, fileAttachments: [] }])).toBe(false)
    expect(hasEquivalentUserMessage(target, [{ ...server, skills: [] }])).toBe(false)
  })

  it('retains duplicate optimistic submissions until an equivalent server entry exists', () => {
    const first = optimistic()
    const second = optimistic({ id: 'b' })
    const previous = [first, second]
    expect(isOptimisticUserMessage(first)).toBe(true)
    expect(hasOptimisticUserMessages(previous)).toBe(true)
    expect(hasEquivalentUserMessage(first, previous)).toBe(false)
    expect(mergeMessages(previous, [], { preserveMissing: true })).toBe(previous)
    const server = message({ id: 'server' })
    // The existing content fallback removes both pending copies.
    expect(mergeMessages(previous, [server], { preserveMissing: true })).toEqual([server])
  })

  it('keeps repeated prompts in separate turns and prefers turn identity over content', () => {
    const target = optimistic({ turnId: 'new', turnIndex: 1 })
    expect(hasEquivalentUserMessage(target, [message({ turnId: 'old', turnIndex: 0 })])).toBe(false)
    const accepted = message({ id: 'server', turnId: 'new', text: 'rewritten attachment prompt' })
    expect(mergeMessages([target], [accepted], { preserveMissing: true })).toEqual([accepted])
    expect(hasEquivalentUserMessage(optimistic({ turnIndex: 1 }), [message({ turnIndex: 0 })])).toBe(false)
    expect(hasEquivalentUserMessage(optimistic({ turnIndex: 1 }), [message()])).toBe(true)
  })

  it('uses incoming order by default and preserves previous order and missing entries on request', () => {
    const a = message()
    const b = message({ id: 'b' })
    const c = message({ id: 'c' })
    const updatedB = { ...b, text: 'updated' }
    expect(mergeMessages([a, b], [updatedB, c])).toEqual([updatedB, c])
    const result = mergeMessages([a, b], [updatedB, c], { preserveMissing: true })
    expect(result).toEqual([a, updatedB, c])
    expect(result[0]).toBe(a)
    expect(result[1]).toBe(updatedB)
    expect(upsertMessage([a, b], c)).toEqual([a, b, c])
    expect(upsertMessage([a, b], updatedB)).toEqual([a, updatedB])
    expect(mergeMessages([a], [message({ id: 'different' })], { preserveMissing: true })).toHaveLength(2)
  })

  it('keeps newer live text against stale prefixes and removes it once history catches up', () => {
    const live = message({ role: 'assistant', text: 'hello world', messageType: 'agentMessage.live', turnId: 'turn' })
    const previous = [live]
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, text: 'hello' }])).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live }])).toEqual([])
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, text: 'hello world continued' }])).toEqual([])
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, id: 'server', text: ' hello  world ' }])).toEqual([])
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, id: 'server', turnId: 'other' }])).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, id: 'server', role: 'user' }])).toBe(previous)
    expect(removeRedundantLiveAgentMessages([{ ...live, messageType: undefined }], [{ ...live, id: 'server' }])).toHaveLength(1)
  })

  it('prefers the recovery snapshot when a missing middle delta made the same live item diverge', () => {
    const live = message({ role: 'assistant', text: 'AC', messageType: 'agentMessage.live', turnId: 'turn' })
    const previous = [live]
    const snapshot = [{ ...live, text: 'ABC' }]
    // Ordinary history reads keep their existing reconciliation policy.
    expect(removeRedundantLiveAgentMessages(previous, snapshot)).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, snapshot, { preferSnapshotOnMismatch: false })).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, snapshot, { preferSnapshotOnMismatch: true })).toEqual([])
  })

  it('preserves a genuinely newer live extension during recovery using normalized text', () => {
    const live = message({ role: 'assistant', text: 'hello\n world continued', messageType: 'agentMessage.live', turnId: 'turn' })
    const previous = [live]
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, text: ' hello  world ' }], {
      preferSnapshotOnMismatch: true,
    })).toBe(previous)
  })

  it.each([' hello  world ', 'hello world continued'])('uses a recovery snapshot that covers the live text: %s', (text) => {
    const live = message({ role: 'assistant', text: 'hello\nworld', messageType: 'agentMessage.live', turnId: 'turn' })
    expect(removeRedundantLiveAgentMessages([live], [{ ...live, text }], {
      preferSnapshotOnMismatch: true,
    })).toEqual([])
  })

  it('preserves missing items and the existing cross-ID matching rules during recovery', () => {
    const live = message({ role: 'assistant', text: 'hello world', messageType: 'agentMessage.live', turnId: 'turn' })
    const previous = [live]
    const recovery = { preferSnapshotOnMismatch: true }
    expect(removeRedundantLiveAgentMessages(previous, [], recovery)).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, id: 'other', text: 'different' }], recovery)).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, id: 'other', turnId: 'different' }], recovery)).toBe(previous)
    expect(removeRedundantLiveAgentMessages(previous, [{ ...live, id: 'other', text: ' hello  world ' }], recovery)).toEqual([])
  })

  it('replaces partial plans and commands with incoming completed values without field merging', () => {
    const partial = message({ role: 'assistant', plan: { steps: [{ step: 'work', status: 'inProgress' }], isStreaming: true },
      commandExecution: { command: 'echo done', cwd: null, exitCode: null, status: 'inProgress', aggregatedOutput: 'partial' } })
    const previous = [partial]
    expect(mergeMessages(previous, [structuredClone(partial)])).toBe(previous)
    const completed = message({ role: 'assistant', plan: { steps: [{ step: 'work', status: 'completed' }], isStreaming: false },
      commandExecution: { command: 'echo done', cwd: null, exitCode: null, status: 'completed', aggregatedOutput: 'done' } })
    expect(mergeMessages(previous, [completed])[0]).toBe(completed)
    expect(mergeMessages([completed], [partial])[0]).toBe(partial)
  })

  it('preserves incomplete input fallbacks and whitespace handling', () => {
    expect(normalizeMessageText(' a\n b\t ')).toBe('a b')
    expect(areStringArraysEqual(undefined, [])).toBe(true)
    const malformed = message({ images: null, skills: null, fileAttachments: null } as unknown as Partial<UiMessage>)
    expect(areMessageFieldsEqual(malformed, message())).toBe(true)
    expect(hasEquivalentUserMessage(optimistic(), [malformed])).toBe(true)
    expect(hasEquivalentUserMessage(message({ role: 'assistant' }), [message()])).toBe(false)
    const blankLive = [message({ role: 'assistant', text: ' ', messageType: 'agentMessage.live' })]
    expect(removeRedundantLiveAgentMessages(blankLive, [message({ id: 'other', role: 'assistant', text: '' })])).toBe(blankLive)
    const missingText = message({ text: undefined } as unknown as Partial<UiMessage>)
    expect(() => hasEquivalentUserMessage(missingText, [message()])).toThrow(TypeError)
  })
})
