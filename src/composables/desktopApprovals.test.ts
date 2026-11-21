import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { getPendingServerRequests, replyToServerRequest } from '../api/codexGateway'
import { CodexApiError } from '../api/codexErrors'
import { QUESTION_REPLY_NOT_SENT, type QuestionSubmission } from '../questionResponses'
import { QUESTION_REQUEST } from '../serverRequestMethod'
import { createDesktopApprovals } from './desktopApprovals'

vi.mock('../api/codexGateway', () => ({
  getPendingServerRequests: vi.fn(),
  replyToServerRequest: vi.fn(),
}))

const question = {
  id: 1,
  method: QUESTION_REQUEST,
  responseId: 'answer',
  params: { threadId: 'thread', turnId: 'turn' },
}
const submission: QuestionSubmission = {
  saved: true,
  response: { id: 'answer', threadId: 'thread', turnId: 'turn', submittedAt: '2026-11-20', questions: [] },
}

function setup() {
  const error = ref('')
  const retainQuestionResponse = vi.fn()
  const approvals = createDesktopApprovals({ error, retainQuestionResponse, lifecycleGeneration: 0, applyThreadFlags() {} })
  const notify = (method: string, params: unknown) => approvals.handleServerRequestNotification({ method, params, atIso: '2026-11-20' })
  const rows = () => approvals.pendingServerRequestsByThreadId.value.thread ?? []
  notify('server/request', question)
  const request = rows()[0]!
  const edit = (field: 'choice' | 'text', value: string) => approvals.updateQuestionDraft(request, 'scope', field, value)
  const close = () => notify('server/request/resolved', { id: request.id })
  const send = () => approvals.respondToPendingServerRequest({ id: request.id, result: {} })
  const dismiss = () => approvals.dismissQuestionDraft(request.id)
  return { approvals, error, retainQuestionResponse, notify, rows, request, edit, close, send, dismiss }
}

