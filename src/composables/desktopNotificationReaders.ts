import type { RpcNotification } from '../api/codexGateway'
import type { UiMessage, UiPlanData, UiPlanStep, UiThreadTokenUsage, UiTokenUsageBreakdown } from '../types/codex'
import { clamp } from './desktopStatePersistence'

export type TurnActivityState = {
  label: string
  details: string[]
}

export function extractLocalImagePathFromUrl(value: string): string {
  try {
    const parsed = new URL(value, 'http://localhost')
    if (parsed.pathname !== '/codex-local-image') return ''
    return parsed.searchParams.get('path')?.trim() ?? ''
  } catch {
    return ''
  }
}

export function normalizePlanStepStatus(value: unknown): UiPlanStep['status'] {
  if (value === 'completed') return 'completed'
  if (value === 'inProgress' || value === 'in_progress') return 'inProgress'
  return 'pending'
}

export function buildPlanMessageText(plan: UiPlanData): string {
  const lines: string[] = []
  if (plan.explanation?.trim()) {
    lines.push(plan.explanation.trim())
  }
  for (const step of plan.steps) {
    const marker = step.status === 'completed' ? 'x' : step.status === 'inProgress' ? '~' : ' '
    lines.push(`- [${marker}] ${step.step}`)
  }
  return lines.join('\n').trim()
}

export function readPlanUpdate(notification: RpcNotification): { threadId: string; message: UiMessage } | null {
  if (notification.method !== 'turn/plan/updated') return null
  const params = asRecord(notification.params)
  const threadId = extractThreadIdFromNotification(notification)
  const turnId = readString(params?.turnId) || readString(params?.turn_id)
  const rawSteps = Array.isArray(params?.plan) ? params?.plan : []
  const steps: UiPlanStep[] = rawSteps
    .map((row) => asRecord(row))
    .map((row) => ({
      step: readString(row?.step),
      status: normalizePlanStepStatus(row?.status),
    }))
    .filter((row) => row.step.length > 0)

  if (!threadId || !turnId) return null

  const explanation = readString(params?.explanation).trim()
  const plan: UiPlanData = {
    explanation: explanation || undefined,
    steps,
    isStreaming: true,
  }

  return {
    threadId,
    message: {
      id: `${turnId}:plan`,
      role: 'assistant',
      text: buildPlanMessageText(plan),
      messageType: 'plan.live',
      plan,
    },
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeTokenUsageBreakdown(value: unknown): UiTokenUsageBreakdown | null {
  const record = asRecord(value)
  if (!record) return null

  const totalTokens = readNumber(record.totalTokens ?? record.total_tokens)
  const inputTokens = readNumber(record.inputTokens ?? record.input_tokens)
  const cachedInputTokens = readNumber(record.cachedInputTokens ?? record.cached_input_tokens)
  const outputTokens = readNumber(record.outputTokens ?? record.output_tokens)
  const reasoningOutputTokens = readNumber(record.reasoningOutputTokens ?? record.reasoning_output_tokens)
  if (
    totalTokens === null ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null
  ) {
    return null
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  }
}

export function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
  const record = asRecord(value)
  if (!record) return null

  const total = normalizeTokenUsageBreakdown(record.total)
  const last = normalizeTokenUsageBreakdown(record.last)
  if (!total || !last) return null

  const modelContextWindow = readNumber(record.modelContextWindow ?? record.model_context_window)
  const currentContextTokens = last.totalTokens
  const remainingContextTokens = typeof modelContextWindow === 'number'
    ? Math.max(modelContextWindow - currentContextTokens, 0)
    : null
  const remainingContextPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
    ? clamp(Math.round((remainingContextTokens ?? 0) / modelContextWindow * 100), 0, 100)
    : null

  return {
    total,
    last,
    modelContextWindow,
    currentContextTokens,
    remainingContextTokens,
    remainingContextPercent,
  }
}

export function readThreadTokenUsageUpdate(notification: RpcNotification): { threadId: string; usage: UiThreadTokenUsage } | null {
  if (notification.method !== 'thread/tokenUsage/updated') return null
  const params = asRecord(notification.params)
  const threadId = extractThreadIdFromNotification(notification)
  const usage = normalizeThreadTokenUsage(params?.tokenUsage ?? params?.token_usage)
  if (!threadId || !usage) return null
  return { threadId, usage }
}

export function extractThreadIdFromNotification(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (!params) return ''

  const directThreadId = readString(params.threadId)
  if (directThreadId) return directThreadId
  const snakeThreadId = readString(params.thread_id)
  if (snakeThreadId) return snakeThreadId

  const conversationId = readString(params.conversationId)
  if (conversationId) return conversationId
  const snakeConversationId = readString(params.conversation_id)
  if (snakeConversationId) return snakeConversationId

  const thread = asRecord(params.thread)
  const nestedThreadId = readString(thread?.id)
  if (nestedThreadId) return nestedThreadId

  const turn = asRecord(params.turn)
  const turnThreadId = readString(turn?.threadId)
  if (turnThreadId) return turnThreadId
  const turnSnakeThreadId = readString(turn?.thread_id)
  if (turnSnakeThreadId) return turnSnakeThreadId

  return ''
}

export function readTurnErrorMessage(notification: RpcNotification): string {
  if (notification.method !== 'turn/completed') return ''
  const params = asRecord(notification.params)
  const turn = asRecord(params?.turn)
  if (!turn || turn.status !== 'failed') return ''
  const errorPayload = asRecord(turn.error)
  return readString(errorPayload?.message)
}

export function readNotificationErrorState(notification: RpcNotification): { message: string; transient: boolean } | null {
  if (notification.method !== 'error') return null
  const params = asRecord(notification.params)
  const message = (
    readString(params?.message) ||
    readString(asRecord(params?.error)?.message)
  )
  if (!message) return null

  return {
    message,
    transient: params?.willRetry === true,
  }
}

export function normalizePendingServerRequestMethod(
  method: string,
  params: Record<string, unknown> | null,
): string {
  const normalized = method.trim()
  if (!normalized) return normalized

  if (
    normalized === 'item/commandExecution/requestApproval' ||
    normalized === 'execCommandApproval' ||
    normalized === 'exec_approval_request' ||
    looksLikeExecApprovalRequest(params)
  ) {
    return 'item/commandExecution/requestApproval'
  }

  if (
    normalized === 'item/fileChange/requestApproval' ||
    normalized === 'applyPatchApproval' ||
    normalized === 'apply_patch_approval_request' ||
    looksLikePatchApprovalRequest(params)
  ) {
    return 'item/fileChange/requestApproval'
  }

  if (
    normalized === 'item/tool/requestUserInput' ||
    normalized === 'request_user_input' ||
    looksLikeToolUserInputRequest(params)
  ) {
    return 'item/tool/requestUserInput'
  }

  if (
    normalized === 'mcpServer/elicitation/request' ||
    normalized === 'elicitation_request' ||
    looksLikeMcpServerElicitationRequest(params)
  ) {
    return 'mcpServer/elicitation/request'
  }

  if (normalized === 'item/permissions/requestApproval' || looksLikePermissionsApprovalRequest(params)) {
    return 'item/permissions/requestApproval'
  }

  if (
    normalized === 'item/tool/call' ||
    normalized === 'dynamic_tool_call_request' ||
    looksLikeToolCallRequest(params)
  ) {
    return 'item/tool/call'
  }

  return normalized
}

export function looksLikeExecApprovalRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  const command = params.command
  if (Array.isArray(command) && command.some((part) => typeof part === 'string' && part.trim().length > 0)) {
    return true
  }
  if (typeof command === 'string' && command.trim().length > 0) {
    return true
  }
  return Array.isArray(params.commandActions)
}

