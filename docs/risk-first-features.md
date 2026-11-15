# Risk-first feature implementation

This assessment starts from clean `main` at `42a9790`. It supersedes neither
the protected requirements nor the acceptance limitations in
[the previous feature report](approved-features.md). In particular, live acceptance
of 09 and 11 remains incomplete and is not resumed here.

## Evidence and baseline

The supported runtime floor remains Codex App Server 0.169.0. The development
dependency (0.167.2) and generated types alone are not runtime evidence. Contracts
below are checked against the official `rust-v0.169.0` release, commit
[`d32063f96c2dff1dc96af839b3952abb6acfeda4`](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs).
Request processors and upstream tests, rather than method names alone, establish
semantics. An unsupported operation remains an explicit error; no write is used
to probe availability. All development writes use fixtures or disposable data.

Baseline, same installed dependencies: `pnpm run test:unit` passed 1,394 tests
(two skipped); `pnpm run build` passed. The built baseline is copied outside the
repository at `/tmp/risk-first-baseline`. Startup and 2,000-turn export fixtures
are recorded in `output/playwright/risk-first-baseline/performance-comparison.json`.
These timings describe fixtures, not live App Server performance.

## Implementation matrix

Tuples are **P/I/R/T**, each 1–5; score = P + 2I + R + T. Full-feature estimates
include withheld portions. Limited-scope estimates precede safeguards; residual
estimates are recorded with delivered results. These are engineering judgments.

| ID | Previous score | Full feature reassessment | First useful scope and initial risk | State affected / verification boundary |
|---|---:|---|---|---|
| 05 | 21 | 3/3/2/3 = 14 | Native direct children, metadata and navigation; 2/2/1/2 = 9 | Transient selected-thread reads; no orchestration, recursion or history subscriptions. Native parent filter and pagination fixtures. |
| 21 | 22 | 4/5/4/5 = 23 | Native Hook definitions, origin, trust and enabled status; 2/2/1/2 = 9 | Remote scoped inspection only initially; trust mutation needs an independently verified contract. |
| 23 | 24 | 4/5/5/5 = 24 | Project effective configuration, layers and restrictions, secret-free projection; 2/2/1/2 = 9 | No raw configuration rendering. Targeted writes require versions and preservation tests; no excluded feature workarounds. |
| 30 | 24 | 4/5/5/5 = 24 | Establish an official remotely usable Cloud contract before UI | Cloud CLI existence does not establish an App Server Cloud API; no private endpoint/credential proxy. |
| 28 | 24 | 4/5/5/5 = 24 | Native external-agent migration discovery and manifest preview; 2/2/1/3 = 10 | Explicit remote cwd/source, no imported execution; destinations/conflicts unknown unless supplied. Imports need conflict-safety evidence. |
| 34 | 21 | 4/4/4/5 = 21 | Establish native editor/buffer identity before context UI | On-disk file reads cannot substitute for unsaved editor buffers; no new local bridge/listener. |
| 03 | 23 | 5/5/4/4 = 23 | Observe actual resumed/native-updated thread permissions; 2/2/1/2 = 9 | Existing event ownership only. No extra resume to inspect; configuration defaults are not effective thread state. |
| 04 | 21 | 4/5/3/4 = 21 | Observe native denied-review identities and retry eligibility; 2/2/1/3 = 10 | Bounded transient events; display text cannot reconstruct a native retry event. |
| 29 | 24 | 4/5/5/5 = 24 | Actual account state and supported methods; 2/2/1/2 = 9 | Server owns tokens. Login requires completion/cancellation semantics and account-cache isolation. |
| 27 | 18 | 4/4/3/3 = 18 | Verify transcription-only/native realtime isolation first | No third-party transcription; microphone lifecycle, synthetic media and no billable live session. |
| 07 | 20 | 4/4/4/4 = 20 | Explicit native queue add/list, preserving structured inputs; 3/3/2/3 = 14 | Native persistence only; immediate steering remains default, no uncertain write replay. |
| 13 | 22 | 4/5/4/4 = 22 | One explicit remote worktree creation; 3/4/3/4 = 18 | Existing remote fixed-argv Git, no force/reset/cleanup; disposable repository and reconciliation fixtures. |
| 14 | 23 | 5/5/4/4 = 23 | Verify thread settings persistence and historical cwd identity | Native future-cwd update alone does not preserve historical relative file references or project membership. |
| 26 | 24 | 5/5/5/4 = 24 | Deliberate bounded native user-shell request after lifecycle verification | Native shell can be unsandboxed; never execute on WebUI host, never imply thread sandbox guarantees. |
| 10 | 21 | 5/5/5/5 = 25 | Exact native deletion impact and confirmation, last | Native subtree deletion, imported history, active work and event-confirmed completion must be accounted for. |
| 33 | Unassessed | 3/4/3/4 = 18 | Native Daybreak preference/status inspection; 2/2/1/2 = 9 | Release includes daybreakEnabled and access-program tests. Preference is not account entitlement or a security scan service. |

