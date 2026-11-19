function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function publicAccountStatus(value: unknown) {
  const result = record(value)
  const account = record(result?.account)
  if (!result || typeof result.requiresOpenaiAuth !== 'boolean'
    || (result.account !== null && (!account || !['chatgpt', 'apiKey', 'amazonBedrock', 'gcp'].includes(String(account.type))))) {
    throw new Error('Native account state unavailable')
  }
  const display = (value: unknown) => typeof value === 'string' ? value.slice(0, 300) : undefined
  return {
    requiresOpenaiAuth: result.requiresOpenaiAuth,
    account: account ? {
      type: account.type as string,
      email: display(account.email),
      planType: display(account.planType),
      workspaceName: display(account.workspaceName),
    } : null,
  }
}

export function publicLoginChallenge(value: unknown, method: 'chatgpt' | 'chatgptDeviceCode') {
  const result = record(value)
  if (result?.type !== method) throw new Error('Native login response did not confirm the requested method')
  const { loginId } = result
  const text = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit
  if (!text(loginId, 2000)) throw new Error('Native login identity unavailable')
  if (method === 'chatgpt' && text(result.authUrl, 8000)) return { type: method, loginId, authUrl: result.authUrl }
  if (method === 'chatgptDeviceCode' && text(result.verificationUrl, 8000) && text(result.userCode, 200)) {
    return { type: method, loginId, verificationUrl: result.verificationUrl, userCode: result.userCode }
  }
  throw new Error('Native login challenge unavailable')
}
