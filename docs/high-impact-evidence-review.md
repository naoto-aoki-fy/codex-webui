# High-impact acceptance evidence review

Subsequent [finalization](implementation-finalization.md) operationally withholds the deletion mutation in the UI and controller. The analysis below describes the reviewed revision; its formerly available deletion submission is historical, not current behavior.
Standalone command controls described in this historical review were later removed from WebUI.

Review began on clean `main` at actual revision
`5ff6df5597e670f0f382b1b69bc70c736fe2c36c`. There was no merge or rebase in
progress. Corrected product source is `5fcf321414e92a81b231f2dd820553ee26c5bd18`.
The original **4 IMPLEMENTED / 8 PARTIAL / 4 BLOCKED** feature classifications
are preserved. These safety verdicts do not promote partial features or reopen
blocked features or withheld extensions. All new live acceptance remains
**NOT RUN**, including the operations considered here. Previous 09/11 acceptance
limitations are unchanged; no designated data was supplied or used.

Contracts below refer to official Codex **rust-v0.169.0**, commit
[`d32063f96c2dff1dc96af839b3952abb6acfeda4`](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs).
The matching cached release source and upstream tests were inspected. The four
request/store processors were also fetched directly at that immutable revision.
Upstream Rust tests were **inspected, not executed** during this review. Browser
interception and the integration fixture prove application behavior under the
modeled contract; neither independently proves enforcement on a deployed server.

| Safety property | Verdict | Evidence and remaining acceptance boundary |
|---|---|---|
| 1. Deletion excludes children created after confirmation | **GAP** | There is no execution-time leaf-only condition. Native deletion enumerates and deletes the subtree when the write executes. Existing prechecks and completion correlation do not prevent a later child from being included. Withhold leaf-only deletion acceptance; the smallest safe restriction is to withhold this mutation when descendant preservation is required, pending a native atomic leaf-only precondition. |
| 2. Standalone command permissions and ownership | **PASS** for the inspected supported native contract | The request supplies actual sandbox policy, and native managed-policy validation and sandbox construction enforce it on supported Linux/macOS executors. UI checks positively identify the local App Server environment, POSIX shell/cwd, confirmation and Full-access allowance. Process control uses the exact caller-generated ID on the original upstream connection; no uncertain execution is replayed. Actual deployment/platform enforcement remains live **NOT RUN**. |
| 3. Native sign-in activity check | Limited to loaded conversations | WebUI checks loaded conversation activity before explicit sign-in. Other clients can start work after the check. |
| 4. Queue recovery and duplicate prevention | **GAP** for native exactly-once guarantees; local lost-reply/reload defect corrected | Native IDs permit correlation, not idempotent add. A bounded profile-scoped identity receipt now guards remotely committed/lost-reply submissions across reload/reconnect. No automatic replay occurs. Explicitly acknowledging uncertainty permits a new submission that can duplicate execution; native start and durable removal are separate steps. |

## 1. Permanent deletion and concurrent child creation

Application locations:

