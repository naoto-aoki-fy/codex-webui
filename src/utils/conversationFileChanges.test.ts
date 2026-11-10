import { describe, expect, it } from 'vitest'
import type { UiFileChange, UiMessage } from '../types/codex'
import { indexConversationFileChanges } from './conversationFileChanges'

const change = (path = 'a.ts', overrides: Partial<UiFileChange> = {}): UiFileChange => ({
  path, operation: 'update', diff: '+a', addedLineCount: 1, removedLineCount: 0, ...overrides,
})
const assistant = (id: string, overrides: Partial<UiMessage> = {}): UiMessage => ({
  id, role: 'assistant', text: 'Done', turnIndex: 1, turnId: 'turn-1', ...overrides,
})
const metadata = (id: string, overrides: Partial<UiMessage> = {}): UiMessage => ({
  id, role: 'system', text: '', messageType: 'fileChange', fileChangeStatus: 'completed',
  fileChanges: [change()], turnIndex: 1, ...overrides,
})

describe('indexConversationFileChanges', () => {
  it('keeps assistant summaries on every eligible message, with metadata overriding only the last anchor', () => {
    const result = indexConversationFileChanges([
      assistant('first', { fileChanges: [change('first.ts')] }),
      metadata('m1', { turnId: '', fileChanges: [change('meta.ts')] }),
      metadata('m2', { turnId: 'metadata-turn', fileChanges: [change('other.ts')] }),
      assistant('last', { fileChanges: [change('assistant.ts')] }),
    ])
    expect(Object.keys(result.anchored)).toEqual(['last', 'first'])
    expect(result.anchored.first).toEqual({ changes: [change('first.ts')], source: 'assistant', sourceMessageIds: [], turnId: 'turn-1' })
    expect(result.anchored.last).toEqual({ changes: [change('meta.ts'), change('other.ts')], source: 'metadata', sourceMessageIds: ['m1', 'm2'], turnId: 'metadata-turn' })
    expect(result.standalone).toEqual({})
    expect([...result.hiddenMessageIds]).toEqual(['m1', 'm2'])
  })

  it('falls back only to the selected assistant summary turn ID', () => {
    expect(indexConversationFileChanges([metadata('m'), assistant('a', { fileChanges: [change()] })]).anchored.a.turnId).toBe('turn-1')
    expect(indexConversationFileChanges([metadata('m'), assistant('a')]).anchored.a.turnId).toBe('')
    expect(indexConversationFileChanges([assistant('a', { fileChanges: [change()], turnId: undefined })]).anchored.a.turnId).toBe('')
  })

  it('uses the last standalone row and preserves empty versus missing turn IDs', () => {
    const messages = [metadata('m1', { turnId: 'first' }), metadata('m2', { turnId: '' })]
    const result = indexConversationFileChanges(messages)
    expect(Object.keys(result.standalone)).toEqual(['m2'])
    expect(result.standalone.m2.turnId).toBe('')
    expect(result.standalone.m2.sourceMessageIds).toEqual(['m1', 'm2'])
    expect([...result.hiddenMessageIds]).toEqual(['m1'])
    expect(indexConversationFileChanges([messages[0]!, metadata('m2')]).standalone.m2.turnId).toBe('first')
  })

  it('groups by numeric index rather than turn ID and isolates missing indices', () => {
    const result = indexConversationFileChanges([
      assistant('no-index', { turnIndex: undefined, fileChanges: [change()] }),
      metadata('m1', { turnIndex: undefined, turnId: 'same' }),
      metadata('m2', { turnIndex: undefined, turnId: 'same' }),
      metadata('m3', { turnIndex: 2, turnId: 'same' }),
      metadata('m4', { turnIndex: 3, turnId: 'same' }),
    ])
    expect(result.anchored).toEqual({})
    expect(Object.keys(result.standalone)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(result.hiddenMessageIds.size).toBe(0)
  })

  it('preserves aggregation, move identity, operation ranking, diff order and counts without mutation', () => {
    const messages = [metadata('m', { fileChanges: [
      change('z', { operation: 'delete' }),
      change('b', { movedToPath: 'c', diff: 'first' }),
      change('b', { movedToPath: 'd' }),
      change('b', { movedToPath: 'c', diff: 'second', removedLineCount: 2 }),
      change('a', { operation: 'delete', diff: '' }),
      change('a', { operation: 'add' }),
      change('c', { operation: 'delete' }),
      change('c', { operation: 'update' }),
    ] })]
    const snapshot = structuredClone(messages)
    for (const message of messages) {
      message.fileChanges!.forEach(Object.freeze)
      Object.freeze(message.fileChanges)
      Object.freeze(message)
    }
    Object.freeze(messages)
    const changes = indexConversationFileChanges(messages).standalone.m.changes
    expect(changes.map((c) => [c.path, c.movedToPath ?? null, c.operation])).toEqual([
      ['a', null, 'add'], ['b', 'c', 'update'], ['b', 'd', 'update'], ['c', null, 'delete'], ['z', null, 'delete'],
    ])
    expect(changes[1]).toEqual(change('b', { movedToPath: 'c', diff: 'first\nsecond', addedLineCount: 2, removedLineCount: 2 }))
    expect(changes[0]!.diff).toBe('+a')
    expect(changes[3]!.diff).toBe('+a')
    expect(messages).toEqual(snapshot)
    expect(changes[4]).not.toBe(messages[0]!.fileChanges![0])
  })

  it('ignores incomplete metadata and excludes command, worked and live assistant anchors', () => {
    const result = indexConversationFileChanges([
      metadata('pending', { fileChangeStatus: 'inProgress' }),
      metadata('failed', { fileChangeStatus: 'failed' }),
      metadata('empty', { fileChanges: [] }),
      metadata('missing', { fileChanges: undefined }),
      metadata('valid'),
      assistant('worked', { messageType: 'worked' }),
      assistant('live', { messageType: 'agentMessage.live' }),
      assistant('command', { messageType: 'commandExecution', commandExecution: {} as UiMessage['commandExecution'] }),
    ])
    expect(result.anchored).toEqual({})
    expect(Object.keys(result.standalone)).toEqual(['valid'])
    expect(indexConversationFileChanges([metadata('m'), assistant('partial-command', { messageType: 'commandExecution' })]).anchored['partial-command']).toBeDefined()
  })

  it('returns fresh, stable results for repeated calculations and empty inputs', () => {
    const messages = [assistant('a', { fileChanges: [change()] })]
    const first = indexConversationFileChanges(messages)
    expect(indexConversationFileChanges(messages)).toEqual(first)
    expect(indexConversationFileChanges(messages).anchored.a.changes).not.toBe(first.anchored.a.changes)
    expect(indexConversationFileChanges([])).toEqual({ anchored: {}, standalone: {}, hiddenMessageIds: new Set() })
  })
})
