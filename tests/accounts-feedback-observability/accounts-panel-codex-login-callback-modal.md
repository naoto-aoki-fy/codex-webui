# Native Codex account controls and submission safety

Use a disposable App Server and account, or run the credential-free
`scripts/test-risk-native-authentication.cjs` fixture against the current dev
server on port 4173. Use light and dark themes.

1. In a signed-out account, open Settings → Codex account. Choose ChatGPT browser
   sign-in, confirm, and start. The UI shows the native authorization link and
   pauses sends. Reload, open Settings and cancel the identified attempt. Expect
   no repeated login and no authorization link from the previous document.
2. Repeat using device-code sign-in. Complete the matching login and verify the
   dialog displays the account and workspace. An unrelated completion does not
   enable sends. The link and code disappear on acknowledgment.
3. Change only the native workspace ID. The composer blocks and the current
   account needs explicit confirmation. Review the status, confirm this account
   and workspace, then send one test chat after verification.
4. While idle, click Logout. Expect one native logout, signed-out status, and
   disabled submission. A lost response keeps the guard closed until verified
   and explicitly acknowledged.
5. Inspect the Network log. Opening Settings adds no account or login-policy
   requests. The legacy token RPC returns forbidden. Native account and login
   replies expose only display metadata or the sign-in challenge.

Cancel any remaining fixture sign-in, discard the disposable browser context,
and restore the original theme. Use disposable credentials for live testing.
