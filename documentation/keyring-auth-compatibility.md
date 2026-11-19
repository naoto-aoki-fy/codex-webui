# Codex credential storage compatibility

## Current authentication boundary

Authenticate with `codex login` in the independently managed app-server environment,
using the same user, `CODEX_HOME`, and workspace paths as the web backend. See
[setup and reconnect](../docs/external-app-server.md) and
[account acceptance checks](../tests/accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).
The web backend does not launch a local login process, probe `codex login status`,
install Codex, manage saved accounts, or export OS Keyring secrets.

Account status and quotas use native `account/read` and `account/rateLimits/read`.
Managed ChatGPT browser and device-code sign-in use native login RPCs and logout
uses `account/logout`. Browser status exposes only display metadata. The legacy
token-returning RPC is blocked. External token refresh receives an explicit
unsupported reply from WebUI, so configure native Codex-managed authentication
on the App Server host. WebUI password protection is separate from Codex account
authentication. See [native account and submission safety](../docs/native-authentication-state.md).

## Retired features

Local voice transcription and private connector-logo proxying are removed.
`/codex-api/transcribe` and `/codex-api/connector-logo` have no feature handler;
there is no supported feature-token fallback or transcription setup to verify.
Do not use old HTTP 401/422/501 feature-credential expectations as acceptance
criteria. Saved-account switching/import/removal and callback modals are also
retired. Preserve existing credential and legacy account files.

## Verification

From the repository root:

```sh
pnpm exec vitest run src/server/directoryRoutes.test.ts src/server/codexAppServerBridge.authRefresh.test.ts
```

These isolated tests cover the login rejection, retired routes and guarded refresh
boundary. Real file/Keyring authentication requires the external environment;
follow [live acceptance](../tests/website-docs-misc/external-app-server.md) and
record the Codex version and actual results. No Keyring/live login result is
implied by fixture success.