## Gates

Phase 1 follows 05 → 21 → 23 → 30 → 28 → 34 → 03 → 04 → 29.
Each delivered scope gets focused tests, a manual test entry, a performance audit,
and a separate commit. All observation panels remain lazy, bounded and scoped to
the current connection generation. Unsupported/error/empty states stay distinct.

Phase 2 follows 27 → 07 → 13 after the observation gate. Phase 3 follows
04 → 14 → 21 → 03 → 23 → 28 → 34 → 29 → 30 → 26 → 10. Each mutation requires
verified native semantics, duplicate and stale-response guards, rejection/unknown
outcomes, and independent failure-injection verification. Missing contracts block
that individual portion and do not block independent work.

No change is authorized to withheld extensions of 15/16/17/19/20/22/31. No
real-world resource mutation, paid operation, account change or installation is
performed for acceptance. Final statuses and actual verification follow below.

### 05 — IMPLEMENTED (observation only, as approved)

Direct native children (active/archived), bounded pagination, native parent links,
status/role, on-demand preview and normal navigation are delivered. Native
`thread/list.parentThreadId` filtering is exercised upstream in
`app-server/tests/suite/v2/thread_list.rs::thread_list_relation_filters_read_spawn_graph_from_state_db`;
`thread/read` supplies metadata without turns. The UI rejects ignored filters.
No new orchestration or subscriptions. Residual 1/2/1/2 = **8**.

Three focused unit tests, frontend/server type checks and the six-view browser
matrix passed (lazy reads, details, navigation, empty/unsupported, duplicate and
delayed navigation). Performance and exact manual steps are in
[the observation tests](../tests/thread-loading-state/risk-first-observation.md).
Live acceptance: **NOT RUN**, no designated native subagent test threads.

### 21 — PARTIAL (inspection delivered)

`hooks/list {threadId}` reads the loaded thread's snapshot without executing
Hooks (`request_processors/catalog_processor.rs::hooks_list_response`). Native
definitions, source, event, effective enabled/managed state and trust/hash are
displayed, with bounded/redacted definitions. No trust or enablement mutation is
included in Phase 1. Residual inspection risk 1/2/1/2 = **8**; full-feature risk
remains 23 until a safe mutation contract is established.

Three unit tests, type checks and six browser views passed, including secret
omission, disabled/untrusted distinction, empty/error and disconnect during a
pending read. One lazy request, no new subscription or Hook execution. Live
acceptance: **NOT RUN**. Mutation assessment follows in Phase 3.

### 23 — PARTIAL (inspection delivered)

`config/read {cwd,includeLayers:true}` and `configRequirements/read` expose
effective project defaults, native layer/version/origin metadata, named profiles
and managed restrictions. The release's `request_processors/config_processor.rs`
loads effective configuration and maps restrictions; the UI projects a fixed
public-settings allowlist and never displays raw configuration or instruction
payloads. Thread overrides are explicitly distinguished. Residual inspection
risk 1/2/1/2 = **8**; writes remain pending Phase 3 assessment.