export function looksLikePatchApprovalRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  if (typeof params.grantRoot === 'string' && params.grantRoot.trim().length > 0) return true
  if (typeof params.grant_root === 'string' && params.grant_root.trim().length > 0) return true
  if (asRecord(params.fileChanges)) return true
  return asRecord(params.changes) !== null
}

export function looksLikeToolUserInputRequest(params: Record<string, unknown> | null): boolean {
  return Boolean(params && Array.isArray(params.questions))
}

export function looksLikeToolCallRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  return (
    typeof params.toolName === 'string' ||
    typeof params.tool_name === 'string' ||
    typeof params.name === 'string' ||
    Array.isArray(params.arguments)
  )
}

export function looksLikeMcpServerElicitationRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  const mode = readString(params.mode)
  return (
    typeof params.serverName === 'string' &&
    typeof params.threadId === 'string' &&
    typeof params.message === 'string' &&
    (mode === 'form' || mode === 'url')
  )
}

export function looksLikePermissionsApprovalRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  return (
    typeof params.threadId === 'string' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    asRecord(params.permissions) !== null
  )
}

export function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
  const threadId = extractThreadIdFromNotification(notification)
  if (!threadId) return null

  if (notification.method === 'turn/started') {
    return {
      threadId,
      activity: {
        label: 'Thinking',
        details: [],
      },
    }
  }

  if (notification.method === 'item/started') {
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    const itemType = readString(item?.type).toLowerCase()
    if (itemType === 'reasoning') {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }
    if (itemType === 'agentmessage') {
      return {
        threadId,
        activity: {
          label: 'Writing response',
          details: [],
        },
      }
    }
    if (itemType === 'commandexecution') {
      const cmd = readString(item?.command)
      return {
        threadId,
        activity: {
          label: 'Running command',
          details: cmd ? [cmd] : [],
        },
      }
    }
    if (itemType === 'filechange') {
      const changes = Array.isArray(item?.changes) ? item.changes : []
      const firstChange = changes[0] as Record<string, unknown> | undefined
      const path = readString(firstChange?.path)
      return {
        threadId,
        activity: {
          label: 'Applying changes',
          details: path ? [path] : [],
        },
      }
    }
  }

  if (notification.method === 'item/commandExecution/outputDelta') {
    return {
      threadId,
      activity: {
        label: 'Running command',
        details: [],
      },
    }
  }

  if (notification.method === 'item/fileChange/outputDelta') {
    return {
      threadId,
      activity: {
        label: 'Applying changes',
        details: [],
      },
    }
  }

  if (
    notification.method === 'item/reasoning/summaryTextDelta' ||
    notification.method === 'item/reasoning/summaryPartAdded' ||
    notification.method === 'item/reasoning/textDelta'
  ) {
    return {
      threadId,
      activity: {
        label: 'Thinking',
        details: [],
      },
    }
  }

  if (notification.method === 'item/agentMessage/delta') {
    return {
      threadId,
      activity: {
        label: 'Writing response',
        details: [],
      },
    }
  }

  return null
}

