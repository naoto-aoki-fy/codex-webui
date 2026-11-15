import { describe, expect, it } from 'vitest'
import { normalizeThreadMessagesV2, readThreadInProgressFromResponse } from './v2'
import type { ThreadReadResponse } from '../appServerDtos'

function threadReadResponseWithContent(content: ThreadReadResponse['thread']['turns'][number]['items'][number][]): ThreadReadResponse {
  return {
    readState: null,
    thread: {
      environments: null, extra: null, sessionId: 'session', forkedFromId: null,
      parentThreadId: null, ephemeral: false, section: null, sectionEnteredAt: null,
      projectId: null, historyMode: 'paginated', model: null, reasoningEffort: null,
      recencyAt: null, status: { type: 'idle' }, originator: null,
      canAcceptDirectInput: null, threadSource: null, agentNickname: null,
      agentRole: null, name: null, daybreakEnabled: null,
      id: 'thread-1',
      preview: 'Use a skill',
      modelProvider: 'openai',
      createdAt: 1,
      updatedAt: 2,
      path: null,
      cwd: '/tmp/project',
      cliVersion: 'test',
      source: 'appServer',
      gitInfo: null,
      turns: [{
        id: 'turn-1',
        rootTurnId: null, itemsView: 'full', startedAt: null, completedAt: null, durationMs: null,
        status: 'completed',
        error: null,
        items: content,
      }],
    },
  }
}

describe('normalizeThreadMessagesV2', () => {
  it('preserves imported text, roles, order and internal provenance without display prefixes', () => {
    const transcript = [
      { role: 'user' as const, text: '  Hello\n\nExplain `value`.  ', source: 'source-thread (P / A)' },
      { role: 'assistant' as const, text: 'Hi!\n\n```ts\nconst value = 1\n```\n', source: 'source-thread (P / A)' },
      { role: 'user' as const, text: 'Imported: this is original user-authored text.', source: 'another-source (Q / B)' },
    ]
    const payload = {
      ...threadReadResponseWithContent([{ type: 'agentMessage', phase: null, memoryCitation: null, delivery: null, questions: null, id: 'new-answer', text: 'New native answer' }]),
      importedTranscript: transcript,
      importStage: 'ready',
    }
    const original = JSON.stringify(payload)
    const normalized = normalizeThreadMessagesV2(payload)
    expect(normalized.map(message => message.text)).toEqual([...transcript.map(message => message.text), 'New native answer'])
    expect(normalized.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(normalized.slice(0, 3).map(message => message.importMetadata)).toEqual(transcript.map(message => ({ source: message.source })))
    expect(normalized.slice(0, 3).map(message => message.turnIndex)).toEqual([-1, -2, -3])
    expect(normalized[3]?.importMetadata).toBeUndefined()
    expect(JSON.stringify(payload)).toBe(original)
    // Rehydrating the durable response must not restore generated labels.
    expect(normalizeThreadMessagesV2(JSON.parse(original))).toEqual(normalized)
  })

  it('preserves selected skill inputs on the rendered user message', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage', clientId: null,
      id: 'user-1',
      content: [
        { type: 'text', text: 'Use the browser skill', text_elements: [] },
        { type: 'skill', name: 'browser-use:browser', path: '/Users/igor/.codex/skills/browser/SKILL.md' },
      ],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-1',
      role: 'user',
      text: 'Use the browser skill',
      skills: [{ name: 'browser-use:browser', path: '/Users/igor/.codex/skills/browser/SKILL.md' }],
    })
  })

  it('renders skill-only user messages instead of dropping them as raw blocks', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage', clientId: null,
      id: 'user-2',
      content: [
        { type: 'skill', name: 'sample-skill', path: '/local/skills/sample-skill/SKILL.md' },
      ],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-2',
      role: 'user',
      text: '',
      skills: [{ name: 'sample-skill', path: '/local/skills/sample-skill/SKILL.md' }],
    })
    expect(messages[0].isUnhandled).toBeUndefined()
  })

  it('decodes escaped heartbeat instructions without exposing raw XML', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage', clientId: null,
      id: 'automation-user-1',
      content: [{
        type: 'text',
        text: `<heartbeat>
<automation_id>automation-1</automation_id>
<current_time_iso>2026-05-09T00:00:00.000Z</current_time_iso>
<instructions>
Reply with &lt;/instructions&gt; and A &amp; B
</instructions>
</heartbeat>`,
        text_elements: [],
      }],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'automation-user-1',
      role: 'user',
      text: 'Reply with </instructions> and A & B',
      isAutomationRun: true,
      automationDisplayName: 'automation-1',
    })
  })

  it('applies a base turn index for paged thread slices', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage', clientId: null,
      id: 'user-3',
      content: [{ type: 'text', text: 'Paged message', text_elements: [] }],
    }]), 12)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-3',
      turnId: 'turn-1',
      turnIndex: 12,
    })
  })

  it('renders failed turn errors as chat system messages', () => {
    const response = threadReadResponseWithContent([{
      type: 'userMessage', clientId: null,
      id: 'user-4',
      content: [{ type: 'text', text: 'hi', text_elements: [] }],
    }])
    response.thread.turns[0].status = 'failed'
    response.thread.turns[0].error = {
      message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
      codexErrorInfo: null,
      additionalDetails: null, misalignment: null,
    }

    const messages = normalizeThreadMessagesV2(response)

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      id: 'turn-1-error',
      role: 'system',
      text: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
      messageType: 'turnError',
      turnId: 'turn-1',
      turnIndex: 0,
    })
  })

  it('uses turn index fallback ids for failed turns with blank ids', () => {
    const response = threadReadResponseWithContent([])
    response.thread.turns = [
      {
        id: '',
        rootTurnId: null, itemsView: 'full', startedAt: null, completedAt: null, durationMs: null,
        status: 'failed',
        error: {
          message: 'first failed turn',
          codexErrorInfo: null,
          additionalDetails: null, misalignment: null,
        },
        items: [],
      },
      {
        id: '   ',
        rootTurnId: null, itemsView: 'full', startedAt: null, completedAt: null, durationMs: null,
        status: 'failed',
        error: {
          message: 'second failed turn',
          codexErrorInfo: null,
          additionalDetails: null, misalignment: null,
        },
        items: [],
      },
    ]

    const messages = normalizeThreadMessagesV2(response, 8)

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'turn-8-error',
        text: 'first failed turn',
        turnId: undefined,
        turnIndex: 8,
      }),
      expect.objectContaining({
        id: 'turn-9-error',
        text: 'second failed turn',
        turnId: undefined,
        turnIndex: 9,
      }),
    ])
  })
})

