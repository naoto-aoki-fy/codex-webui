# Approved feature implementation and evidence

Scope: 01, 02, 06, 08, 12, 15–20, 25, 31. Ceiling: medium regression risk.
Starting state: clean `main`, `99acc2c`; no merge/rebase in progress.
Read PROJECT_SPEC.md, product-requirements.md, native-project-migration.md,
app-server-client-boundaries.md, conversation-tools.md and its verification record.
No deployment mutations or live model turns are authorized for this pass.

Authoritative runtime evidence: OpenAI Codex release `rust-v0.169.0`, commit
`d32063f96c2dff1dc96af839b3952abb6acfeda4`, downloaded directly from upstream.
Contracts below refer to `codex-rs/app-server-protocol/src/protocol/v2/` and
implementations in `codex-rs/app-server/src/request_processors/` at that revision.
The server must expose each optional API; fixture acceptance does not establish
that a connected deployment supports it. The bundled catalog is not negotiation.

| ID | Existing behavior | Minimum useful scope / evidence | State and verification / reassessed risk |
| --- | --- | --- | --- |
| 06 | Normal history and single live notification owner; MCP/search items omitted | Bounded, collapsed safe execution details; `item.rs`, `mcp.rs`; same item IDs in history/events | Existing message overlays only; normalization, ordering, malformed/large/secret tests, theme/device fixtures; medium |
| 12 | Remote `command/exec`, filesystem services; turn diffs | Explicit working-tree read via fixed Git argument arrays, separate index/worktree patches, lazy untracked previews | Connection/project-scoped disposable results; no Git writes or polling; Git fixture/error/bounds tests and browser; medium |
| 02 | Context usage events, turn lifecycle, normal history | Explicit `thread/compact/start`; thread_processor submits `Op::Compact`, empty reply is acknowledgment only | Native context only; idle guard, pending/event completion/failure/uncertainty; fixtures and browser; medium |
| 01 | Review protocol exists, not surfaced | Inline `review/start` only; review.rs and turn_processor support four distinct target variants | Native conversation history; block active work, use existing interruption, render review boundaries; fixtures/browser and metadata regressions; medium |
| 08 | Command history, no process manager | Native paginated thread background list and exact process termination, no bulk clean | Native loaded thread resources only; list is manageable processes, no output in list contract; recent output from known item if available; fixtures/browser; medium |
| 25 | Goal/Plan/Skills slash suggestions, drafts | Discover actual actions; profile-scoped bounded text presets and submitted prompt history | Browser text only, no attachment bytes; editable selection; storage failure/IME/settlement regressions and browser; medium |
| 15 | Native Fork, optional ephemeral API | Investigate separate question isolation; ephemeral alone does not constrain MCP side effects | Block if native read-only tool isolation/lifecycle requires engine overhaul; no mutation probes; high for full scope |
| 18 | Skill/attachment composer inputs | Lazy available-app picker with exact native `mention` / `app://id` semantics; apps.rs, turn_start fixture | Draft/input schema and profile reset; exact serializer and draft tests, fixtures/browser; medium |
| 20 | Existing memory default retained | Read native readiness and selected thread summary; memory.rs; contribution control only with readable effective mode | Server state, no global writes/reset; unknown/null remain explicit; fixtures/browser; low for reads, medium for settings |
| 16 | MCP status/OAuth/reload/tools | Investigate targeted safe definition editing; no blind whole-config round trip | Config layers/version/secrets; blocked unless exact entry preservation and effective-state reconciliation established; high until proven |
| 19 | Installed skill list/details/toggle/selection | Investigate extra roots and plugin-owned workflows | `skills/extraRoots/set` replaces shared roots; no getter in contract. Avoid shadow registry/root overwrite; high until safe ownership established |
| 17 | No Marketplace UI | Investigate useful read-only browsing; plugin/list implementation starts background synchronization even without forceRefetch | No feature flags/install/sync mutations. Experimental lifecycle unsupported by repository policy; reads only if safe subset verified; medium reads / high mutations |
| 31 | Existing remote transport stays independently managed | On-demand status and client list; remote_control.rs and transport tests | No enable/pair/revoke/infrastructure changes; environment ID from status only, paged reads scoped to connection; fixtures/browser; low |

