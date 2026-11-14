export type CredentialRpc = { rpc(method: string, params: unknown): Promise<unknown> }

export class CodexCredentialError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message)
    this.name = 'CodexCredentialError'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function credentialRpc(appServer: CredentialRpc, method: string, params: unknown): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      appServer.rpc(method, params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Credential request timed out')), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Public RPC proxy must expose metadata only, regardless of requested parameters. */
export async function readPublicAuthStatus(appServer: CredentialRpc, params: unknown): Promise<unknown> {
  try {
    const status = record(await credentialRpc(appServer, 'getAuthStatus', { ...record(params), includeToken: false }))
    return {
      authMethod: text(status?.authMethod) ?? null,
      authToken: null,
      requiresOpenaiAuth: typeof status?.requiresOpenaiAuth === 'boolean' ? status.requiresOpenaiAuth : null,
    }
  } catch {
    throw new CodexCredentialError(503, 'codex_auth_status_unavailable', 'Codex authentication status could not be read. Reconnect Codex and try again.')
  }
}
