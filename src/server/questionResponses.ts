import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { QuestionResponse } from '../questionResponses.js'
import { asRecord } from './bridgeHttpUtils.js'
import { profileStorageDirectory } from './connectionProfile.js'
import { deleteCodexGlobalState, readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'

const QUESTION_TOOL = 'request_user_input'

export function questionRequestParams(params: Record<string, unknown> | null) {
  const { threadId, thread_id, conversationId, conversation_id, turnId, turn_id, itemId, item_id, callId, call_id } = params ?? {}
  return {
    ...params,
    threadId: threadId ?? thread_id ?? conversationId ?? conversation_id,
    turnId: turnId ?? turn_id,
    itemId: itemId ?? item_id ?? callId ?? call_id,
  }
}

type QuestionAnswers = Record<string, { answers: string[] }>

export function readQuestionToolAnswers(output: unknown): QuestionAnswers | undefined {
  const text = Array.isArray(output) && output.length === 1 && asRecord(output[0])?.type === 'input_text'
    ? asRecord(output[0])?.text : output
  if (typeof text !== 'string' || !text.trimStart().startsWith('{')) return
  try {
    const body = asRecord(JSON.parse(text))
    const answers = asRecord(body?.answers)
    if (answers && Object.keys(body!).length === 1 && Object.values(answers).every(value => {
      const row = asRecord(value)
      return Array.isArray(row?.answers) && row.answers.every(answer => typeof answer === 'string')
    })) return answers as QuestionAnswers
  } catch { /* Other function outputs can contain arbitrary text. */ }
}

export function questionAnswersMatch(submitted: QuestionAnswers, observed: QuestionAnswers): boolean {
  const ids = Object.keys(submitted)
  return ids.length === Object.keys(observed).length && ids.every(id => {
    if (!Object.prototype.hasOwnProperty.call(observed, id)) return false
    const expected = submitted[id]!.answers
    const actual = observed[id]!.answers
    return expected.length === actual.length && expected.every((answer, index) => answer === actual[index])
  })
}

export function isQuestionToolCall(item: Record<string, unknown> | null): boolean {
  return item?.type === 'function_call' && item.name === QUESTION_TOOL
}

export function isQuestionToolOutput(item: Record<string, unknown> | null): boolean {
  return item?.type === 'functionCallOutput' && item.name === QUESTION_TOOL ||
    item?.type === 'function_call_output' && Boolean(readQuestionToolAnswers(item.output))
}

function responsePath(threadId: string, profileId?: string): string {
  const filename = createHash('sha256').update(threadId).digest('hex') + '.json'
  return join(profileStorageDirectory('data', profileId), 'question-responses', filename)
}

export function questionResponseId(params: unknown): string {
  const { threadId, turnId, itemId } = asRecord(params) ?? {}
  const callId = typeof itemId === 'string' && itemId ? itemId : randomUUID()
  return createHash('sha256').update(JSON.stringify([threadId, turnId, callId])).digest('hex')
}

export function validateQuestionResponse(id: string, params: unknown, result: unknown, anchorItemId?: string) {
  const request = asRecord(params)
  const received = asRecord(asRecord(result)?.answers)
  const threadId = request?.threadId
  const turnId = request?.turnId
  if (typeof threadId !== 'string' || !threadId || typeof turnId !== 'string' || !turnId ||
    !Array.isArray(request?.questions) || !request.questions.length || !received) {
    throw new Error('Invalid answer for the pending question request')
  }
  const entries: Array<[string, { answers: string[] }]> = []
  const questionIds = new Set<string>()
  const questions: QuestionResponse['questions'] = request.questions.map(raw => {
    const question = asRecord(raw)
    const id = question?.id
    if (typeof id !== 'string' || !id || questionIds.has(id) || !Object.prototype.hasOwnProperty.call(received, id)) {
      throw new Error('Answer IDs must match the pending questions')
    }
    questionIds.add(id)
    const answers = asRecord(received[id])?.answers
    if (!Array.isArray(answers) || !answers.every(answer => typeof answer === 'string' && answer.trim())) {
      throw new Error('Each pending question requires an array of answers')
    }
    entries.push([id, { answers }])
    const heading = [question?.header, question?.question].find(value => typeof value === 'string' && value.trim()) as string | undefined
    return { id, heading: heading ?? id, ...(question?.isSecret === true ? { provided: answers.length > 0 } : { answers }) }
  })
  if (Object.keys(received).length !== questionIds.size || !entries.some(([, { answers }]) => answers.length)) {
    throw new Error('Submit at least one answer and use only the pending question IDs')
  }
  const response: QuestionResponse = { id, threadId, turnId, anchorItemId, submittedAt: new Date().toISOString(), questions }
  return { response, result: { answers: Object.fromEntries(entries) } }
}

export class QuestionResponseStore {
  private readonly mutations = new Map<string, Promise<unknown>>()

  private serialize<T>(path: string, mutate: () => Promise<T>): Promise<T> {
    const next = (this.mutations.get(path) ?? Promise.resolve()).catch(() => undefined).then(mutate)
    this.mutations.set(path, next)
    void next.finally(() => {
      if (this.mutations.get(path) === next) this.mutations.delete(path)
    }).catch(() => undefined)
    return next
  }

  save(response: QuestionResponse, profileId: string): Promise<QuestionResponse> {
    const path = responsePath(response.threadId, profileId)
    return this.serialize(path, () => updateCodexGlobalState(state => {
      const turn = asRecord(Object.prototype.hasOwnProperty.call(state, response.turnId) ? state[response.turnId] : undefined) ?? {}
      const saved = turn[response.id] as QuestionResponse | undefined
      if (saved) return saved
      Object.defineProperty(state, response.turnId, { value: { ...turn, [response.id]: response }, enumerable: true, configurable: true, writable: true })
      return response
    }, path))
  }

  async read(threadId: string, turnIds: Set<string>, profileId?: string): Promise<QuestionResponse[]> {
    if (!turnIds.size) return []
    const path = responsePath(threadId, profileId)
    try {
      await this.mutations.get(path)?.catch(() => undefined)
      const state = await readCodexGlobalState(path)
      return [...turnIds].flatMap(id => Object.prototype.hasOwnProperty.call(state, id)
        ? Object.values(asRecord(state[id]) ?? {}) as QuestionResponse[] : [])
    } catch {
      // A local storage failure cannot prevent native history from loading.
      return []
    }
  }

  delete(threadId: string, profileId?: string): Promise<void> {
    const path = responsePath(threadId, profileId)
    return this.serialize(path, () => deleteCodexGlobalState(path))
  }
}

export const questionResponses = new QuestionResponseStore()