Three unit tests, full type checks and six browser views passed, including
secrets in effective/layer/profile payloads, empty/error and stale disconnect.
No new startup requests, polling or subscriptions. Live acceptance **NOT RUN**.

### 30 — BLOCKED (Phase 1 contract assessment)

The official release contains `cloud-tasks` and `cloud-tasks-client`, but the App
Server request enum (`app-server-protocol/src/protocol/common.rs`) has no Cloud
task listing/detail/submission/cancellation/application contract. The CLI client
uses authenticated ChatGPT backend task endpoints (`cloud-tasks-client/src/http.rs`),
not a public App Server API. This repository has no existing remote Cloud bridge
with server-owned account/environment binding. Adding a private endpoint proxy or
local CLI execution would breach the independently managed App Server boundary.
No placeholder browser or speculative RPC is added. Both inspection and
mutations are blocked pending an official integration contract; full risk 24,
no shipped behavioral risk. Live acceptance **NOT RUN**.

### 28 — PARTIAL (project configuration manifest delivered)

Explicit Claude Code/Cursor source discovery uses native
`externalAgentConfig/detect {migrationSource,cwds:[remoteCwd],includeHome:false,maxSessions:0}`.
The canonical selectors are established by `external-agent-migration/src/source/`
and `migration_source.rs`. Home and session discovery are excluded: the App
Server detect handler records discovered session connector candidates in a
ledger, whereas `sessions/ledger.rs::record_detected_session_connectors` returns
without writing for an empty map. Repository-only detection emits no sessions
(`detect/mod.rs`, guarded by `scope.is_home()`). This restriction is deliberate.

The UI shows native proposed-resource descriptions/destinations, public identities
and excluded scopes. Exact file diffs/conflicts are unavailable, explicitly
labelled. Imports are withheld, not represented as successful lifecycle support.
Residual inspection risk 1/2/1/3 = **9**. Three focused tests, type checks and six
browser views passed; no import, source execution, home/session request or new
subscription. Live acceptance **NOT RUN**.

### 34 — BLOCKED (Phase 1 contract assessment)

The 0.169.0 App Server request enum has filesystem access but no API for an
authenticated connected editor, active document, selection or unsaved buffers.
The repository has no existing IDE bridge/identity or buffer lifecycle protocol.
The CLI's IDE-related behavior is not a remotely callable editor context API.
An on-disk file picker would misrepresent unsaved editor state; a new unrestricted
IDE listener would broaden the transport architecture. No substitute is added.
Full risk remains 21; shipped risk none, browser/live acceptance **NOT RUN**.

### 03 — PARTIAL (actual permission observation delivered)

Normal `thread/resume` responses supply approval policy, reviewer, sandbox and
active permission profile; `thread/settings/updated` supplies effective changes
(`v2/thread.rs`, native thread settings processor). Existing history ownership
guards accept the resume snapshot only while current. Native settings events
invalidate older resume observations. Snapshots clear at connection generation
changes, retain at most 100 threads, and never populate historical generation
metadata or persist browser configuration. Inspection causes no additional
resume. Managed constraints are read explicitly using `configRequirements/read`.

Residual observation risk 1/2/1/2 = **8**. Full unit suite, type checks and six
browser views cover settings/unknown/managed/other-thread/stale/disconnected cases.
Permission mutations remain pending Phase 3 assessment. Live **NOT RUN**.

### 04 — PARTIAL (native denial observation delivered)

