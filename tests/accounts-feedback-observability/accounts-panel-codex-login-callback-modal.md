### External Codex authentication and legacy login removal

#### Prerequisites
- Run an independently managed Codex app-server and connect the web app to its WebSocket URL.
- Use a disposable account/server environment for logout. Never put real tokens in reports.

#### Actions and expected results
1. Open Settings with an authenticated external server. The account panel shows `Signed in to Codex`. Reload reads status through `account/read` without launching Codex or opening a callback modal.
2. Click Reload. Status and rate limits refresh through normal RPCs; no `/accounts/login/start` or `/accounts/login/complete` request occurs.
3. Click Logout while no turn or approval is active. The app calls `account/logout` and displays instructions to authenticate on the external server. Legacy saved-account files remain untouched.
4. Authenticate in the external server environment and reconnect the app. Reload the account status and confirm it reflects that server.
5. Disconnect the external server. Existing connection-error handling remains available; no local CLI login probe or installer runs.
6. Repeat the account-panel checks in light and dark themes. No login URL, callback input, or modal appears in either theme.
7. POST to the old `/codex-api/accounts/login/start` and `/codex-api/accounts/login/complete` endpoints. Both return 409 with external authentication/reconnect guidance without spawning a process or changing credentials.
8. Run the built CLI with `--sandbox-mode workspace-write`, `--approval-policy never`, and `--no-memories` separately. Each exits with an unknown-option error. `login` likewise explains external authentication.

#### Cleanup
Stop only disposable processes. Restore authentication in the external server if needed. Do not migrate or delete existing credential files or legacy account archives.

#### Performance audit
Reference analysis confirms the removed authentication cache had no production readers and the installer/probe had no production callers. Removing notification-side cache writes adds no RPCs, blocking work, fanout, payloads, or cache invalidation dependencies. Status still uses `account/read`; connection ownership and reconnect behavior remain unchanged. Live latency and theme screenshots were not measured for this dead-code removal.
