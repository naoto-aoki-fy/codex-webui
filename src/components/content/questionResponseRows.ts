import { questionAnswerText, type QuestionResponse } from '../../questionResponses'
import type { UiMessage } from '../../types/codex'

export type HistoryQuestionResponse = QuestionResponse & { turnIndex?: number }
export type QuestionResponseRow = UiMessage & { questionResponse?: QuestionResponse }

/** Insert after the native anchor, or compare timestamps within that turn. A
 * collapsed item still owns its location in the underlying conversation. */
export function insertQuestionResponseRows(
  all: UiMessage[], visible: UiMessage[], responses: HistoryQuestionResponse[], firstVisibleId?: string,
): QuestionResponseRow[] {
  if (!responses.length) return visible
  const positions = new Map(all.map((message, index) => [message.id, index]))
  const messagesByTurn = new Map<string, UiMessage[]>()
  for (const message of all) {
    if (!message.turnId) continue
    const turn = messagesByTurn.get(message.turnId) ?? []
    turn.push(message)
    messagesByTurn.set(message.turnId, turn)
  }
  const firstVisible = (firstVisibleId ? positions.get(firstVisibleId) : 0) ?? 0
  const inserted = responses.flatMap(response => {
    const turn = messagesByTurn.get(response.turnId) ?? []
    const anchor = response.anchorItemId ? positions.get(response.anchorItemId) : undefined
    let index: number
    if (anchor !== undefined && all[anchor]?.turnId === response.turnId) index = anchor + 1
    else if (turn.length) {
      const following = turn.find(message => {
        const time = message.timelineAt ?? message.submittedAt ?? message.completedAt
        return time && time > response.submittedAt
      })
      index = following ? positions.get(following.id)! : positions.get(turn.at(-1)!.id)! + 1
    } else {
      const following = all.find(message => message.turnId && message.turnIndex !== undefined &&
        response.turnIndex !== undefined && message.turnIndex > response.turnIndex)
      index = following ? positions.get(following.id)! : all.length
    }
    if (index < firstVisible || (index === firstVisible && firstVisible > 0)) return []
    const row: QuestionResponseRow = {
      id: `question-response-${response.id}`, role: 'user', messageType: 'questionResponse',
      turnId: response.turnId, submittedAt: response.submittedAt, questionResponse: response,
      text: response.questions.map(question => `${question.heading}\n${questionAnswerText(question)}`).join('\n\n'),
    }
    return [{ index, row }]
  }).sort((a, b) => a.index - b.index || a.row.submittedAt!.localeCompare(b.row.submittedAt!) || a.row.id.localeCompare(b.row.id))

  const rows: QuestionResponseRow[] = []
  let cursor = 0
  for (const message of visible) {
    const index = positions.get(message.id)!
    while (inserted[cursor] && inserted[cursor]!.index <= index) rows.push(inserted[cursor++]!.row)
    rows.push(message)
  }
  return rows.concat(inserted.slice(cursor).map(({ row }) => row))
}
