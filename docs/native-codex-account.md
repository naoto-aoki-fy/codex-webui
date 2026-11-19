# Native Codex account controls

The Codex App Server manages authentication, credentials and workspace selection.
WebUI sends turns, steering requests and conversation operations to the App Server
through the usual RPC bridge. The App Server applies its current account and
authentication policy to each request. WebUI displays authentication failures
from the RPC response.

Open **Settings → Codex account** to read native account details on demand.
The read uses `account/read` with token refresh disabled and exposes only
display metadata. While the panel is open, a native account update or reconnect
refreshes the details. Managed ChatGPT browser and device-code sign-in use
`account/login/start`. Explicit sign-in checks loaded conversation activity before
requesting the native challenge. Cancel uses `account/login/cancel` with the
attempt's login ID. Logout uses `account/logout`. The App Server enforces its
sign-in policy and owns the account across browsers. Other clients can start
work after WebUI checks the loaded conversations.

The initiating browser holds the authorization link or device code in memory
until completion, cancellation or disconnect. If a browser reload or connection
loss discards those controls, finish the original sign-in using its authorization
page or manage it on the App Server host. WebUI never replays an account mutation.
Use the Codex host for API-key or externally managed credentials. The old
token-returning RPC, native session switching and browser-managed token access
are blocked. The WebUI password is separate from Codex authentication.

See the [account acceptance test](../tests/accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).
