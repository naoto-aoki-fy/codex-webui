# Native authentication state

The external Codex App Server owns credentials and account identity. Each backend
`AppServerClient` owns an in-memory authentication state machine for that connection.
All browsers connected to it observe the same recovery state. Connection profiles
are selected per backend process; changing profiles requires a process restart.
Separate client instances never share authentication flags.

Previously, each browser stored a profile-scoped pending boolean in localStorage.
Reload restored the boolean without checking the actual account. A missed event or
interrupted recovery could keep that browser blocked indefinitely, while another
browser and direct backend RPC calls could bypass its barrier.

## State and transitions

| Event | Backend behavior |
| --- | --- |
| First state read or send after startup | Read `account/read` with `refreshToken: false`; accept a valid account or a provider that does not require OpenAI authentication. An auth-required signed-out account blocks sends. |
| Login starts | Mark pending before asynchronous work; verify the signed-out precondition and submit once. Retain the returned login ID in memory. Concurrent starts are rejected. |
| Matching completion | Read the actual account. Success or an account change requires reconciliation. Failure with a signed-out account releases the operation, but authentication is still required before sending. |
| Completion precedes response | Retain at most four completion IDs until the start response identifies the matching operation. Ignore unrelated completions. |
| Explicit cancellation | Cancel only the backend-held login ID. Verify the acknowledgment and actual account; unexpected outcomes remain blocked. |
| Definitive validation/method rejection | Re-read account state. Internal failures and uncertain writes remain unknown, with no replay. |
| `account/updated` | Require reconciliation immediately and invalidate frontend account/model/rate-limit evidence. Preserve an outstanding login identity. |
| App Server disconnect | Block immediately; retire in-flight account reads. Keep the known login identity. |
| Reconnect | The next state read/send checks the account again. A known pending operation remains pending. |
| Explicit recovery | After inspection/reconnect, `native-authentication/reconcile` reads fresh account evidence. A valid account resolves uncertainty; a signed-out account cannot clear a known pending login. |
| Backend restart | Discard process memory and reconstruct from the actual account on first use. Never restore a pending marker. |

No elapsed-time rule clears authentication state. RPC deadlines mark outcomes as
uncertain; they do not establish success or cancellation.

## Browser synchronization and sending

`native-authentication/read` hydrates the browser at notification-stream readiness
and after reconnect. `native-authentication/state` pushes transitions through the
existing WS/SSE stream. Initial state, notification loss, and failed hydration block
the composer until a backend snapshot arrives. A pushed transition retires an older
HTTP snapshot so it cannot undo a newer block.

The backend validates `turn/start`, `turn/steer`, queue add/update/start and
`review/start`. It rechecks immediately before the wire write, including after
asynchronous attachment-index work. A stale browser cannot authorize a send.
Interrupt and cancellation operations remain available for recovery.

The sign-in panel keeps presentation state, account inspection results, URLs and
device codes only in memory. Reloaded browsers receive the pending login ID and can
cancel it without replaying login or recovering a URL/code. Reconciliation is shared:
its acknowledgment publishes the verified state to every connected browser.

## Migration and limitations

Startup deletes only `codex-web-local.native-authentication-pending.v1` and its
`codex-profile.<profile>.` variants. Their values never influence authentication.
Preferences, drafts and conversation storage remain untouched. Restricted browser
storage cannot prevent recovery.

The native account API does not enumerate outstanding login operations. After a
backend restart, an old login ID/URL/code cannot be recovered: finish sign-in in its
original native flow or manage authentication on the App Server host. A signed-out
auth-required server remains blocked; a verified valid account restores sending.
No database is needed to reconstruct this evidence.

Coordination covers browsers using the same backend connection. Independent
backends or external native clients share only the App Server's account events and
account reads; the native API supplies no atomic cross-client activity lock.

## Performance and verification

There is one small state RPC per browser stream readiness/reconnect, plus one account
read when a fresh ready/disconnected backend snapshot needs verification. Concurrent
state reads coalesce; pending/reconciliation snapshots require no account read.
Verified ordinary sends add only constant-time guards and no additional RPCs. Login,
completion, cancellation and deliberate reconciliation add bounded account reads.
There are no polling timers, new subscriptions, disk writes, history scans, or
unbounded fanout. Transition notifications use the existing subscriber set and carry
only phase, revision, blocking status and an optional login ID.

Automated coverage: `src/server/nativeAuthenticationState.test.ts`,
`src/composables/backendAuthentication.test.ts`, and the existing native sign-in and
desktop orchestration tests. The intercepted browser fixture
`scripts/test-risk-native-authentication.cjs` verifies the real sign-in/recovery UI
in light/dark themes; it does not prove live credential/provider compatibility.

