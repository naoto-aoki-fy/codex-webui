export const QUESTION_REQUEST = 'item/tool/requestUserInput'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function normalizePendingServerRequestMethod(
  method: string,
  params: Record<string, unknown> | null,
): string {
  const normalized = method.trim()
  if (!normalized) return normalized
  switch (normalized) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
    case 'exec_approval_request':
      return 'item/commandExecution/requestApproval'
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
    case 'apply_patch_approval_request':
      return 'item/fileChange/requestApproval'
    case QUESTION_REQUEST:
    case 'request_user_input':
      return QUESTION_REQUEST
    case 'mcpServer/elicitation/request':
    case 'elicitation_request':
      return 'mcpServer/elicitation/request'
    case 'item/permissions/requestApproval':
      return normalized
    case 'item/tool/call':
    case 'dynamic_tool_call_request':
      return 'item/tool/call'
  }

  if (looksLikeExecApprovalRequest(params)) return 'item/commandExecution/requestApproval'
  if (looksLikePatchApprovalRequest(params)) return 'item/fileChange/requestApproval'
  if (looksLikePermissionsApprovalRequest(params)) return 'item/permissions/requestApproval'
  if (Array.isArray(params?.questions)) return QUESTION_REQUEST
  if (looksLikeMcpServerElicitationRequest(params)) return 'mcpServer/elicitation/request'
  if (looksLikeToolCallRequest(params)) return 'item/tool/call'
  return normalized
}

function looksLikeExecApprovalRequest(params: Record<string, unknown> | null): boolean {
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

function looksLikePatchApprovalRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  if (typeof params.grantRoot === 'string' && params.grantRoot.trim().length > 0) return true
  if (typeof params.grant_root === 'string' && params.grant_root.trim().length > 0) return true
  if (asRecord(params.fileChanges)) return true
  return asRecord(params.changes) !== null
}

function looksLikeToolCallRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  return (
    typeof params.toolName === 'string' ||
    typeof params.tool_name === 'string' ||
    typeof params.name === 'string' ||
    Array.isArray(params.arguments)
  )
}

function looksLikeMcpServerElicitationRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  const mode = typeof params.mode === 'string' ? params.mode.trim() : ''
  return (
    typeof params.serverName === 'string' &&
    typeof params.threadId === 'string' &&
    typeof params.message === 'string' &&
    (mode === 'form' || mode === 'url')
  )
}

function looksLikePermissionsApprovalRequest(params: Record<string, unknown> | null): boolean {
  if (!params) return false
  return (
    typeof params.threadId === 'string' &&
    typeof params.turnId === 'string' &&
    typeof params.itemId === 'string' &&
    asRecord(params.permissions) !== null
  )
}