The existing event owner captures `item/autoApprovalReview/completed` denials,
retaining exact thread/turn/review/item identifiers and bounded public action
details. Fifty transient rows maximum, deduplicated by thread/review, cleared
on connection change. Ordinary manual rejection/history is not fabricated.
Eligibility remains unavailable: the public notification carries a temporary
`GuardianApprovalReviewAction` projection; the retry endpoint consumes a serialized
core `GuardianAssessmentEvent` (`v2/thread.rs:ThreadApproveGuardianDeniedActionParams`,
`thread_processor.rs::thread_approve_guardian_denied_action_inner`). It is not
safe to reconstruct that event from rendered denial text. No retry control is
enabled in Phase 1. Residual inspection risk 1/2/1/2 = **8**.

Three focused unit tests, type checks and six browser views passed, including
duplicates, other-thread identity, credential omission and disconnect cleanup.
Zero new requests or subscriptions. Live acceptance **NOT RUN**. Retry contract
and staleness validation remain a Phase 3 gate.

### 29 — PARTIAL (authentication inspection delivered)

`account/read {refreshToken:false}` reads actual server-owned account state;
`configRequirements/read.requirements.allowed_login_methods` reports effective
login policy, including an explicit empty list. Missing policy stays unknown.
The 0.169.0 account processor implements browser/device ChatGPT workflows and
validates restrictions/external-token ownership before initiation. Inspection
does not start login, refresh credentials or expose opaque account routing/tokens.
The WebUI password remains separate. Residual inspection risk 1/2/1/2 = **8**.

Two focused unit tests, type checks and six browser views passed: native account,
allowed methods, secrets, signed out/no allowed method, errors and disconnect.
Two lazy reads per explicit action; no startup read, polling or subscription.
Native login lifecycle remains pending Phase 3. Live acceptance **NOT RUN**.

## Phase 1 gate

Delivered scopes: 05 `5ecd8a6`, 21 `c7b3825`, 23 `9e2aa79`, 28 `4ac7636`,
03 `cdc0f94`, 04 `1741cd0`, 29 `4d509cc`. Cloud (30) and IDE (34) have no
supported integration contract. There were no resource mutations during this
phase. All seven delivered browser matrices passed in light/dark at desktop,
375×812 and 768×1024. Unit suite: **1,414 passed / two skipped**. Production
build and credential-free external-server integration fixture passed, including
single upstream connection and existing retired-endpoint protections. Protected
Fork/Revert, portable imports and metadata unit regressions passed. No live
09/11 acceptance was resumed. Mutation portions remain partial, not completed.

### 27 — BLOCKED at transcription isolation gate

The supported App Server exposes `thread/realtime/*`, not a standalone
transcription/dictation operation. Native realtime is a conversation workflow:
`core/src/realtime_conversation.rs` persists completed transcripts and routes
`HandoffRequested` through `RealtimeHandoffAdmission::route` into
`route_realtime_text_input`. `clientManagedHandoffs` suppresses response forwarding
(`handoff_out`), not coding-turn admission. A prompt asking for transcription
cannot enforce the required single-shot input-only behavior. No microphone UI,
third-party service, paid session or experimental flag is introduced. The initial
isolation gate fails at the contract level; native realtime extension is therefore
withheld. Full risk estimate 18 (actual verification difficulty 5 raises the
attempted scope to 20); shipped behavioral risk none. Live **NOT RUN**.

### 07 — PARTIAL milestone: native queue submission/list

Explicit composer Queue mode uses `thread/queue/list` to establish availability,
then `thread/queue/add` with a unique native client message identifier. Existing
text/attachment/Skill/App input construction is retained. The native response
must match the client identifier; only acknowledged acceptance clears the draft.
Immediate mode remains the default and unknown slash input is still normal text.
Unknown writes block subsequent queue submissions until native inspection and
explicit acknowledgment; they are never replayed. Queue mode remains selected
across disconnect so its draft is not silently converted into steering.

Native persistence/order and unavailable-service semantics are established in
`request_processors/thread_queue_processor.rs`; no browser execution queue exists.
`thread/queue/changed` only marks the snapshot stale and no longer triggers an
unrelated thread-list refresh. Source selection/connection guards discard stale
read results. First-use action-panel opening was corrected after the refresh
browser case exposed an async-component render race.