describe('closed question drafts', () => {
  beforeEach(() => {
    vi.mocked(getPendingServerRequests).mockReset().mockResolvedValue([])
    vi.mocked(replyToServerRequest).mockReset()
  })

  it.each(['notification', 'refresh', 'disconnect'])('clears empty drafts after %s', async source => {
    const { approvals, rows, request, edit, close } = setup()
    edit('choice', 'Full review')
    edit('choice', '')
    edit('text', 'Some text')
    edit('text', '  ')
    if (source === 'notification') close()
    else if (source === 'refresh') await approvals.loadPendingServerRequestsFromBridge()
    else approvals.clearPendingAfterDisconnect()
    expect(rows()).toEqual([])
    expect(approvals.readQuestionDraft(request)).toBeUndefined()
  })

  it('preserves a changed choice and restores it if the question reopens after reconnect', async () => {
    const { approvals, rows, request, edit } = setup()
    edit('choice', 'Full review')
    approvals.clearPendingAfterDisconnect()
    expect(rows()[0]?.questionClosed).toBe(true)
    vi.mocked(getPendingServerRequests).mockResolvedValue([question])
    await approvals.loadPendingServerRequestsFromBridge()
    expect(approvals.getThreadPendingRequests(request.threadId)).toHaveLength(1)
    expect(approvals.readQuestionDraft(rows()[0]!)?.fields.get('scope')?.choice).toBe('Full review')
  })

  it.each([
    ['before', 'Edited answer'],
    ['after', ''],
  ])('retains a failed answer when native closure happens %s the HTTP failure with draft text %j', async (timing, text) => {
    const { approvals, error, rows, request, edit, close, send } = setup()
    let rejectReply!: (reason: Error) => void
    vi.mocked(replyToServerRequest).mockReturnValue(new Promise((_, reject) => { rejectReply = reject }))
    edit('text', text)
    const pending = send()
    if (timing === 'before') close()
    rejectReply(new CodexApiError('Reply not sent', { code: QUESTION_REPLY_NOT_SENT }))
    expect(await pending).toBe(false)
    if (timing === 'after') close()
    expect(rows()[0]?.questionClosed).toBe(true)
    expect(error.value).toBe('Question reply was not sent. Your draft is kept.')
    expect(approvals.readQuestionDraft(request)?.attempt?.error).toBe(error.value)
    expect(approvals.readQuestionDraft(request)?.fields.get('scope')?.text).toBe(text)
    expect(await send()).toBe(false)
    expect(replyToServerRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps the pending answer and sends only once across native closure and HTTP confirmation', async () => {
    const { approvals, retainQuestionResponse, rows, request, edit, close, send, dismiss } = setup()
    let resolveReply!: (value: QuestionSubmission) => void
    vi.mocked(replyToServerRequest).mockReturnValue(new Promise(resolve => { resolveReply = resolve }))
    edit('text', 'Original answer')
    const pending = send()
    expect(approvals.readQuestionDraft(request)?.attempt).toEqual({})
    expect(await send()).toBe(false)
    close()
    dismiss()
    expect(rows()[0]?.questionClosed).toBe(true)
    expect(approvals.readQuestionDraft(request)?.fields.get('scope')?.text).toBe('Original answer')
    expect(await send()).toBe(false)
    vi.mocked(getPendingServerRequests).mockResolvedValue([question])
    await approvals.loadPendingServerRequestsFromBridge()
    expect(rows()[0]?.questionClosed).toBe(true)
    expect(retainQuestionResponse).not.toHaveBeenCalled()
    resolveReply(submission)
    expect(await pending).toBe(true)
    expect(rows()).toEqual([])
    expect(approvals.readQuestionDraft(request)).toBeUndefined()
    expect(retainQuestionResponse).toHaveBeenCalledExactlyOnceWith(submission.response)
    expect(await send()).toBe(false)
    expect(replyToServerRequest).toHaveBeenCalledTimes(1)
  })

  it('allows one explicit retry when the bridge confirms the reply was never sent', async () => {
    const { approvals, retainQuestionResponse, rows, request, edit, send } = setup()
    vi.mocked(replyToServerRequest)
      .mockRejectedValueOnce(new CodexApiError('Reply not sent', { code: QUESTION_REPLY_NOT_SENT }))
      .mockResolvedValueOnce(submission)
    edit('choice', 'Full review')
    expect(await send()).toBe(false)
    expect(approvals.readQuestionDraft(request)?.attempt?.retryable).toBe(true)
    expect(approvals.readQuestionDraft(request)?.fields.get('scope')?.choice).toBe('Full review')
    const retry = send()
    expect(await send()).toBe(false)
    expect(await retry).toBe(true)
    expect(rows()).toEqual([])
    expect(retainQuestionResponse).toHaveBeenCalledExactlyOnceWith(submission.response)
    expect(replyToServerRequest).toHaveBeenCalledTimes(2)
  })

  it('accepts a late HTTP confirmation after disconnect and dismissal', async () => {
    const { approvals, retainQuestionResponse, rows, close, send, dismiss } = setup()
    let resolveReply!: (value: QuestionSubmission) => void
    vi.mocked(replyToServerRequest).mockReturnValue(new Promise(resolve => { resolveReply = resolve }))
    const pending = send()
    approvals.clearPendingAfterDisconnect()
    close()
    expect(rows()[0]?.questionClosed).toBe(true)
    dismiss()
    close()
    vi.mocked(getPendingServerRequests).mockResolvedValue([question])
    await approvals.loadPendingServerRequestsFromBridge()
    expect(rows()).toEqual([])
    resolveReply(submission)
    expect(await pending).toBe(true)
    expect(retainQuestionResponse).toHaveBeenCalledExactlyOnceWith(submission.response)
    expect(replyToServerRequest).toHaveBeenCalledTimes(1)
  })

  it('ignores a late failure after dismissal', async () => {
    const { approvals, error, retainQuestionResponse, rows, request, edit, send, dismiss } = setup()
    let rejectReply!: (reason: Error) => void
    vi.mocked(replyToServerRequest).mockReturnValue(new Promise((_, reject) => { rejectReply = reject }))
    edit('text', 'Unconfirmed draft')
    const pending = send()
    approvals.clearPendingAfterDisconnect()
    dismiss()
    error.value = 'Newer error'
    rejectReply(new Error('Reply unconfirmed'))
    expect(await pending).toBe(false)
    expect(error.value).toBe('Newer error')
    expect(approvals.readQuestionDraft(request)).toBeUndefined()
    expect(rows()).toEqual([])
    expect(retainQuestionResponse).not.toHaveBeenCalled()
  })
})
