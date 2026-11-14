/** External token refresh is not supported; authentication is owned by Codex. */
export async function refreshChatgptAuthTokensForExternalAuth(): Promise<never> {
  throw new Error('Client-managed token refresh is unsupported. Run codex login on the App Server host and use Codex-managed authentication there.')
}
