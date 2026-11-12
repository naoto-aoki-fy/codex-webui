import { describe, expect, it } from 'vitest'
import type { RpcNotification } from '../api/codexGateway'
import * as readers from './desktopNotificationReaders'

const notification = (method: string, params: unknown = null): RpcNotification => ({ method, params, atIso: '2026-11-11T00:00:00Z' })
const item = (type: string, fields: Record<string, unknown> = {}, method = 'item/completed') =>
  notification(method, { threadId: 'thread', item: { type, id: 'item', ...fields } })
const breakdown = { totalTokens: 20, inputTokens: 10, cachedInputTokens: 2, outputTokens: 8, reasoningOutputTokens: 4 }

describe('desktop notification readers compatibility', () => {
  it('keeps record identity and primitive validation without coercion', () => {
    const record = { nested: {} }
    expect(readers.asRecord(record)).toBe(record)
    for (const value of [null, undefined, [], 'x', 1, false]) expect(readers.asRecord(value)).toBeNull()
    expect(readers.readString(' ')).toBe(' ')
    expect(readers.readString(1)).toBe('')
    for (const value of ['1', NaN, Infinity, null]) expect(readers.readNumber(value)).toBeNull()
    expect(readers.readNumber(-0.5)).toBe(-0.5)
  })

  it('preserves identifier aliases, priority and untrimmed values', () => {
    for (const params of [{ threadId: 't' }, { thread_id: 't' }, { conversationId: 't' }, { conversation_id: 't' }, { thread: { id: 't' } }, { turn: { threadId: 't' } }, { turn: { thread_id: 't' } }]) {
      expect(readers.extractThreadIdFromNotification(notification('any', params))).toBe('t')
    }
    expect(readers.extractThreadIdFromNotification(notification('', { threadId: ' ', thread_id: 'other' }))).toBe(' ')
    for (const params of [null, [], { thread: [{ id: 'x' }] }, { turn: 'x' }]) expect(readers.extractThreadIdFromNotification(notification('', params))).toBe('')
  })

  it('reads plans with status aliases, empty optional values and fallback statuses', () => {
    const result = readers.readPlanUpdate(notification('turn/plan/updated', {
      thread_id: 't', turn_id: 'u', explanation: ' explain ',
      plan: [{ step: 'first', status: 'completed' }, { step: 'second', status: 'in_progress' }, { step: 'third', status: 'inProgress' }, { step: ' ', status: 'unknown' }, { step: '' }, null, []],
    }))
    expect(result?.message).toEqual({ id: 'u:plan', role: 'assistant', text: 'explain\n- [x] first\n- [~] second\n- [~] third\n- [ ]', messageType: 'plan.live', plan: { explanation: 'explain', isStreaming: true, steps: [{ step: 'first', status: 'completed' }, { step: 'second', status: 'inProgress' }, { step: 'third', status: 'inProgress' }, { step: ' ', status: 'pending' }] } })
    expect(readers.readPlanUpdate(notification('turn/plan/updated', { threadId: 't', turnId: 'u', plan: {}, explanation: '' }))?.message.plan).toEqual({ explanation: undefined, steps: [], isStreaming: true })
    expect(readers.readPlanUpdate(notification('turn/plan/updated', { threadId: 't' }))).toBeNull()
    expect(readers.readPlanUpdate(notification('item/plan/delta', { threadId: 't', turnId: 'u' }))).toBeNull()
  })

  it('requires every finite token field, accepts snake aliases and preserves notification counts', () => {
    const snake = { total_tokens: 20, input_tokens: 10, cached_input_tokens: 2, output_tokens: 8, reasoning_output_tokens: 4 }
    expect(readers.normalizeTokenUsageBreakdown(snake)).toEqual(breakdown)
    for (const key of Object.keys(breakdown)) {
      for (const value of [undefined, '1', NaN, Infinity, {}]) expect(readers.normalizeTokenUsageBreakdown({ ...breakdown, [key]: value })).toBeNull()
    }
    expect(readers.normalizeTokenUsageBreakdown({ ...snake, totalTokens: 'bad' })).toBeNull()
    expect(readers.normalizeTokenUsageBreakdown({ ...breakdown, totalTokens: -1.5 })?.totalTokens).toBe(-1.5)
    expect(readers.normalizeThreadTokenUsage({ total: breakdown, last: breakdown, model_context_window: 80 })).toEqual({ total: breakdown, last: breakdown, modelContextWindow: 80, currentContextTokens: 20, remainingContextTokens: 60, remainingContextPercent: 75 })
    expect(readers.normalizeThreadTokenUsage({ total: breakdown, last: breakdown, modelContextWindow: 0 })?.remainingContextPercent).toBeNull()
    expect(readers.normalizeThreadTokenUsage({ total: breakdown, last: breakdown })?.remainingContextTokens).toBeNull()
    expect(readers.normalizeThreadTokenUsage({ total: breakdown })).toBeNull()
    const params = { threadId: 't', token_usage: { total: snake, last: snake } }
    expect(readers.readThreadTokenUsageUpdate(notification('thread/tokenUsage/updated', params))?.threadId).toBe('t')
    expect(readers.readThreadTokenUsageUpdate(notification('unknown', params))).toBeNull()
    expect(readers.readThreadTokenUsageUpdate(notification('thread/tokenUsage/updated', { ...params, threadId: '' }))).toBeNull()
  })

  it('reads agent ids, text and deltas without adding metadata', () => {
    expect(readers.readAgentMessageStartedId(item('agentMessage', {}, 'item/started'))).toBe('item')
    expect(readers.readAgentMessageCompleted(item('agentMessage', { text: 'response', metadata: { unexpected: true } }))).toEqual({ id: 'item', role: 'assistant', text: 'response', messageType: 'agentMessage.live' })
    expect(readers.readAgentMessageCompleted(item('agentMessage', { text: '' }))).toBeNull()
    expect(readers.readAgentMessageDelta(notification('item/agentMessage/delta', { itemId: 'i', delta: ' ' }))).toEqual({ messageId: 'i', delta: ' ' })
    expect(readers.isAgentContentEvent(item('agentMessage'))).toBe(true)
    expect(readers.isAgentContentEvent(item('commandExecution'))).toBe(false)
  })

  it('preserves reasoning aliases and missing-id completion fallback', () => {
    for (const method of ['item/reasoning/summaryTextDelta', 'item/reasoning/textDelta']) expect(readers.readReasoningDelta(notification(method, { itemId: 'r', delta: 'text' }))).toEqual({ messageId: 'r:live-reasoning', delta: 'text' })
    expect(readers.readReasoningStartedItemId(item('reasoning', {}, 'item/started'))).toBe('item')
    expect(readers.readReasoningCompletedId(item('reasoning', { id: undefined }))).toBe(':live-reasoning')
    expect(readers.readReasoningSectionBreakMessageId(notification('item/reasoning/summaryPartAdded', { itemId: 'r' }))).toBe('r:live-reasoning')
  })

  it('reads command deltas and activity without changing command completion state', () => {
    expect(readers.readCommandOutputDelta(notification('item/commandExecution/outputDelta', { itemId: 'c', delta: 'out' }))).toEqual({ itemId: 'c', delta: 'out' })
    expect(readers.readCommandOutputDelta(notification('item/commandExecution/outputDelta', { itemId: 'c', delta: '' }))).toBeNull()
    expect(readers.readTurnActivity(item('commandExecution', { command: 'pwd' }, 'item/started'))?.activity).toEqual({ label: 'Running command', details: ['pwd'] })
    expect(readers.readTurnActivity(item('fileChange', { changes: [{ path: '/tmp/a b' }] }, 'item/started'))?.activity).toEqual({ label: 'Applying changes', details: ['/tmp/a b'] })
  })

  it('preserves approval method aliases and shape-based precedence', () => {
    for (const method of ['execCommandApproval', 'exec_approval_request']) expect(readers.normalizePendingServerRequestMethod(method, null)).toBe('item/commandExecution/requestApproval')
    for (const method of ['applyPatchApproval', 'apply_patch_approval_request']) expect(readers.normalizePendingServerRequestMethod(method, null)).toBe('item/fileChange/requestApproval')
    expect(readers.normalizePendingServerRequestMethod('request_user_input', null)).toBe('item/tool/requestUserInput')
    expect(readers.normalizePendingServerRequestMethod('elicitation_request', null)).toBe('mcpServer/elicitation/request')
    expect(readers.normalizePendingServerRequestMethod('dynamic_tool_call_request', null)).toBe('item/tool/call')
    expect(readers.normalizePendingServerRequestMethod('unknown', { command: ['pwd'], questions: [] })).toBe('item/commandExecution/requestApproval')
    expect(readers.normalizePendingServerRequestMethod(' unknown ', {})).toBe('unknown')
    expect(readers.normalizePendingServerRequestMethod(' ', { command: 'pwd' })).toBe('')
  })

  it('keeps image aliases, encoded paths and permissive base64 fallback', () => {
    const path = '/tmp/a b#image.png'
    expect(readers.readCompletedImageView(item('imageView', { path }))?.images).toEqual([`/codex-local-image?path=${encodeURIComponent(path)}`])
    expect(readers.extractLocalImagePathFromUrl(readers.toLocalImageUrl(path))).toBe(path)
    expect(readers.extractLocalImagePathFromUrl('/other?path=x')).toBe('')
    for (const type of ['imageGeneration', 'image_generation']) expect(readers.readCompletedImageView(item(type, { result: ' YW Jj\n ' }))?.images).toEqual(['data:image/png;base64,YWJj'])
    for (const url of ['data:x', 'http://x', 'https://x', '/codex-local-image?path=x']) expect(readers.toImageGenerationUrl(` ${url} `)).toBe(url)
    for (const result of ['', '/tmp/image.png', {}, []]) expect(readers.readCompletedImageView(item('imageGeneration', { result }))).toBeNull()
  })

  it('preserves error fallbacks and retry flags', () => {
    expect(readers.readTurnErrorMessage(notification('turn/completed', { turn: { status: 'failed', error: { message: 'failed' } } }))).toBe('failed')
    expect(readers.readNotificationErrorState(notification('error', { message: '', error: { message: 'nested' }, willRetry: true }))).toEqual({ message: 'nested', transient: true })
    expect(readers.readNotificationErrorState(notification('error', { message: 'x', willRetry: 'true' }))).toEqual({ message: 'x', transient: false })
  })

  it('rejects unknown methods and malformed nested payloads', () => {
    const nullable = [readers.readPlanUpdate, readers.readThreadTokenUsageUpdate, readers.readNotificationErrorState, readers.readTurnActivity, readers.readReasoningDelta, readers.readAgentMessageDelta, readers.readAgentMessageCompleted, readers.readCompletedImageView, readers.readCommandOutputDelta]
    for (const read of nullable) for (const params of [null, [], { item: [] }, { item: { type: {} } }]) expect(read(notification('unknown', params))).toBeNull()
  })
})

it('preserves generated web asset URLs in notification image readers', () => {
  expect(readers.toLocalImageUrl('/codex-app-asset?id=image.png')).toBe('/codex-app-asset?id=image.png')
})
