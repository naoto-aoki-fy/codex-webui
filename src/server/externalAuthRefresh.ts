export type ChatgptAuthTokensRefreshParams = {
  reason?: string
  previousAccountId?: string | null
}

export type ChatgptAuthTokensRefreshResponse = {
  accessToken: string
  chatgptAccountId: string
  chatgptPlanType: string | null
}

export async function refreshChatgptAuthTokensForExternalAuth(
  params: ChatgptAuthTokensRefreshParams = {},
  readCredentialStore: () => Promise<string> = async () => 'unknown',
): Promise<ChatgptAuthTokensRefreshResponse> {
  throw new Error('Client-managed token refresh is unsupported. Run codex login on the App Server host and use Codex-managed authentication there.')
}