export function liveReasoningMessageId(reasoningItemId: string): string {
  return `${reasoningItemId}:live-reasoning`
}

export function readReasoningStartedItemId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (!params) return ''

  if (notification.method === 'item/started') {
    const item = asRecord(params.item)
    if (!item || item.type !== 'reasoning') return ''
    return readString(item.id)
  }

  return ''
}

export function readReasoningDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
  const params = asRecord(notification.params)
  if (!params) return null

  // Канонический источник дельт для UI — уже нормализованный item/*.
  if (notification.method === 'item/reasoning/summaryTextDelta') {
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return null
    return { messageId: liveReasoningMessageId(itemId), delta }
  }

  // codex also emits the full reasoning-chain stream as item/reasoning/textDelta
  // (alongside the summary stream). Without handling it, reasoning text the
  // model streams via this channel is dropped and the UI shows only the
  // summary, making long thinking phases look like a stall.
  if (notification.method === 'item/reasoning/textDelta') {
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return null
    return { messageId: liveReasoningMessageId(itemId), delta }
  }

  return null
}

export function readReasoningSectionBreakMessageId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (!params) return ''

  // Канонический source для section break — item/*
  if (notification.method === 'item/reasoning/summaryPartAdded') {
    const itemId = readString(params.itemId)
    if (!itemId) return ''
    return liveReasoningMessageId(itemId)
  }

  return ''
}

export function readReasoningCompletedId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (!params) return ''

  if (notification.method === 'item/completed') {
    const item = asRecord(params.item)
    if (!item || item.type !== 'reasoning') return ''
    return liveReasoningMessageId(readString(item.id))
  }

  return ''
}

export function readAgentMessageStartedId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  if (!params) return ''

  if (notification.method === 'item/started') {
    const item = asRecord(params.item)
    if (!item || item.type !== 'agentMessage') return ''
    return readString(item.id)
  }

  return ''
}

export function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
  const params = asRecord(notification.params)
  if (!params) return null

  // Канонический live-канал агентского текста.
  if (notification.method === 'item/agentMessage/delta') {
    const messageId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!messageId || !delta) return null
    return { messageId, delta }
  }

  return null
}

export function readAgentMessageCompleted(notification: RpcNotification): UiMessage | null {
  const params = asRecord(notification.params)
  if (!params) return null

  if (notification.method === 'item/completed') {
    const item = asRecord(params.item)
    if (!item || item.type !== 'agentMessage') return null
    const id = readString(item.id)
    const text = readString(item.text)
    if (!id || !text) return null
    return {
      id,
      role: 'assistant',
      text,
      messageType: 'agentMessage.live',
    }
  }

  return null
}

export function toLocalImageUrl(path: string): string {
  return `/codex-local-image?path=${encodeURIComponent(path)}`
}

export function toImageGenerationUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/codex-local-image?')
  ) {
    return trimmed
  }
  const compact = trimmed.replace(/\s+/gu, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) return ''
  return `data:image/png;base64,${compact}`
}

export function readCompletedImageView(notification: RpcNotification): UiMessage | null {
  if (notification.method !== 'item/completed') return null
  const params = asRecord(notification.params)
  const item = asRecord(params?.item)
  if (!item) return null
  const id = readString(item.id)
  if (!id) return null
  if (item.type === 'imageView') {
    const path = readString(item.path)
    if (!path) return null
    return {
      id,
      role: 'assistant',
      text: '',
      images: [toLocalImageUrl(path)],
      messageType: 'imageView',
    }
  }
  if (item.type !== 'imageGeneration' && item.type !== 'image_generation') return null
  const result = readString(item.result)
  const imageUrl = result ? toImageGenerationUrl(result) : ''
  if (!imageUrl) return null
  return {
    id,
    role: 'assistant',
    text: '',
    images: [imageUrl],
    messageType: 'imageView',

  }
}

export function readCommandOutputDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
  if (notification.method !== 'item/commandExecution/outputDelta') return null
  const params = asRecord(notification.params)
  if (!params) return null
  const itemId = readString(params.itemId)
  const delta = readString(params.delta)
  if (!itemId || !delta) return null
  return { itemId, delta }
}

export function isAgentContentEvent(notification: RpcNotification): boolean {
  if (notification.method === 'item/agentMessage/delta') {
    return true
  }

  const params = asRecord(notification.params)
  if (!params) return false

  if (notification.method === 'item/completed') {
    const item = asRecord(params.item)
    return item?.type === 'agentMessage'
  }

  return false
}
