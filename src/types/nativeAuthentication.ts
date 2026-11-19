/** Public recovery state only: credentials and account identities stay on the App Server. */
export type NativeAuthenticationState = {
  phase: 'checking' | 'ready' | 'signedOut' | 'pending' | 'reconciliation' | 'unknown' | 'disconnected'
  blocking: boolean
  revision: number
  loginId?: string | null
  reason?: string
  generation?: number
  contextRevision?: number
  operationUnresolved?: boolean
  account?: { type: string; email?: string; planType?: string; workspaceName?: string } | null
}
