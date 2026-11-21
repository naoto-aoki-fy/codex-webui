export type ForkMethod = 'native' | 'portable'
export type ResponseForkTarget = { turnId: string } | { importedMessageIndex: number }
export type RevertOperation = 'revert' | 'fork-and-revert' | 'portable-fork-and-revert'
export type PortableRevertTarget = { turnId: string; messageId: string }

export type RpcEnvelope<T> = {
  result: T
}

export type ReasoningEffort = import('../server/protocol/0.167.2/ReasoningEffort').ReasoningEffort
export type SpeedMode = 'standard' | 'fast'
export type CollaborationModeKind = 'default' | 'plan'

export type NativeThreadReadState = { firstUnread: { type: 'threadStart' } | { type: 'turn'; turnId: string } | null; revision: string }

export type ThreadWorkspace = Pick<UiThread, 'cwd' | 'projectId'>

export type UiThread = {
  projectId?: string | null
  nativeReadState?: NativeThreadReadState

  id: string
  title: string
  projectName: string
  cwd: string
  hasWorktree: boolean
  createdAtIso: string
  updatedAtIso: string
  preview: string
  unread: boolean
  inProgress: boolean
  pendingRequestState?: UiPendingRequestState | null
}

export type UiPendingRequestState = 'approval' | 'response'

export type CommandExecutionData = {
  command: string
  cwd: string | null
  status: 'inProgress' | 'completed' | 'failed' | 'declined' | 'interrupted'
  aggregatedOutput: string
  exitCode: number | null
}

export type UiFileAttachment = { label: string; path: string }
export type UiFileChangeOperation = 'add' | 'delete' | 'update'
export type UiFileChangeStatus = 'inProgress' | 'completed' | 'failed' | 'declined'
export type UiFileChange = {
  path: string
  operation: UiFileChangeOperation
  movedToPath?: string | null
  diff: string
  addedLineCount: number
  removedLineCount: number
}

export type UiPlanStepStatus = 'pending' | 'inProgress' | 'completed'

export type UiPlanStep = {
  step: string
  status: UiPlanStepStatus
}

export type UiPlanData = {
  explanation?: string
  steps: UiPlanStep[]
  isStreaming?: boolean
}

export type UiMessage = {
  // Import provenance is internal metadata, never part of the displayed text.
  importMetadata?: { source: string }
  submittedAt?: string
  completedAt?: string
  timelineAt?: string
  generationMetadata?: import('../turnGenerationMetadata').TurnGenerationMetadata
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  images?: string[]
  apps?: Array<{id:string;name:string}>
  skills?: Array<{ name: string; path: string }>
  fileAttachments?: UiFileAttachment[]
  fileChanges?: UiFileChange[]
  fileChangeStatus?: UiFileChangeStatus
  executionLabel?: string
  messageType?: string
  rawPayload?: string
  isUnhandled?: boolean
  commandExecution?: CommandExecutionData
  plan?: UiPlanData
  turnId?: string
  turnIndex?: number
  isAutomationRun?: boolean
  automationDisplayName?: string | null
}

export type UiServerRequest = {
  id: number
  method: string
  threadId: string
  turnId: string
  itemId: string
  receivedAtIso: string
  responseId?: string
  answerAttempted?: boolean
  questionClosed?: boolean
  params: unknown
}

export type UiServerRequestReply = {
  id: number
  result?: unknown
  followUpMessageText?: string
  error?: {
    code?: number
    message: string
  }
}

export type UiLiveOverlay = {
  generationMetadata?: import('../turnGenerationMetadata').TurnGenerationMetadata
  activityLabel: string
  activityDetails: string[]
  reasoningText: string
  errorText: string
}

export type UiCreditsSnapshot = {
  hasCredits: boolean
  unlimited: boolean
  balance: string | null
}

export type UiRateLimitWindow = {
  usedPercent: number
  windowDurationMins: number | null
  windowMinutes: number | null
  resetsAt: number | null
}

export type UiRateLimitSnapshot = {
  limitId: string | null
  limitName: string | null
  primary: UiRateLimitWindow | null
  secondary: UiRateLimitWindow | null
  credits: UiCreditsSnapshot | null
  planType: string | null
}

export type UiTokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type UiThreadTokenUsage = {
  total: UiTokenUsageBreakdown
  last: UiTokenUsageBreakdown
  modelContextWindow: number | null
  currentContextTokens: number
  remainingContextTokens: number | null
  remainingContextPercent: number | null
}

export type UiProjectGroup = {
  projectName: string
  threads: UiThread[]
}

export type CollaborationModeOption = {
  value: CollaborationModeKind
  label: string
}