describe('readThreadInProgressFromResponse', () => {
  it('treats active thread status objects as in progress', () => {
    const response = threadReadResponseWithContent([])
    ;(response.thread as unknown as { status: { type: string } }).status = { type: 'active' }

    expect(readThreadInProgressFromResponse(response)).toBe(true)
  })
})

it('only stamps the completed answer and never substitutes thread activity time', () => {
  const payload = threadReadResponseWithContent([
    { type: 'userMessage', clientId: null, id: 'u', content: [{ type: 'text', text: 'hello', text_elements: [] }] },
    { type: 'agentMessage', phase: null, memoryCitation: null, delivery: null, questions: null, id: 'a', text: 'Working' },
    { type: 'agentMessage', phase: null, memoryCitation: null, delivery: null, questions: null, id: 'b', text: 'Done' },
  ] as ThreadReadResponse['thread']['turns'][number]['items'])
  Object.assign(payload.thread.turns[0]!, { submittedAt: '2026-11-05T00:12:00Z', completedAt: '2026-11-05T00:13:00Z' })
  let messages = normalizeThreadMessagesV2(payload)
  expect(messages[0]?.submittedAt).toBe('2026-11-05T00:12:00.000Z')
  expect(messages[1]?.completedAt).toBeUndefined()
  expect(messages[2]?.completedAt).toBe('2026-11-05T00:13:00.000Z')
  payload.thread.turns[0]!.status = 'inProgress'
  messages = normalizeThreadMessagesV2(payload)
  expect(messages[2]?.completedAt).toBeUndefined()
})