- [Preview validation](../src/api/threadDeletion.ts#L5): requires exact native idle
  metadata and complete empty active/archived direct-child pages.
- [Submission](../src/composables/threadDeletion.ts#L14): repeats those reads, then
  sends only `thread/delete {threadId}`. There is an interval after the last read
  before native execution. Typed ID and confirmation do not close it.
- [Scope disclosure](../src/components/content/PermanentDeletion.vue#L17): expressly
  describes possible owned-child deletion and activity after preflight.
- [Portable import guard](../src/server/conversationTransfer.ts): the native
  deletion route rejects persisted imported destinations. It is not a descendant
  creation lock.

Native evidence:

- [`ThreadDeleteParams`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L741)
  contains only the thread ID: no expected revision, expected descendants or
  reject-if-non-leaf condition.
- [`thread_delete_response`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/thread_delete.rs#L31)
  obtains the current spawn subtree, checks attached resources, prepares its
  members and deletes the descendants before the root. Its thread-list permit
  does not compare the subtree against the earlier UI snapshot. A child already
  recorded when this enumeration runs can be deleted even though the UI lists
  were empty. Attached-process and external-Fork guards enforce different rules.
- Inspected upstream tests `thread_delete_deletes_spawned_descendants` and
  `thread_delete_preflights_external_fork_references_for_spawned_subtrees` in
  `app-server/tests/suite/v2/thread_delete.rs` establish intended subtree and
  reference behavior, not an atomic leaf-only guarantee.

Existing application tests in [threadDeletion.test.ts](../src/composables/threadDeletion.test.ts):

- `rechecks child identity and ignores unsupported filters/cursors`: rejects a
  child visible to the second preflight. It does **not** cover or eliminate a
  child created after that preflight.
- `requires exact typed identity and confirmation; ACK alone never means completed`:
  establishes confirmation/notification ownership, not deletion scope isolation.
- `stops chained requests if selection, epoch or component confirmation changes`:
  establishes client ownership before each request.

**Smallest safe restriction:** do not use or accept this UI as a guarantee of
deleting only one conversation. Where descendants must survive, withhold permanent
deletion and retain the existing archive workflow. A server-side atomic
reject-if-has-descendants condition, enforced with the actual delete, is required
to expose guaranteed leaf-only deletion. Another list request, a browser mutex,
confirmation text or a completed event cannot provide that protection. This
review documents the gap; it does not add a substitute native deletion contract.

## 2. Standalone command permission enforcement

Application submission path:

- [inspectShell / shellParameters](../src/api/nativeShell.ts#L10) requires an idle
  native thread with exactly one `local` environment whose cwd matches the
  thread's absolute POSIX cwd. `environment/info {environmentId:'local'}` must
  supply an absolute configured `sh`, `bash` or `zsh` executable; no fallback is
  guessed. Remote-only/mixed/unknown environments and Windows paths are rejected.
- [run](../src/composables/nativeShell.ts#L17) requires explicit confirmation,
  matching selection/connection, and fresh context. Full access additionally
  requires exact typed cwd and fresh managed-policy permission. Each chained read
  and the final write checks ownership/conflicts. Actual argv is the observed
  shell path plus `-c` and user text; cwd is sent explicitly.
- [shellParameters](../src/api/nativeShell.ts#L23) sends
  `sandboxPolicy:{type:'readOnly',networkAccess:false}` or an explicitly confirmed
  `dangerFullAccess` policy, a 30-second timeout and 65,536-byte stream caps.
  This is a real native execution parameter, not a display-only label.
- [terminate](../src/composables/nativeShell.ts#L24) takes no user-entered process
  identifier: it sends the captured process ID from this operation. Epoch changes
  retire it and prevent termination/replay through the replacement connection.
  A termination acknowledgment is not treated as process completion.

Native enforcement:

- [`CommandExecRequestProcessor`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/command_exec_processor.rs#L242)
  requires a local execution environment, clones native permissions, applies
  `set_legacy_sandbox_policy`, rejects invalid managed-policy requests, and passes
  the effective permission profile into `build_exec_request` before launch.
- [`PermissionConfig`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/core/src/config/mod.rs#L508)
  validates the resulting filesystem/network permission profile against native
  constraints. `core/src/exec.rs::build_exec_request` and
  `sandboxing/src/manager.rs` construct the Linux sandbox or macOS Seatbelt
  wrapper. An unavailable Linux sandbox executable is a launch error. This
  evidence covers supported official Linux/macOS builds, not arbitrary POSIX
  ports: the manager can select `None` on unsupported platforms, so a POSIX shell
  string alone is not independent proof of platform sandbox availability.
- [`CommandExecManager`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/command_exec.rs#L355)
  indexes termination by `(upstream connection ID, process ID)`. The WebUI gateway
  shares an upstream connection; this is not a separate native security boundary
  for each browser tab. The UI owns a random process ID and exposes no arbitrary
  process-target input.
- Inspected native tests: `command_exec_enforces_managed_deny_read_requirements`,
  `command_exec_returns_error_when_local_environment_is_disabled`,
  `command_exec_without_streams_can_be_terminated`, and
  `command_exec_process_ids_are_connection_scoped_and_disconnect_terminates_process`.

Existing [nativeShell.test.ts](../src/composables/nativeShell.test.ts) cases cover
`submits only after confirmation and revalidation with exact readonly native parameters`,
`requires exact cwd confirmation and fresh managed permission allowance before full access`,
`does not duplicate a pending command or claim completion before its native final reply`,
and `keeps internal/transport outcomes unknown, never replays and rejects stale completion`.
They check actual submitted parameters and local ownership, not OS enforcement.
The real transport's [RPC lifecycle tests](../src/server/appServerClient.rpcLifecycle.test.ts)
cover `isolates stale replies and never replays on %s` and caller deadlines.

## 3. Activity check for native sign-in

Before explicit sign-in, WebUI checks a complete inventory of up to 20 loaded
conversations and reads their status with at most four requests in flight.
Incomplete inventories, failed metadata reads and active conversations prevent
sign-in from starting. The transport fixture checks that a failed metadata read
cannot reuse a cached idle result. Native queued work and other clients can start
work after the activity check.

The [native account guide](native-codex-account.md) covers account details,
sign-in completion, cancellation and logout. The [account settings unit tests](../src/composables/accountSettings.test.ts)
exercise the explicit sign-in activity check and the native login lifecycle.

## 4. Queue recovery and duplicate prevention

[Queue add](../src/composables/nativeQueue.ts#L30) uses a fresh client message ID,
checks the acknowledged ID and never automatically retries. Prior evidence only
guarded an uncertain add in the existing in-memory owner. Recreating the page lost
that guard while retaining the draft: native persistence could already contain
the original entry or it could already have executed.

Correction `0ef8f8b` stores a bounded, profile-scoped thread/client ID receipt
**before** submission, without any prompt or attachment bytes. The receipt
survives owner recreation/reconnect and blocks another add until inspected and
explicitly acknowledged. Storage failure prevents submission. An entry with the
same client ID identifies a registration; absence is not evidence of failure or
non-execution. The warning now explicitly states that re-submitting the draft
can duplicate execution. Clearing storage or explicitly authorizing another
submission removes this local guard; no native idempotency is claimed.

Authoritative limits:

- [`ThreadQueueRequestProcessor::add`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/thread_queue_processor.rs#L79)
  forwards the client ID as input metadata to native enqueue.
- [`SqliteQueueStore::enqueue`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/state/src/runtime/queued_items.rs#L79)
  inserts a fresh queue-record UUID. The queue schema has no uniqueness constraint
  on the embedded client message ID. Reusing the same correlation ID is not an
  idempotent-registration contract.
- [`QueuedItemService::start / dispatch_if_idle`](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/ext/queue/src/service.rs#L400)
  serializes dispatch within the service and calls `start_turn_if_idle`, then
  removes the durable queue entry after a started result. This does not establish
  an atomic durable exactly-once execution/removal transaction across crashes or
  storage failures. No confirmed live duplicate-execution incident is asserted.
- Inspected native tests `idle_queue_dispatch_preserves_client_id`,
  `cold_thread_resume_dispatches_a_persisted_queued_submission`,
  `queue_start_while_active_returns_busy_and_preserves_the_queue`,
  `interrupt_preserves_queue_and_queue_start_can_resume_a_non_head_item`, and
  `a_new_turn_preserves_queued_messages_until_it_completes` establish correlation,
  persistence and admission/order behavior under their scenarios. They are not
  proof of exactly-once recovery after a lost add response or process crash.

Immediate input still uses the normal start-or-steer path. Queue input uses the
native service and settings at execution; native idle/turn lifecycle determines
dispatch. A queue-changed notification only invalidates the snapshot; the browser
does not submit a queued prompt on turn completion or reconnect. Normal turn
events maintain history.

[nativeQueue.test.ts](../src/composables/nativeQueue.test.ts) includes existing
`uncertain writes are never replayed and block another add until explicit inspection acknowledgment`,
plus the reproducer `retains a lost-acknowledgment registration guard across owner recreation and reconnect`:
the fixture stores the entry remotely, loses its reply, then rebuilds the owner,
reconnects and verifies only one add. It also checks that an absent entry leaves
the guard in place. `fails before enqueue when a reload recovery marker cannot be stored`
checks fail-closed storage handling. Structured input, management and composer
steering tests remain in the affected checks. This models native behavior; the
SQL/service source is the independent evidence for the runtime limitations.

## Verification and corrective commits

- `0ef8f8b fix: retain uncertain queue submission identities across reload`:
  queue owner, receipt helper, error display, two regression cases, browser fixture
  and queue manual documentation (six files).
- `5fcf321` changed the bridge so failed metadata reads could no longer reuse
  cached idle status.

Final applicable commands, all PASS:

```sh
pnpm exec vitest run src/composables/nativeQueue.test.ts src/components/content/ThreadComposer.submission.test.ts src/homeComposer.test.ts src/utils/composerDraftStorage.test.ts
# 4 files / 30 tests
pnpm exec vitest run src/composables/useDesktopState.test.ts src/composables/useDesktopState.modelPreferences.test.ts src/composables/threadReview.test.ts src/composables/threadCompaction.test.ts src/composables/threadPermissions.test.ts src/server/conversationTransfer.test.ts src/server/appServerClient.rpcLifecycle.test.ts src/composables/nativeShell.test.ts src/composables/threadDeletion.test.ts src/api/codexRpcClient.test.ts
# 10 files / 143 tests
pnpm exec vitest run src/api/normalizers/v2.test.ts src/turnGenerationMetadata.test.ts src/server/threadLiveStateRetirement.test.ts
# 3 files / 57 tests
pnpm run typecheck
pnpm run build
pnpm run test:integration:fixture
node -e "const {execFileSync}=require('node:child_process');const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!help.includes('--port'))throw Error('Missing CLI options');console.log('CJS harness loaded public ESM CLI: --help and --port PASS')"
APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-queue.cjs
git diff --check
```

The historical targeted suites covered Fork, Revert, persisted Portable history
and historical response metadata. Reopened metadata uses the original response
settings.

Browser fixtures use production assets at
`http://127.0.0.1:4173/#/thread/approved-fixture` and intercept HTTP and WebSocket
requests. The queue run covered light and dark themes at 1280×900, 375×812 and
768×1024. Its screenshots are under
`output/playwright/risk-07-{1280,375,768}-{light,dark}.png`. See the
[account acceptance test](../tests/accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md)
for the current account browser fixture.

The queue recovery path parses at most 90,000 characters or 20 identity pairs.
No new startup RPCs, polling, connections or subscriptions were introduced in
the reviewed queue changes. No live latency benchmark was run.

No push, merge, rebase, branch switch, real deletion, command execution, account
change, paid call or mutation to real user resources was performed. High-impact
acceptance remains open at the native scope/isolation/idempotency boundaries
identified above. The documentation commit records these findings without changing
the original feature-status totals.
