# High-impact acceptance evidence review

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
| 3. Authentication activity and account isolation | **GAP** for a global no-work guarantee; application stale/reload defects corrected | Every returned loaded-thread identity must be inspected successfully and idle. Cached idle fallback, stale account publication and loss of the local reload barrier were corrected. The inventory is not a global admission lock: native queues, other clients, excluded sample threads and independently submitted commands are not frozen by login. No proof that all relevant work stays idle throughout authentication. |
| 4. Queue recovery and duplicate prevention | **GAP** for native exactly-once guarantees; local lost-reply/reload defect corrected | Native IDs permit correlation, not idempotent add. A bounded profile-scoped identity receipt now guards remotely committed/lost-reply submissions across reload/reconnect. No automatic replay occurs. Explicitly acknowledging uncertainty permits a new submission that can duplicate execution; native start and durable removal are separate steps. |

## 1. Permanent deletion and concurrent child creation

Application locations:

- [Preview validation](../src/api/threadDeletion.ts:5): requires exact native idle
  metadata and complete empty active/archived direct-child pages.
- [Submission](../src/composables/threadDeletion.ts:14): repeats those reads, then
  sends only `thread/delete {threadId}`. There is an interval after the last read
  before native execution. Typed ID and confirmation do not close it.
- [Scope disclosure](../src/components/content/PermanentDeletion.vue:17): expressly
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

- [inspectShell / shellParameters](../src/api/nativeShell.ts:10) requires an idle
  native thread with exactly one `local` environment whose cwd matches the
  thread's absolute POSIX cwd. `environment/info {environmentId:'local'}` must
  supply an absolute configured `sh`, `bash` or `zsh` executable; no fallback is
  guessed. Remote-only/mixed/unknown environments and Windows paths are rejected.
- [run](../src/composables/nativeShell.ts:17) requires explicit confirmation,
  matching selection/connection, and fresh context. Full access additionally
  requires exact typed cwd and fresh managed-policy permission. Each chained read
  and the final write checks ownership/conflicts. Actual argv is the observed
  shell path plus `-c` and user text; cwd is sent explicitly.
- [shellParameters](../src/api/nativeShell.ts:23) sends
  `sandboxPolicy:{type:'readOnly',networkAccess:false}` or an explicitly confirmed
  `dangerFullAccess` policy, a 30-second timeout and 65,536-byte stream caps.
  This is a real native execution parameter, not a display-only label.
- [terminate](../src/composables/nativeShell.ts:24) takes no user-entered process
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

## 3. Authentication and account isolation

[prepareAuthentication](../src/api/nativeAuthentication.ts:9) requires a positive
signed-out/default-provider account and known login policy. It requests 21 loaded
IDs and rejects more than 20, a non-null/missing cursor, malformed/duplicate IDs,
unknown status, identity mismatch or any failed read. It awaits every metadata
read with at most four in flight. A pending or failed read cannot count as idle.
The native `thread_loaded_list_response_inner` enumerates this App Server's loaded
threads and deliberately excludes `SampleThread`; it is not an inventory of all
system processes or all persisted queues.

Concrete defects corrected in `5fcf321`:

- [Bridge metadata failures](../src/server/codexAppServerBridge.ts:666) no longer
  return a cached idle snapshot to `thread/read {includeTurns:false}`. Ordinary
  history's empty-rollout fallback is preserved. The integration fixture models
  a cached idle read followed by a native failure and checks both paths.
- [Authentication controller](../src/composables/nativeAuthentication.ts:53)
  invalidates preparation, start preflight, delayed inspection and account data
  on **every** account-update event, including idle/starting/settling states.
  A later account-update event also retires evidence from an earlier matching
  completion. Fresh inspection/reconnect is required; success is not inferred.
- [Desktop account barrier](../src/composables/useDesktopState.ts:258) is set
  before requesting login, persists only a profile-scoped boolean, and survives
  ordinary reload. It is cleared after verified cancellation, definitive
  pre-execution rejection, or explicit reconnect acknowledgment immediately
  before full reload. No credential, URL, code or account identity is persisted.
- [Account updates](../src/composables/useDesktopState.ts:1713) advance the existing
  operation epoch, retire pending feature reads, clear account quotas/model
  availability and invalidate earlier model/rate-limit publication. The basic
  account-status UI also checks its captured epoch before publishing.
- Selected-thread sending, new-thread sending and queue writes check the account
  barrier. Pending operations are not replayed. Already accepted native work is
  not canceled by this UI barrier and may still complete. Reconnect keeps the
  uncertain state blocked; ordinary reload reconstructs recovery controls.

