/** Public recovery state only: credentials and account identities stay on the App Server. */
export type NativeAuthenticationState = {
  phase: 'checking' | 'ready' | 'signedOut' | 'pending' | 'reconciliation' | 'unknown' | 'disconnected'
  blocking: boolean
  revision: number
  loginId?: string | null
}