Feature 22 remains blocked, 33 excluded, other excluded IDs untouched.
09 remains fixture-validated with incomplete live acceptance: empty restore succeeded
but native active list omitted it after refresh; nonempty restore NOT RUN. This is
not a confirmed upstream defect. 11 live multi-page/persisted Portable export NOT RUN.
24 accepted for available live data; other states fixtures. 32 accepted for observed
connection/copy/reconnect; adversarial warning/redaction fixtures. No pending live
09/11 acceptance will be resumed without designated data.

Baseline: production build at 99acc2c using the existing locked dependencies;
copy retained in /tmp/approved-baseline/dist for identical-fixture comparison.
Each feature receives focused tests, manual acceptance and a code-path performance
audit; final full suite/build/integration/CLI and browser matrix follow.

## 06 validation

Implemented public MCP/search details in existing normalization and live owner.
`pnpm exec vitest run src/api/normalizers/executionDetails.test.ts src/api/normalizers/v2.test.ts src/composables/useDesktopState.test.ts`: 85 passed.
`pnpm run typecheck`: passed. Browser execution matrix: passed, 3 viewports × 2 themes;
history/live/progress/dedup/no history reads, public-text redaction and safe markup.
No parser/link code changed. Live validation NOT RUN. Risk: medium.

## 12 validation

Implemented lazy remote working-tree status and staged/unstaged/untracked patch
previews. `pnpm exec vitest run src/api/workingTree.test.ts`: 2 passed;
`pnpm run typecheck`: passed; `node scripts/test-approved-panels.cjs`: passed
all three sizes/both themes, exact remote cwd/argv, lazy reads, previews and
non-repository errors. Read-only fixed argv, no shell/external diff/textconv or
optional Git locks/fsmonitor. Git status bounds fail closed; patches explicitly
bounded. See manual test for performance audit. Live NOT RUN; risk medium.

## 02 validation

Implemented explicit idle-only native compaction; empty reply stays pending,
matching native item completion establishes success, then normal history refresh.
Unknown outcomes are never replayed. Operation-specific numeric error evidence
is added for compaction only; unrelated generic errors retain their contract.
`pnpm exec vitest run src/composables/threadCompaction.test.ts src/composables/useDesktopState.test.ts`: 64 passed. Typecheck passed after correcting fixture request typing.
`node scripts/test-approved-compaction.cjs`: acknowledgment/completion, duplicate
and sending guards, unsupported, active-turn guard; 3 sizes × both themes passed.
See manual test for code-path performance audit. Live NOT RUN; risk medium.

## 01 validation

Implemented four native inline review targets, submission/progress, bounded native
entry/result history rows, and explicit existing turn interruption. Active turns,
compaction, incomplete imports and disconnects block submission; pending review
blocks overlapping composer input. Generation metadata remains native evidence.
`pnpm exec vitest run src/composables/threadReview.test.ts src/composables/threadCompaction.test.ts src/api/normalizers/executionDetails.test.ts src/composables/useDesktopState.test.ts`: 68 passed.
Typecheck passed. `node scripts/test-approved-review.cjs`: target/progress/results,
interruption, reopened history, unsupported; all sizes/themes passed. Compaction
browser rerun passed after allowing fixture readiness before action. A late failed
compaction history refresh is now epoch-guarded. See manual test for performance.
Live NOT RUN; risk medium. Only inline delivery is supported at 0.169.0.

## 08 validation

Implemented on-demand native manageable-process pages, snapshot identity, bounded
loaded-item output, exact-ID confirmation/termination with true/false/error states.
No shell/PTY/local process control or bulk clean API. `pnpm exec vitest run src/api/backgroundTerminals.test.ts src/composables/threadReview.test.ts src/composables/threadCompaction.test.ts`: 7 passed. Typecheck passed.
`node scripts/test-approved-processes.cjs`: lazy reads, native scope, missing output,
explicit termination, empty/error, no model interrupt; 3 sizes × both themes passed.
See manual test for performance bounds. Live NOT RUN; risk medium.