Five queue units plus 18 composer/draft regressions, full type checks and six
browser views passed, including refresh persistence, duplicate submission and
unknown outcomes. Performance: no startup RPC/subscription, one availability
read, one write and one reconciliation read per accepted add; 20 rows/page,
100 displayed rows, bounded previews/attachment retention. Residual initial
scope 2/3/2/3 = **13**. Editing/deletion/reordering/start follow separately.
Live **NOT RUN**; only synthetic queued prompts were used.

### 07 — IMPLEMENTED within the native queue contract

Native plain-text editing (other structured input preserved), confirmed exact-ID
removal, complete-list move-up reordering and confirmed idle-thread start are now
delivered. Rich text elements/unknown inputs and oversized retained input are
previewable but cannot be lossily edited. Reorder requires the entire bounded
native list; the server independently requires every queued ID exactly once.
Start reports the native turn identity and reconciles through existing history
ownership; normal events establish completion. No model turn is started during
development. Concurrent native changes invalidate editing/action snapshots.

Native coded rejections are distinct from unknown transport outcomes. RPC code
preservation was extended only to these five new queue writes; unrelated generic
RPC error bodies remain unchanged and are verified in the external-server fixture.
Residual risk 2/3/3/3 = **14**. Native update has no revision/CAS field: simultaneous
external-client edits are subject to native semantics; stale observed snapshots
are disabled, not silently merged. Queue state is never replaced with a browser
registry. Eight queue unit tests, eleven composer regressions, type checks,
production build, integration fixture and six management browser views passed.
No new persistent connection/subscription; actions use one write and one lazy
queue reconciliation read (start also reconciles history once). Live **NOT RUN**.

### 13 — IMPLEMENTED for POSIX remote Git repositories

Explicit fixed-argv `command/exec` reuses the established remote Git abstraction,
not WebUI-host Git. Preview resolves the remote repository, validates a new branch
and pins HEAD. Confirmation identifies repository/commit/branch/destination.
Creation rechecks HEAD, rejects reused worktree identities, invokes native
`git -c core.hooksPath=/dev/null worktree add --no-track -b … <pinned HEAD>`,
then verifies native worktree-list and destination identity. No force/reset,
fetch/push, destructive migration or cleanup is present. Windows/relative paths,
nested destinations and dot segments are explicitly unsupported.

Failures after submission are potentially partial/unknown, never replayed;
on-demand exact reconciliation is available. Connection/project/teardown guards
apply before every chained RPC, including before the write. The separately
invoked new-conversation setup uses existing native project registration, guarded
again when queued and before routing. It sends no prompt and leaves parent
history/draft intact. Residual risk 2/4/3/3 = **16** (full estimate 22).

Four disposable-repository tests plus existing remote-Git/gateway tests (**44
tests**) passed, as did type checks and six browser views with unknown-result
reconciliation, native project setup and parent draft restoration. Preview uses
three bounded native reads; confirmed creation seven calls including one write
and verification, no polling/subscriptions. Real large-repository latency NOT RUN.
Live acceptance **NOT RUN**; real user repositories were not mutated.

## Phase 2 gate

Queue submission `972cf59` and management `e61cba7` passed focused tests and
the six-view UI matrices. Worktree creation passed the same matrix and disposable
Git checks. Full suite **1,427 passed / two skipped**, production build and
credential-free external-server integration fixture passed. Existing composer,
Git, native history, Fork/Revert and historical metadata regressions passed. No
paid voice session or real repository/conversation/configuration mutation was
performed. Voice is blocked; queue and POSIX worktree scopes can proceed.

## Phase 3 contract gates before permission mutations

**04 retry withheld:** the native endpoint accepts an opaque serialized core
Guardian event. The public, explicitly unstable auto-review notification is a
different projection, without a supported retry-eligibility/expiry contract.
No client-side reconstruction or command execution from denial text is added.
Observation remains PARTIAL; full mutation risk remains 21, live NOT RUN.

