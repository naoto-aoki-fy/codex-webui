# Native authentication state

The Codex App Server owns credentials and current account state. Each backend
`AppServerClient` owns one in-memory verification state machine and native-login
operation. All attached browsers share its transitions. Profiles are process-scoped;
changing profiles requires restarting that backend. Separate clients share no flags.

## Reproduced failure and protocol evidence

In `caf1866`, every `account/updated` event installed a manual reconciliation block.
Hydration returned that block without verification, and even matching successful
login completion retained it after reading a usable account. Regression tests
reproduce that mechanism. The original incident's upstream trigger remains unknown;
there is no evidence here that token refresh, duplicate events, or switching caused it.

Protocol fields were checked with the installed `codex-cli 0.167.2`:

```sh
codex app-server generate-ts --out /tmp/native-auth-protocol
codex app-server generate-ts --experimental --out /tmp/native-auth-protocol-experimental
```

`account/read` returns account type, email, plan and a **display** workspace name.
Those fields cannot establish user/workspace identity. The optional experimental
read-only `accountSession/list` API supplies `activeSessionId` and sessions with
`sessionId`, `userId`, `selectedWorkspaceAccountId`, and `isActive`. This client already
negotiates experimental APIs. Verification requests `refreshWorkspaceMetadata: false`,
accepts one active session matching the selected session, and compares the complete
nonempty session/user/workspace tuple. It retains only that tuple in backend memory;
it never publishes or logs these identities or reads credentials. Session inventories
above 100 entries are treated as ambiguous, without further enumeration.

An unavailable API, missing user/workspace IDs, or ambiguous session selection cannot
prove continuity. Email, plan, auth mode, workspace display name and rate-limit
percentages are never substitutes. API-key accounts also lack stable credential
identity in this protocol; credential inspection is deliberately avoided.

## Transition policy

| Event/evidence | Behavior |
| --- | --- |
| Startup / backend restart | Verify the actual account on first state read or send. A usable account establishes the new backend baseline. No pending marker is restored. |
| `account/updated` | Immediately block, invalidate account caches through a versioned snapshot, and schedule automatic checking. The notification is not itself evidence of a changed identity. |
| Usable account, unchanged stable identity, no unresolved operation | Automatically become ready. No manual reconnect or acknowledgment is needed. |
| Provider does not require OpenAI authentication | Use the connection's external-provider context. Its unchanged no-auth state remains usable without inventing an OpenAI identity. A transition from another verified context follows the change policy. |
| Different session/user/workspace | Keep `reconciliation` with `account-context-changed`. Old-context caches are invalidated. Inspect and explicitly acknowledge the current context before sending. |
| Usable account, continuity unavailable | Keep `reconciliation` with `account-identity-unavailable`. Explicit inspection/acknowledgment is required. |
| Authentication-required signed-out account | Show sign-in guidance. Retain the previous context baseline so external sign-out cannot conceal a subsequent workspace/user change. |
| Failed/malformed account read | Keep `unknown` with `account-verification-failed`; offer retry and inspection. There is no automatic error retry or success assumption. |
| Login start awaiting response / known login ID / uncertain write | Keep operation ownership and block sends, even if an account read returns a usable account. |
| Matching successful login completion | Release that operation, verify the account, invalidate caches and establish the newly signed-in context automatically. Native completion authorizes this deliberate context establishment; routine notifications do not. |
| Failed completion or acknowledged cancellation | Release the operation and verify actual state. Signed-out accounts need sign-in; unexpected usable contexts follow the continuity/change policy. |
| Cancellation `notFound` | Release ownership of that ID but retain an unknown operation outcome for explicit recovery. |
| Disconnect | Retire evidence by connection generation, clear transient browser credentials, and block. Keep known operation ownership. Reconnect checks fresh evidence; account reads cannot erase a retained login ID. |
| Explicit acknowledgment | With no known pending login, verify a fresh current account and establish its context. Another notification or disconnect during acknowledgment retires that permission. Unknown writes are never replayed. |