## 25 validation

Implemented profile-local text presets (create/edit/delete/clear), accepted-prompt
history (deduplicated, delete/clear), editable draft population and supported slash
discovery/aliases. Unknown slash text remains a normal prompt; installed skills
retain suggestion precedence, including a skill named review. No replay/queue.
`pnpm exec vitest run src/utils/promptLibrary.test.ts src/components/content/ThreadComposer.submission.test.ts`: 12 passed; typecheck passed.
`node scripts/test-approved-prompts.cjs`: create/edit/reload/selection, history,
unknown slash, action alias without mutation, explicit clear; all sizes/themes passed.
Storage failures/credential-like and oversized prompt handling tested. Performance
bounds in manual test. Live NOT RUN; risk medium. Browser profile is the scope;
this is not a server-synchronized preset facility.

## 20 validation and scope limitation

Partial: actual native V2 readiness/consolidated count plus loaded thread's selected
summary. `memory.rs` and request_processors/memory_status.rs establish read semantics.
`thread/memoryMode/set` changes contribution, but thread settings/read responses do
not expose the effective mode. No unverifiable switch or account-wide change added.
`pnpm exec vitest run src/api/memoryStatus.test.ts`: 2 passed; typecheck passed.
`node scripts/test-approved-memory.cjs`: lazy actual zero/summary/null/error/no writes,
all sizes/themes passed. Performance in manual test. Live NOT RUN; read scope low risk.

## 31 validation and scope limitation

Partial: native Remote Control service status and environment-scoped paginated
registered clients, honestly distinguished from currently connected clients.
No pairing/revocation/enablement, credentials or infrastructure changes. The
experimental management contract is established at the floor, but access mutations
are deferred under the medium-risk ceiling; no designated real devices exist.
`pnpm exec vitest run src/api/remoteControl.test.ts`: 2 passed; typecheck passed
before the independent Apps work. `node scripts/test-approved-remote.cjs`: lazy
reads, exact environment scope, errors, zero access mutations; all sizes/themes
passed. Performance in manual test. Live NOT RUN; read scope low risk.

## 18 validation

Implemented lazy paginated picker for accessible/enabled native Apps on loaded
threads. Uses exact structured UserInput mention `{name,path:"app://<id>"}`;
verified against floor `turn_start.rs` test `app://demo-app`, apps.rs and native
input contract. Separate draft references persist in existing profile-scoped draft
storage; unavailable observed selections block sending; connection changes clear
remote references. Native history displays App identity as safe text, not raw JSON.
No OAuth/install/pre-send probe or new-thread selection. Existing argument arity
is preserved when there are no App references.
Focused 6 suites: 338 passed (plus bounded selection regression); typecheck passed.
`node scripts/test-approved-apps.cjs`: picker, exact turn input, reload persistence,
removed selection, connection invalidation/errors; all sizes/themes passed after
rerunning on stable source (initial HMR interrupted the first run). Performance in
manual test. Live NOT RUN; risk medium.

## 16 validation and scope limitation

Partial: targeted version-checked enabled scalar editing for existing simple-name
MCP definitions in a single base user config layer. config.rs ConfigRead/ValueWrite
and native config_rpc.rs tests establish layer identity, expectedVersion and
ok/okOverridden semantics. Only selected key/boolean/file/version is written;
secrets/unrelated config never round-trip. Existing status/OAuth/reload/tools remain.
Saved config is not claimed effective; no reload or installation is automatic.
Full add/remove/command/transport/secret editing remains blocked in this iteration:
managed/project/profile origins, omitted secrets and full-definition validation
require broader edit ownership and conflict handling. Scalar edits remain useful.
`pnpm exec vitest run src/api/mcpConfiguration.test.ts src/components/content/SkillsMcpHub.navigation.test.ts`: 3 passed. Typecheck passed after using the repository's
existing JS library target. `node scripts/test-approved-mcp.cjs`: lazy read, exact
version/file/scalar, confirmation, no secrets/reload and conflicts; all sizes/themes
passed. Performance in manual test. Live NOT RUN; narrow scope medium risk.

