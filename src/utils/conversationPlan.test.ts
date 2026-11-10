import { computed, reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import type { UiMessage } from '../types/codex'
import { indexConversationPlans, interpretConversationPlan, planStepStatusIcon, showImplementPlanButton } from './conversationPlan'

const message = (overrides: Partial<UiMessage> = {}): UiMessage => ({
  id: 'plan', role: 'assistant', messageType: 'plan', text: '', turnId: 'turn', ...overrides,
})

describe('conversation Plan interpretation', () => {
  it('prefers nonempty structured steps and preserves ordering, whitespace and copy markers', () => {
    const steps = [
      { step: ' First ', status: 'inProgress' as const },
      { step: 'Second', status: 'completed' as const },
      { step: 'Third', status: 'pending' as const },
    ]
    const result = interpretConversationPlan(message({ text: '- [x] ignored', plan: { explanation: '  Why  ', steps } }))
    expect(result).toEqual({ explanation: 'Why', steps, hasCopyContent: true,
      copyText: 'Why\n\n- [~]  First\n- [x] Second\n- [ ] Third' })
    expect(result.steps).toBe(steps)
    expect(steps.map((step) => planStepStatusIcon(step.status))).toEqual(['•', '✓', '○'])
  })

  it('parses fallback markers and explanation lines in their existing order', () => {
    const result = interpretConversationPlan(message({ text: ' Intro\r\n\r\n- [X] Done\n* [>] Active\n- [-] Also active\n- [~] Working\n- [|] Pending\n- [ ] Next\nTail' }))
    expect(result.explanation).toBe('Intro\n\nTail')
    expect(result.steps.map((step) => step.status)).toEqual(['completed', 'inProgress', 'inProgress', 'inProgress', 'pending', 'pending'])
    expect(result.copyText).toBe('Intro\n\nTail\n\n- [x] Done\n- [~] Active\n- [~] Also active\n- [~] Working\n- [ ] Pending\n- [ ] Next')
  })

  it.each(['', '   ', '# Heading\n1. Plain step', '- [', '- [x]', '- [?] invalid'])('preserves raw fallback display/copy for incomplete text %j', (text) => {
    expect(interpretConversationPlan(message({ text }))).toEqual({
      explanation: '', steps: [], copyText: '', hasCopyContent: Boolean(text.trim()),
    })
  })

  it('falls back for empty structured steps and keeps malformed lines as explanation', () => {
    const result = interpretConversationPlan(message({ text: '- [?] invalid\n- [ ] Valid', plan: { explanation: 'ignored', steps: [] } }))
    expect(result.explanation).toBe('- [?] invalid')
    expect(result.steps).toEqual([{ step: 'Valid', status: 'pending' }])
    expect(interpretConversationPlan(message({ plan: { steps: [{ step: ' ', status: 'pending' }] } })).hasCopyContent).toBe(false)
  })

  it('keeps Implement visibility independent of body content and preserves the whitespace turn-ID rule', () => {
    expect(showImplementPlanButton(message())).toBe(true)
    expect(showImplementPlanButton(message({ turnId: ' ' }))).toBe(true)
    for (const overrides of [{ turnId: '' }, { turnId: undefined }, { role: 'user' as const }, { messageType: 'plan.live' }, { messageType: undefined }]) {
      expect(showImplementPlanButton(message(overrides))).toBe(false)
    }
  })

  it('reuses one interpretation across consumers and invalidates same-ID streaming edits', () => {
    const messages = reactive([message({ messageType: 'plan.live', text: '- [ ] First' })])
    let evaluations = 0
    const derived = computed(() => { evaluations++; return indexConversationPlans(messages) })
    const read = () => derived.value.get(messages[0]!)!
    const first = read()
    expect(read()).toBe(first)
    expect(read().copyText).toBe('- [ ] First')
    expect(evaluations).toBe(1)
    messages[0]!.text = 'Updated\n- [x] First\n- [ ] Second'
    expect(read()).not.toBe(first)
    expect(read().explanation).toBe('Updated')
    expect(read().steps).toHaveLength(2)
    messages[0]!.plan = { steps: [{ step: 'Structured', status: 'pending' }] }
    expect(read().copyText).toBe('- [ ] Structured')
    messages[0]!.plan!.steps[0]!.status = 'completed'
    expect(read().copyText).toBe('- [x] Structured')
    messages[0] = message({ text: '- [~] Replacement' })
    expect(read().copyText).toBe('- [~] Replacement')
    expect(evaluations).toBe(5)
  })
})