Matching completion may arrive before the start response: at most four completion
IDs are retained until the response identifies the owned login. Unrelated events do
not end it. Cancellation/completion races and late replies cannot install retired
operation state. No timeout clears a pending operation, submits a message, repeats
login, or issues cancellation.

The native API cannot recover an outstanding login ID after backend restart. Complete
its original native flow or manage it on the App Server host. A verified usable account
can establish the restarted backend's baseline; a signed-out account still needs login.

## Bounded verification and dispatch safety

Notification bursts share a 25 ms scheduling slot. At most one verification runs and
one dirty follow-up is retained. Every superseding update retires the old result and
queues a check of the latest state after the current pass settles. New invalidations
cause follow-ups; failures never retry themselves. There is no periodic polling or
unbounded concurrent fanout. Hydration joins an existing check, and an explicit read
can retry an unavailable/ambiguous state safely without acknowledging a new context.

Fresh account verification uses one `account/read` and, for ChatGPT, at most one
`accountSession/list`. Verified sends and repeated ready snapshots issue no account
reads. Results are owned by both connection generation and evidence revision. A
usable read is current evidence, not a guarantee that subsequent upstream requests
will succeed. Independent native clients still lack an atomic cross-client account
or activity lock.

`turn/start`, `turn/steer`, queue add/update/start and `review/start` remain guarded.
There is a final synchronous guard immediately before upstream dispatch, after any
initialization or attachment-index wait. Interrupt/cancellation controls remain
available for recovery.

## Browser and cache coordination

`native-authentication/read` hydrates each notification-stream readiness/reconnect;
`native-authentication/state` carries ordered revisions, connection generation,
context revision, reason and operation ownership over existing WS/SSE streams.
Each browser invalidates account inspection, auth status, model catalog and rate-limit
read ownership **before** publishing eligibility for a new context revision. It then
refreshes models/rates after verified readiness. Old values are unavailable during
refresh rather than retained as account-specific evidence. User model preferences,
drafts, conversation history and protected fork/metadata capabilities are preserved.

Cache invalidation and native-auth connection lifetime use separate epochs: clearing
caches must not retire the initiating login response. Backend readiness retires local
sign-in recovery/inspection work, clears credentials and removes stale presentation
latches. Raw `account/updated` events carry no ordering evidence and cannot overwrite
a versioned backend snapshot. Older hydration responses and inspection results cannot
overwrite newer verified state. All browsers apply this policy independently before
enabling their composers; a browser inconsistency still cannot bypass backend guards.

Authentication flags remain absent from localStorage. Startup migration deletes only
the obsolete legacy/profile pending keys; unrelated preferences and drafts survive.

## Diagnostics and explicit recovery

The state reason distinguishes automatic `checking`, sign-in-required, unresolved
operations, changed identity, unavailable continuity, and failed verification. Sign-in,
inspection, exact cancellation and safe verification retry remain available as
appropriate; a send block does not disable all authentication controls.

The existing `/codex-api/connection-diagnostics` response includes an `authentication`
ring with at most 32 transitions/outcomes: reason, previous/next phase, connection
generation, revision and an unresolved-operation boolean. It includes superseded
verification outcomes and never contains identity values, login IDs, URLs, codes,
tokens, upstream error details or credentials.

Deploying this change requires restarting the backend so it constructs the new state
machine. No database migration, credential reset or browser storage reset is needed.

## Validation

Automated regressions cover unchanged updates, coalesced bursts, superseding events,
hydration/inspection ordering, automatic matching completion, pending ownership,
changed user/workspace, signed-out/failed/ambiguous evidence, shared browsers,
independent contexts, disconnects, final dispatch guards, cancellation races,
completion before acknowledgment, restart limitations and legacy-key migration.

