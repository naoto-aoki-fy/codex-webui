# Native account and submission safety

The App Server owns authentication and credentials. WebUI uses native
`account/read` with refresh disabled, `account/login/start` for ChatGPT browser
or device-code sign-in, `account/login/cancel` for an identified login, and
`account/logout`. The App Server enforces its login policy. WebUI checks loaded
conversation activity once before starting sign-in, using metadata-only reads.
Use the Codex host for native API-key or externally managed credentials.

WebUI returns only account type, email, plan and workspace display name. The
initiating browser receives the native authorization link or device code in
memory until completion or disconnect. WebUI rejects the old token-returning RPC
and browser access to native session switching and external token management.

## Backend submission guard

The App Server's account read describes the currently visible account. It does
not identify an incomplete login, confirm a lost logout response, or identify
whether a ChatGPT workspace changed behind the same display name. The in-memory
guard in `src/server/nativeAuthenticationState.ts` uses native login IDs and
completion notifications, plus native session identity when available, to cover
those cases. It checks chat, steer, deferred queue writes and review at dispatch.
Uncertain writes are never replayed. Verified sends add no account RPCs.

The browser consumes the guard's single status projection through
`native-authentication/read` and `native-authentication/state`. That projection
includes the display-safe fields from the guard's existing native read, avoiding
a separate browser account read. `native-authentication/reconcile` remains for
explicit acknowledgment of the current guard revision after an unresolved
operation or workspace change. The server checks fresh evidence before allowing
submission and retires an acknowledgment if the connection or account changes
during verification. No WebUI credential or authentication state is saved to disk.

An outstanding native login ID is held for the backend lifetime, including browser
reloads. After a backend restart, complete or cancel the original flow on the App
Server host. Independent native clients can still change accounts, and upstream
does not provide an atomic activity lock across clients.

See the [account acceptance test](../tests/accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).
