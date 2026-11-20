import { expect, it } from 'vitest'
import { insertQuestionResponseRows } from './questionResponseRows'
import type { UiMessage } from '../../types/codex'

const prompt: UiMessage = { id: 'prompt', turnId: 'turn', turnIndex: 0, role: 'user', text: 'Prompt', submittedAt: '2026-11-20T01:00:00.000Z' }
const anchor: UiMessage = { id: 'anchor', turnId: 'turn', turnIndex: 0, role: 'assistant', text: 'Before the question' }
const done: UiMessage = { id: 'done', turnId: 'turn', turnIndex: 0, role: 'assistant', text: 'Completed', completedAt: '2026-11-20T01:08:00.000Z' }
const next: UiMessage = { id: 'next', turnId: 'next', turnIndex: 2, role: 'user', text: 'Next' }
const answer = {
  id: 'answer', threadId: 'thread', turnId: 'turn', anchorItemId: 'anchor', submittedAt: '2026-11-20T01:05:00.000Z',
  questions: [{ id: 'a', heading: 'Heading', answers: ['Choice', 'Free text'] }, { id: 'b', heading: 'Private', provided: true }],
}
it('uses a native anchor even if its row is collapsed, with only visible content copyable', () => {
  const rows = insertQuestionResponseRows([prompt, anchor, done], [prompt, done], [answer])
  expect(rows.map(row => row.id)).toEqual(['prompt', 'question-response-answer', 'done'])
  expect(rows[1]?.text).toBe('Heading\nChoice\nFree text\n\nPrivate\nAnswer hidden')
})
it('falls back to event time, the end of the turn, and the turn index for an empty turn', () => {
  const all = [prompt, done, next]
  expect(insertQuestionResponseRows(all, all, [answer]).map(row => row.id)).toEqual(['prompt', 'question-response-answer', 'done', 'next'])
  expect(insertQuestionResponseRows(all, all, [{ ...answer, submittedAt: '2026-11-20T01:10:00.000Z' }]).map(row => row.id))
    .toEqual(['prompt', 'done', 'question-response-answer', 'next'])
  expect(insertQuestionResponseRows(all, all, [{ ...answer, turnId: 'empty', turnIndex: 1 }]).map(row => row.id))
    .toEqual(['prompt', 'done', 'question-response-answer', 'next'])
})
