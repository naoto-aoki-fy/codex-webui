export type QuestionResponse = {
  id: string
  threadId: string
  turnId: string
  anchorItemId?: string
  submittedAt: string
  questions: Array<{
    id: string
    heading: string
  } & ({ answers: string[] } | { provided: boolean })>
}

export type QuestionSubmission = { response: QuestionResponse; saved: boolean }

export const QUESTION_REPLY_UNCONFIRMED = 'Question reply could not be confirmed. Your draft is kept.'
export const QUESTION_REPLY_NOT_SENT = 'question_reply_not_sent'

export type QuestionDraft = {
  fields: Map<string, { choice?: string; text?: string }>
  attempt?: { error?: string; retryable?: boolean }
}

export function questionAnswerText(question: QuestionResponse['questions'][number]): string {
  if ('answers' in question) return question.answers.join('\n') || 'No answer provided'
  return question.provided ? 'Answer hidden' : 'No answer provided'
}
