import type { UiMessage, UiPlanStep } from '../types/codex'

type PlanData = { explanation: string; steps: UiPlanStep[] }

function readFenceMarker(line: string): string {
  return line.match(/^\s{0,3}(```+|~~~+)\s*([^\s`~][^`]*)?\s*$/u)?.[1] ?? ''
}

export function parsePlanFromMessageText(text: string): PlanData | null {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return null

  const steps: UiPlanStep[] = []
  const explanationLines: string[] = []
  let stepLines: string[] | null = null
  let stepIndent = 0
  let blankLines: string[] = []
  let fence = ''

  function finishStep() {
    if (stepLines) steps[steps.length - 1].step = stepLines.join('\n')
    stepLines = null
    blankLines = []
    fence = ''
  }

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim()
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0
    if (stepLines && (!trimmed || indent >= stepIndent)) {
      const content = line.slice(stepIndent)
      if (!trimmed && !fence) {
        blankLines.push(content)
        continue
      }
      for (const blank of blankLines) stepLines.push(blank)
      stepLines.push(content)
      blankLines = []
      if (fence) {
        if (content.trim() === fence) fence = ''
      } else {
        fence = readFenceMarker(content)
      }
      continue
    }
    if (stepLines) finishStep()

    if (fence) {
      explanationLines.push(line)
      if (trimmed === fence) fence = ''
      continue
    }

    fence = readFenceMarker(line)
    if (fence || !trimmed) {
      if (fence || steps.length === 0) explanationLines.push(line)
      continue
    }

    const match = trimmed.match(/^([-*]\s+)\[([ xX~>|-])\]\s+(.+)$/)
    if (match) {
      const marker = match[2].toLowerCase()
      let status: UiPlanStep['status'] = 'pending'
      if (marker === 'x') status = 'completed'
      if (marker === '~' || marker === '>' || marker === '-') status = 'inProgress'
      steps.push({ step: '', status })
      stepIndent = indent + match[1].length
      stepLines = [match[3]]
      fence = readFenceMarker(match[3])
      continue
    }

    explanationLines.push(line)
  }
  finishStep()

  if (steps.length === 0) return null
  return {
    explanation: explanationLines.join('\n').trim(),
    steps: steps.filter((step) => step.step.length > 0),
  }
}

function readPlanData(message: UiMessage): { explanation: string; steps: UiPlanStep[] } | null {
  if (message.plan && message.plan.steps.length > 0) {
    return {
      explanation: message.plan.explanation?.trim() ?? '',
      steps: message.plan.steps,
    }
  }
  return parsePlanFromMessageText(message.text)
}

export function isPlanMessage(message: UiMessage): boolean {
  return message.messageType === 'plan' || message.messageType === 'plan.live'
}

export function showImplementPlanButton(message: UiMessage): boolean {
  return isPlanMessage(message)
    && message.messageType !== 'plan.live'
    && message.role === 'assistant'
    && Boolean(message.turnId)
}

export function planStepStatusIcon(status: UiPlanStep['status']): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'inProgress':
      return '•'
    default:
      return '○'
  }
}

function planStepCopyMarker(status: UiPlanStep['status']): string {
  switch (status) {
    case 'completed':
      return '[x]'
    case 'inProgress':
      return '[~]'
    default:
      return '[ ]'
  }
}

function buildPlanCopyText(planData: PlanData | null): string {
  if (!planData) return ''

  const sections: string[] = []
  if (planData.explanation?.trim()) {
    sections.push(planData.explanation.trim())
  }

  if (planData.steps.length > 0) {
    sections.push(planData.steps.map((step) => `- ${planStepCopyMarker(step.status)} ${step.step.replace(/\n/g, '\n  ')}`.trim()).join('\n'))
  }

  return sections.join('\n\n').trim()
}

export type ConversationPlan = {
  explanation: string
  steps: UiPlanStep[]
  copyText: string
  hasCopyContent: boolean
}

export function interpretConversationPlan(message: UiMessage): ConversationPlan {
  const data = readPlanData(message)
  return {
    explanation: data?.explanation ?? '',
    steps: data?.steps ?? [],
    copyText: buildPlanCopyText(data),
    hasCopyContent: data
      ? Boolean(data.explanation || data.steps.some((step) => step.step.trim()))
      : Boolean(message.text.trim()),
  }
}

// Rebuilt by the component's computed value when reactive Plan content changes.
// Object keys also keep distinct messages with the same ID independent.
export function indexConversationPlans(messages: UiMessage[]): Map<UiMessage, ConversationPlan> {
  const plans = new Map<UiMessage, ConversationPlan>()
  for (const message of messages) {
    if (isPlanMessage(message) || message.plan) {
      plans.set(message, interpretConversationPlan(message))
    }
  }
  return plans
}