The browser fixture asserts exactly five hydration requests per viewport for five
readiness events (initial load, pending reconnect, pending reload, reconciliation
reload and recovered reload), with no duplicate hydration or message sends. Backend
tests assert three concurrent hydration requests use one upstream account read and
three verified sends add zero account reads. Live App Server latency and real OAuth
flows were not measured.

## Modified files

- [scripts/test-external-app-server.cjs](../scripts/test-external-app-server.cjs)
- [scripts/test-risk-native-authentication.cjs](../scripts/test-risk-native-authentication.cjs)
- [src/App.vue](../src/App.vue)
- [src/components/sidebar/AccountSettingsPanel.vue](../src/components/sidebar/AccountSettingsPanel.vue)
- [src/components/sidebar/NativeAuthentication.vue](../src/components/sidebar/NativeAuthentication.vue)
- [src/composables/desktopConnection.ts](../src/composables/desktopConnection.ts)
- [src/composables/nativeAuthentication.test.ts](../src/composables/nativeAuthentication.test.ts)
- [src/composables/nativeAuthentication.ts](../src/composables/nativeAuthentication.ts)
- [src/composables/useDesktopState.messages.test.ts](../src/composables/useDesktopState.messages.test.ts)
- [src/composables/useDesktopState.modelPreferences.test.ts](../src/composables/useDesktopState.modelPreferences.test.ts)
- [src/composables/useDesktopState.test.ts](../src/composables/useDesktopState.test.ts)
- [src/composables/useDesktopState.ts](../src/composables/useDesktopState.ts)
- [src/server/appServerClient.rpcLifecycle.test.ts](../src/server/appServerClient.rpcLifecycle.test.ts)
- [src/server/appServerClient.test.ts](../src/server/appServerClient.test.ts)
- [src/server/appServerClient.ts](../src/server/appServerClient.ts)
- [src/server/turnGenerationMetadata.test.ts](../src/server/turnGenerationMetadata.test.ts)
- Removed `src/utils/nativeAuthenticationPending.ts` (obsolete browser persistence helper).
- [tests/thread-loading-state/risk-first-observation.md](../tests/thread-loading-state/risk-first-observation.md)
- [docs/native-authentication-state.md](../docs/native-authentication-state.md)
- [src/composables/backendAuthentication.test.ts](../src/composables/backendAuthentication.test.ts)
- [src/composables/backendAuthentication.ts](../src/composables/backendAuthentication.ts)
- [src/server/nativeAuthenticationState.test.ts](../src/server/nativeAuthenticationState.test.ts)
- [src/server/nativeAuthenticationState.ts](../src/server/nativeAuthenticationState.ts)
- [src/types/nativeAuthentication.ts](../src/types/nativeAuthentication.ts)
- [src/utils/legacyNativeAuthenticationStorage.ts](../src/utils/legacyNativeAuthenticationStorage.ts)

## Validation results

- `pnpm run test:unit`: 1,528 passed, 2 skipped. After the final pending-identity UI
  adjustment, the two relevant native-authentication/desktop suites passed all 230
  tests again.
- `pnpm run typecheck` and `pnpm run build`: passed.
- `pnpm run test:integration:fixture`: passed for built CLI and development server,
  including correlated native errors and a single upstream connection per backend.
- Browser fixture: passed all assertions at 1280×900, 375×812 and 768×1024 in both
  light and dark themes, including post-refresh persistence/recovery evidence.
- CJS public-entry smoke command (the package itself exposes an ESM CLI):

  ```sh
  node -e "const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(result.status!==0||!result.stdout.includes('--app-server-url'))throw new Error(result.stderr||result.stdout);console.log('PASS CJS launcher: public CLI exposes --app-server-url')"
  ```

  Result: `PASS CJS launcher: public CLI exposes --app-server-url`.

The browser test used Playwright route/WebSocket interception because it must inject
native events and seed localStorage. The existing port 4173 listener's owner/cwd was
not visible in the tool environment, so `APPROVED_DIST_ROOT` served this checkout's
freshly built assets through the fixture. It did not rely on that listener's source
checkout. Test URL: `http://127.0.0.1:4173/#/thread/approved-fixture`.

Evidence files (under `output/playwright/`, intentionally uncommitted):
`risk-29-workflow-{1280,375,768}-{light,dark}.png` and
`evidence-29-recovery-{1280,375,768}-{light,dark}.png`. The recovered composer was
asserted enabled after reload; pending/reconciliation composers were asserted
disabled. Screenshots cover the actual sign-in and recovery controls.