## 17 validation and scope limitation

Partial: working read-only native vertical-collection browser with local filtering
and expandable returned source/version/installed/enabled/developer/description.
In floor request_processors/plugins.rs: plugin_list_response starts background
bundle work for local/default/shared/created-by-me or remote refresh scopes;
plugin_installed_response unconditionally calls maybe_start_remote_installed_plugin_bundle_sync.
Explicit `{marketplaceKinds:["vertical"],forceRefetch:false}` avoids those branches
and reads the curated collection only when the native configuration exposes it
(the floor's RemotePlugin-enabled branch may return an empty collection).
No flags are enabled and no registry is fabricated. Broader catalog/lifecycle
scope is blocked: even nominal reads can change installed bundles; native install/
uninstall method names are not proof of safe ownership/removal/reload semantics
for this repository. These methods are not falsely described as experimental merely
because this iteration does not enable them.
`pnpm exec vitest run src/api/curatedPlugins.test.ts src/components/content/SkillsMcpHub.navigation.test.ts`: 3 passed. Typecheck passed. Browser matrix passed lazy
vertical-only reads, filtering/details/state, empty/error, no install/sync calls.
Performance in manual test. Live NOT RUN; read subset low risk, lifecycle high.

## Blocked individual features

- **15 — Side chat:** floor thread/fork supports ephemeral storage but inherits
  workspace/tools; sandbox read-only constrains command filesystem access, not a
  guarantee against MCP/connector side effects. No verified native read-only
  question-only contract was found. Prediction-mode restrictions are not a supported
  side-chat product contract. The current desktop state has a single selected-thread
  live renderer; an independent simultaneous side viewer would also need new event/
  lifecycle ownership. Ordinary Fork is retained and is not relabeled side chat.
  Reassessed risk high for promised isolation; no mutation probe or placeholder.
- **19 — Skills extensions:** floor plugin.rs exposes skills/extraRoots/set with
  a complete extraRoots list. catalog_processor.rs replaces the shared service's
  roots and notifies all clients; no getter or incremental add/remove contract is
  exposed. A client-owned list could overwrite another client's roots. Standalone
  skill install/removal has no native exact-resource API. Plugin uninstall is a
  broader resource mutation, and plugin/installed can synchronize bundles. Existing
  installed skill source/details/enable/disable/composer selection remain; no second
  installer/registry, arbitrary URL/script or shared-root deletion. Reassessed risk
  high for new mutations. No useful safe management extension established.

Authoritative floor source links:

- [Thread contract](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
- [Review targets](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/src/protocol/v2/review.rs)
- [Thread implementation](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/thread_processor.rs)
- [Plugin list side effects and vertical branch](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/plugins.rs)
- [Shared skills roots setter](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server/src/request_processors/catalog_processor.rs)
- [Config layers and versioned writes](https://github.com/openai/codex/blob/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs/app-server-protocol/src/protocol/v2/config.rs)

## Shared-path review follow-up

The full suite initially passed 1,382 tests (two opt-in live tests skipped).
Focused review then exposed live overlay ordering across tool/command/agent
buckets. A transient WeakMap tracks first-observed object order (including Vue
raw/proxy identity), merging the existing four ordered buckets in linear time.
No message fields, persistence, cache or subscriptions are added; native persisted
order remains authoritative. The reproducing desktop-state test and focused
4-suite run now pass (227 tests). Tool text additionally redacts URL userinfo and
bounds object-key traversal without allocating an unbounded key array.
Browser execution matrix rerun passed with explicit tool → command → agent ordering,
one execution row, and zero item-driven history reloads. Typecheck passed.

Compaction follow-up: failed-turn completion is now correlated to the observed
native compaction turn. An obsolete failed turn cannot retire a pending new
compaction. Four focused controller tests passed; no new requests or state store.