The CJS browser fixture `scripts/test-risk-native-authentication.cjs` runs the production
state machine with simulated protocol responses and the real built UI. It exercises
login, burst updates and reload-during-verification without manual recovery clicks,
checks a second browser on the same backend, and preserves an explicit block after a
workspace ID change with unchanged display fields. Screenshots at 1280×900, 375×812
and 768×1024 cover light/dark ready and intervention states under `output/playwright/`:
`auth-auto-ready-<width>-<theme>.png` and `auth-context-change-<width>-<theme>.png`.

Test URL: `http://127.0.0.1:4173/#/thread/approved-fixture`. Playwright interception is
required to inject protocol events and storage. The existing listener's process/cwd
was not visible through `lsof`, so `APPROVED_DIST_ROOT` serves this checkout's current
production assets through interception. This does not rely on that listener's source.
No live App Server, OAuth, credential flow or production latency is claimed.

Final verification against the implemented source:

- `pnpm run test:unit`: **1,553 passed, 2 skipped** (141 passing test files).
- `pnpm run typecheck` and `pnpm run build`: passed.
- `pnpm run test:integration:fixture`: passed for the built CLI and dev server,
  including one upstream connection per backend and structured native errors.
- Browser fixture: passed at all three viewports in both themes. A twenty-event burst
  required one account-verification pass; no manual reconciliation/reconnect or
  message submission occurred during automatic recovery.
- Backend request-count tests: concurrent hydration coalesces; ordinary verified sends
  add zero account reads. Verification errors cause no self-retry.
- Build output: native-auth UI chunk 10.38 kB (3.79 kB gzip), versus 9.32 kB (3.47 kB
  gzip) in the preceding build; CLI 199.15 kB, versus 194.57 kB. No new dependency.
- Public CLI CJS-launcher smoke command:

  ```sh
  node -e "const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(result.status!==0||!result.stdout.includes('--app-server-url'))throw new Error(result.stderr||result.stdout);console.log('PASS CJS launcher: public CLI exposes --app-server-url')"
  ```

  Result: `PASS CJS launcher: public CLI exposes --app-server-url`. The public CLI is
  ESM; the smoke check invokes it from CJS rather than requiring a nonexistent CJS export.

## Modified files

- [docs/native-authentication-state.md](../docs/native-authentication-state.md)
- [scripts/test-risk-native-authentication.cjs](../scripts/test-risk-native-authentication.cjs)
- [src/App.vue](../src/App.vue)
- [src/components/sidebar/NativeAuthentication.vue](../src/components/sidebar/NativeAuthentication.vue)
- [src/composables/backendAuthentication.test.ts](../src/composables/backendAuthentication.test.ts)
- [src/composables/backendAuthentication.ts](../src/composables/backendAuthentication.ts)
- [src/composables/nativeAuthentication.test.ts](../src/composables/nativeAuthentication.test.ts)
- [src/composables/nativeAuthentication.ts](../src/composables/nativeAuthentication.ts)
- [src/composables/useDesktopState.messages.test.ts](../src/composables/useDesktopState.messages.test.ts)
- [src/composables/useDesktopState.modelPreferences.test.ts](../src/composables/useDesktopState.modelPreferences.test.ts)
- [src/composables/useDesktopState.test.ts](../src/composables/useDesktopState.test.ts)
- [src/composables/useDesktopState.ts](../src/composables/useDesktopState.ts)
- [src/server/appServerClient.rpcLifecycle.test.ts](../src/server/appServerClient.rpcLifecycle.test.ts)
- [src/server/appServerClient.ts](../src/server/appServerClient.ts)
- [src/server/codexAppServerBridge.ts](../src/server/codexAppServerBridge.ts)
- [src/server/nativeAuthenticationState.test.ts](../src/server/nativeAuthenticationState.test.ts)
- [src/server/nativeAuthenticationState.ts](../src/server/nativeAuthenticationState.ts)
- [src/types/nativeAuthentication.ts](../src/types/nativeAuthentication.ts)
- [tests/thread-loading-state/risk-first-observation.md](../tests/thread-loading-state/risk-first-observation.md)
