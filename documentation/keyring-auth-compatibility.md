# Codex credential storage compatibility

## Current authentication boundary

Authenticate with `codex login` in the independently managed app-server environment,
using the same user, `CODEX_HOME`, and workspace paths as the web backend. See
[setup and reconnect](../docs/external-app-server.md) and
[account acceptance checks](../tests/accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).
The web backend does not launch a local login process, probe `codex login status`,
install Codex, manage saved accounts, or export OS Keyring secrets.

Account status and quotas use `account/read` and `account/rateLimits/read` on the
connected server. Logout uses `account/logout`; authenticate again externally and
reconnect. POSTs to `/codex-api/accounts/login/start` and
`/codex-api/accounts/login/complete` return HTTP 409 with external-authentication
guidance. CLI `--login` and `--no-login` are compatibility no-ops; the `login`
subcommand explains external ownership. Web password protection is separate from
Codex authentication.

## Retained compatibility paths

The public `getAuthStatus` RPC forces `includeToken: false` and returns metadata
with `authToken: null` (see [credential helper](../src/server/codexCredentials.ts)).
A bundled schema describes a protocol snapshot, not a promise that the connected
server supports that method or releases tokens.

Legacy host-managed `account/chatgptAuthTokens/refresh` handling remains in the
[bridge](../src/server/codexAppServerBridge.ts). It checks effective file storage
before reading and persisting file tokens, rejects non-file storage, and aborts
persistence if credentials change concurrently. This compatibility path does not
make Keyring credentials exportable. Prefer native Codex-managed refresh.

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
pnpm exec vitest run src/server/accountRoutes.test.ts src/server/directoryRoutes.test.ts src/server/codexAppServerBridge.authRefresh.test.ts
```

These isolated tests cover the login rejection, retired routes and guarded refresh
boundary. Real file/Keyring authentication requires the external environment;
follow [live acceptance](../tests/website-docs-misc/external-app-server.md) and
record the Codex version and actual results. No Keyring/live login result is
implied by fixture success.