Native [account_processor.rs](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/account_processor.rs#L976)
owns credentials, reload, completion/account notifications and native account
owner-generation checks. Its login contract does not provide a combined
thread/queue/process quiescence lock. Other clients or native queue dispatch can
start work after inspection. Native pending queue execution is **not paused** by
the WebUI account barrier. Global no-work isolation therefore remains a GAP;
require an externally quiescent designated server for live acceptance, or a native
admission mechanism before promising that guarantee. Storage removal/failure or
changes that occur while the client is absent cannot be recovered from a marker.

Relevant tests in [nativeAuthentication.test.ts](../src/composables/nativeAuthentication.test.ts):

- `requires signed-out auth policy and a complete bounded idle inventory without resuming/reading histories`.
- `rejects incomplete/malformed idle inventories instead of inferring no active work`.
- `does not complete the idle check while a listed thread inspection is still unresolved`.
- `invalidates a start preflight and delayed account reads on an account change`.
- `clears URLs/codes and refuses late responses after connection change`.

[Desktop tests](../src/composables/useDesktopState.messages.test.ts) additionally
cover `invalidates account views and preserves the sending/queue barrier across document recreation`
and `discards an old account rate-limit response after an account update`.
The browser fixture verifies cancellation, matching completion, account update,
reload, blocked composer, fresh inspection and deliberate reconnect/reload without
repeating login or sending queued/ordinary input.

## 4. Queue recovery and duplicate prevention

[Queue add](../src/composables/nativeQueue.ts:30) uses a fresh client message ID,
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
events maintain history. The UI account barrier cannot stop native queue dispatch.

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
- `5fcf321 fix: invalidate stale authentication evidence and retain recovery barriers`:
  auth controller/recovery helper, desktop/App ownership, recovery UI, bridge
  metadata fallback, focused tests, integration/browser fixtures and manual
  documentation (eleven files). No deletion or shell mutation scope was expanded.

Final applicable commands, all PASS:

```sh
pnpm exec vitest run src/composables/nativeQueue.test.ts src/components/content/ThreadComposer.submission.test.ts src/homeComposer.test.ts src/utils/composerDraftStorage.test.ts
# 4 files / 30 tests
pnpm exec vitest run src/composables/nativeAuthentication.test.ts src/api/authInspection.test.ts src/composables/useDesktopState.messages.test.ts src/composables/accountUsage.test.ts src/server/codexAppServerBridge.archive.test.ts
# 5 files / 248 tests
pnpm exec vitest run src/composables/useDesktopState.test.ts src/composables/useDesktopState.modelPreferences.test.ts src/composables/threadReview.test.ts src/composables/threadCompaction.test.ts src/composables/threadPermissions.test.ts src/server/conversationTransfer.test.ts src/server/appServerClient.rpcLifecycle.test.ts src/composables/nativeShell.test.ts src/composables/threadDeletion.test.ts src/api/codexRpcClient.test.ts
# 10 files / 143 tests
pnpm exec vitest run src/api/normalizers/v2.test.ts src/turnGenerationMetadata.test.ts src/server/threadLiveStateRetirement.test.ts
# 3 files / 57 tests
pnpm run typecheck
pnpm run build
pnpm run test:integration:fixture
node -e "const {execFileSync}=require('node:child_process');const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!help.includes('--port'))throw Error('Missing CLI options');console.log('CJS harness loaded public ESM CLI: --help and --port PASS')"
APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-queue.cjs
APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-native-authentication.cjs
git diff --check
```

Total: **478 targeted tests / 22 files**, not a full-suite rerun. CAP-001 Fork/
Revert and CAP-002 persisted Portable history orchestration/transfer regressions
pass in the affected desktop/transfer suites. CAP-003 normalization, metadata and
history-retirement regressions pass. Reopened metadata is never replaced with
current account/composer settings. These do not resolve pending live acceptance.

Browser fixtures use stable production assets at `http://127.0.0.1:4173/`, route
`#/thread/approved-fixture`, intercepting HTTP/WebSocket operations. Playwright is
used because interception, synthetic reply loss and localStorage/reload are needed.
Port 4173 had no listener when checked; asset interception needs no server there.
Port 5173 was not touched. Both flows pass light/dark at 1280×900, 375×812 and
768×1024. Earlier browser assertions exposed an account-event status ordering
issue; it was corrected and the final complete flows passed. An assertion that
tried to fill the intentionally disabled composer was corrected to verify the
disabled control. No failing assertions remain in the final runs.

Screenshots are under the absolute directory
`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`:
`risk-07-{1280,375,768}-{light,dark}.png`,
`risk-29-workflow-{1280,375,768}-{light,dark}.png`, and
`evidence-29-recovery-{1280,375,768}-{light,dark}.png`. The latter capture the actual
recovery controls and sending barrier after reload; both themes were inspected.

![Desktop light recovery](../output/playwright/evidence-29-recovery-1280-light.png)
![Mobile dark recovery](../output/playwright/evidence-29-recovery-375-dark.png)

Performance audit uses the changed paths and browser request assertions: no new
startup RPCs, polling, connections or subscriptions were introduced. Queue
recovery parses at most 90,000 characters/20 identity pairs; authentication adds a
single boolean marker. Account updates invalidate existing owners without an
extra scan; metadata failure now returns an error instead of cached idle state.
Native login still has the same two bounded preflights. No large-history rendering
path changed. These are code-path/request checks, not a new latency measurement;
the earlier implementation-pass performance figures remain historical evidence.
No full benchmark or paid/live operation was run to manufacture additional evidence.

No push, merge, rebase, branch switch, real deletion, command execution, account
change, paid call or mutation to real user resources was performed. High-impact
acceptance remains open at the native scope/isolation/idempotency boundaries
identified above. The documentation commit records these findings without changing
the original feature-status totals.