**14 BLOCKED:** `thread/settings/update.cwd` does exist and changes subsequent
turns. It also selects default environments unless supplied explicitly. However,
the WebUI historical file-link renderer currently resolves relative references
against one conversation cwd (`ThreadConversation.vue::resolveRelativePath`),
while native public turns do not supply historical cwd per response. Changing
the current cwd would reinterpret existing historical links after reopening.
Native project membership is independently explicit. A safe implementation needs
historical context provenance/persistence and project/environment transition work;
a UI-only path swap or implicit Fork cannot preserve the required semantics.
No cwd mutation is exposed. Full risk remains 23, shipped risk none, live NOT RUN.

**21 initial mutation gate:** no dedicated Hook mutation API exists. Further
inspection of the native config writer subsequently established the targeted
`hooks.state.<native key>` format, hash splitting and field-by-field precedence
(`config/hook_config.rs`, `hooks/config_rules.rs`, `config_manager_service.rs`).
This supersedes the initial assumption that keys could not be safely addressed.
Implementation is deferred until after the versioned targeted-config write gate
(23); this sequence deviation is due to that verified technical dependency.
Managed/plugin Hook ambiguity and loaded-thread versus saved-state behavior still
require a narrower scope. No Hook has been executed or trusted during validation.

### 03 — PARTIAL, explicit thread permission mutations delivered

Verified `thread/settings/update` now supports confirmed approval policy
(`on-request`/`never`) and built-in sandbox changes (read-only without network,
workspace write without extra/temp roots or network, unrestricted full access).
Native `protocol.rs::get_writable_roots_with_cwd` establishes that workspace
write includes execution cwd even with empty additional roots. The UI does not
invent named profiles, edit custom roots or change global defaults. Managed
profile restrictions withhold raw sandbox replacement; incomplete restriction
reads withhold all writes. The native processor independently validates managed
constraints before applying subsequent-turn settings.

Failure gate: request and accepted states remain pending until **both** RPC
acknowledgment and matching effective `thread/settings/updated` observation.
Other-thread settings never satisfy a request. Coded rejections and unknown
transport outcomes differ. Unknown settings block this thread's send/steer,
review/compaction/queue actions until a fresh native observation is explicitly
reconciled; no replay occurs. The existing event owner remains the only listener.
Broader access/reduced oversight requires a separate explicit confirmation.
Native historical model/effort metadata is not rewritten.

Full risk 23; limited pre-safeguard 3/5/3/4 = **20**, residual 2/5/3/4 = **19**.
The impact remains high despite fixture success. Five focused mutation tests,
existing security tests, **1,432-test full suite**, frontend/server type checks,
build, external-server fixture and six browser views passed. Browser checks cover
confirmation, ack/event ordering, unrelated events, refresh persistence, managed
restrictions, rejection, unknown/reconciliation and send blocking. RPC-code
preservation is scoped to this new write and generic errors remain unchanged.
One native write per confirmation, no additional startup reads or subscriptions.
Live **NOT RUN**; no real thread permissions were changed.

### 23 — PARTIAL, targeted native model-default writes delivered

Only `model` and `model_reasoning_effort` (low/medium/high subset) can be edited,
with an explicit exact-file/profile/scope confirmation and native expected-version
CAS. The native active user/profile layer is selected from supplied identity;
ambiguous/missing identities disable writing. Unknown keys/secrets are never
round-tripped. Other files and excluded feature settings are untouched.

The supported release **rejects legacy `profiles.*` writes**
(`config_rpc.rs::config_batch_write_rejects_legacy_profile_tables`), whereas
`config_manager_service_tests.rs::write_value_defaults_to_selected_user_config_path`
verifies writes to the selected profile-v2 file. The implementation uses that
active file, not legacy tables, and separately displays saved and effective
project settings. Existing thread overrides are not changed. Broader profile
lifecycle/switching and experimental-feature mutation remain withheld; no runtime
upgrade, reload, generic editor or blocked-feature workaround is added.