function timedResponse() {
  const payload = threadReadResponseWithContent([
    { type: 'userMessage', clientId: null, id: 'u', content: [{ type: 'text', text: 'hello', text_elements: [] }] },
    { type: 'agentMessage', phase: null, memoryCitation: null, delivery: null, questions: null, id: 'progress', text: 'Working' },
    { type: 'agentMessage', phase: null, memoryCitation: null, delivery: null, questions: null, id: 'final', text: 'Done' },
  ])
  Object.assign(payload.thread, { historyMode: 'paginated', cliVersion: '0.166.0' })
  Object.assign(payload.thread.turns[0]!, { startedAt: 1793800494, completedAt: '2026-11-04T13:54:59.257Z' })
  const items = payload.thread.turns[0]!.items
  Object.assign(items[0]!, { startedAtMs: 1793800496289, completedAtMs: 1793800496289 })
  Object.assign(items[1]!, { phase: 'commentary', completedAtMs: 1793800498000 })
  Object.assign(items[2]!, { phase: 'final_answer', startedAtMs: 1793800498335, completedAtMs: 1793800499248 })
  return payload
}

it('uses message milliseconds from paginated history and preserves them after reloading', () => {
  const payload = timedResponse()
  for (const response of [payload, JSON.parse(JSON.stringify(payload))]) {
    const messages = normalizeThreadMessagesV2(response, 10)
    expect(messages[0]?.submittedAt).toBe('2026-11-04T13:54:56.289Z')
    expect(messages[1]?.completedAt).toBeUndefined()
    expect(messages[2]?.completedAt).toBe('2026-11-04T13:54:59.248Z')
  }
})

it.each([undefined, null, '', '1793800496289', 'invalid', NaN, Infinity, -1, 1.5, 8640000000000001, {}])(
  'ignores malformed milliseconds (%s), falling back to valid timestamp evidence', (invalid) => {
    const payload = timedResponse()
    const items = payload.thread.turns[0]!.items
    Object.assign(items[0]!, { startedAtMs: invalid })
    expect(normalizeThreadMessagesV2(payload)[0]?.submittedAt).toBe('2026-11-04T13:54:56.289Z')
    Object.assign(items[0]!, { completedAtMs: invalid, submittedAt: '2026-11-04T13:54:55Z' })
    Object.assign(items[2]!, { completedAtMs: invalid, completedAt: '2026-11-04T13:54:58Z' })
    let messages = normalizeThreadMessagesV2(payload)
    expect(messages[0]?.submittedAt).toBe('2026-11-04T13:54:55.000Z')
    expect(messages[2]?.completedAt).toBe('2026-11-04T13:54:58.000Z')
    Object.assign(items[0]!, { submittedAt: 'bad' })
    Object.assign(items[2]!, { completedAt: 'bad' })
    Object.assign(payload.thread.turns[0]!, { completedAt: 'bad' })
    messages = normalizeThreadMessagesV2(payload)
    expect(messages[0]?.submittedAt).toBeUndefined()
    expect(messages[2]?.completedAt).toBeUndefined()
  },
)

it('suppresses completion timestamps for in-progress answers and trailing commentary', () => {
  const payload = timedResponse()
  payload.thread.turns[0]!.status = 'inProgress'
  expect(normalizeThreadMessagesV2(payload)[2]?.completedAt).toBeUndefined()
  payload.thread.turns[0]!.status = 'completed'
  Object.assign(payload.thread.turns[0]!.items[2]!, { phase: 'commentary' })
  expect(normalizeThreadMessagesV2(payload)[2]?.completedAt).toBeUndefined()
})

it('retains reliable review result execution metadata and explicit item completion time only',()=>{
 const payload=threadReadResponseWithContent([{type:'exitedReviewMode',id:'review-result',review:'Finding',completedAtMs:1795000000000}])
 Object.assign(payload.thread.turns[0]!,{generationMetadata:{model:'review-model',modelSource:'execution',effort:'none',effortSource:'execution'}})
 const message=normalizeThreadMessagesV2(payload)[0]!
 expect(message.role).toBe('assistant');expect(message.generationMetadata?.model).toBe('review-model');expect(message.generationMetadata?.effort).toBe('none');expect(message.completedAt).toBe(new Date(1795000000000).toISOString())
 payload.thread.turns[0]!.status='inProgress';expect(normalizeThreadMessagesV2(payload)[0]?.completedAt).toBeUndefined()
 const absent=threadReadResponseWithContent([{type:'exitedReviewMode',id:'unknown-review',review:'Finding'}])
 expect(normalizeThreadMessagesV2(absent)[0]?.generationMetadata).toBeUndefined();expect(normalizeThreadMessagesV2(absent)[0]?.completedAt).toBeUndefined()
})