Requested/acknowledged/verified/rejected/unknown states are distinct. Fresh read
and explicit acknowledgment are required after unknown writes. A config-error
header opt-in preserves native numeric errors for this new consumer only;
ordinary config callers (including existing MCP/Speed) retain their generic HTTP
contract. Both paths are asserted by the external-server fixture.

Full risk 24; limited pre-safeguard 3/4/3/4 = **18**, residual 2/4/3/4 = **17**.
Eleven focused tests (including previous MCP behavior), type checks, production
build, fixture and six browser views passed. Browser checks cover profile-file
identity, one-key preservation, version rejection, saved/effective mismatch,
refresh persistence and unknown reconciliation. Performance: two explicit reads,
one write and one verification config read; no new startup calls/subscriptions.
Live **NOT RUN**; only test configuration data was mutated.

### Shared corrective gate — uncertain native internal errors

Failure-mode review established that `-32603`/storage errors can occur after
native persistence. New queue, permission and configuration workflows now treat
only the verified client-validation/method codes (-32600/-32601/-32602) as
definitive rejection; other failures remain unknown and retain their inspection
barriers. No generic RPC body or previous unrelated consumer was changed.
Operation-specific error rendering is credential-redacted and capped at 2,000
characters, including the queue's outer composer error. Config component teardown
also cancels ownership before a post-write verification read.

Two helper tests and queue/permission internal-error regressions were added.
Full working-tree suite **1,445 passed / two skipped**, type checks and repeated
permission/queue/config browser matrices passed. Config browser failure injection
uses a coded internal error **after** a simulated persisted write. No replay or
false rejection occurs. Performance: bounded error processing, no additional RPC,
polling, persistence or subscription. Live evidence remains NOT RUN.

### 21 — PARTIAL, future-load policy management delivered

The official TUI (`tui/src/hooks_rpc.rs::write_hook_trusts`) and native
`hooks_list.rs::config_batch_write_toggles_user_hook` establish targeted
`hooks.state` upserts. The UI now saves enable/disable or exact-definition trust
approval for reviewed **user/project** command/MCP Hook definitions, with native
file identity/version CAS and one native key/field per write. Unrelated enablement,
trust and configuration remain untouched. Managed/plugin/unknown/oversized or
incompletely described definitions stay read-only. Trust revocation is withheld:
removing an override can expose inherited trust and no verified explicit
revocation/tombstone contract is used.

The scope deliberately saves policy for future native loads. Loaded-thread
enabled/trust state remains separately visible; saving never claims immediate
runtime disablement. No automatic global reload or Hook execution occurs.
Native cwd-based plugin catalog discovery can migrate legacy plugin trust
baselines (`hooks/engine/discovery.rs`, `plugin_trust.rs`), so this UI **only**
uses the loaded-thread Hook inventory and safe config reads, not that catalog.
Before writing it rechecks the exact loaded key/hash and discards stale ownership.
Approval shows definition, origin, hash and affected user/profile file, then
requires explicit confirmation. Unknown writes require a fresh saved-state read
and explicit acknowledgment, with no replay.

This follow-up occurs after 23 because its native config identity/version/error
contract is a prerequisite. Full risk 23; initial limited scope 3/5/3/4 = **20**,
residual 2/5/3/4 = **19**. Eight focused tests, full working-tree suite (1,445
passed), type checks, production build, integration fixture and six browser views
passed. Tests cover exact identity/hash, changed definitions, policy preservation,
saved-versus-loaded differences, confirmation, coded internal unknowns and no
reload/execution. One saved-policy read, one preflight thread inventory read, one
targeted write and one saved verification read per action; no startup request,
polling, extra subscription or project/plugin scan. Live **NOT RUN**.
