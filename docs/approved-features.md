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

Git follow-up: global --literal-pathspecs prevents a status-supplied filename such
as `:(glob)*` from broadening a selected tracked preview. The disposable real-Git
fixture verifies staged/unstaged, rename/delete, binary, literal filenames, and
64 KiB bounded large untracked patches. `pnpm exec vitest run src/api/workingTree.test.ts src/api/workingTree.fixture.test.ts`: 3 tests passed. No real repository or
user resources are mutated by that fixture; it creates and removes its own tmpdir.

Connection-safety follow-up: all seven new read panels reject delayed responses
after a native disconnect/epoch change. Process termination and MCP saves now
explicitly retain an **outcome unknown** message when connection changes during
the write; stale acknowledgments cannot report success and no mutation is retried.
`node scripts/test-approved-stale.cjs` and `node scripts/test-approved-uncertain.cjs`
passed. The isolated TestChat fixture submitted a unique marker with representative
Markdown/code/file/reference links and inspected the actual assistant row:
hrefOk/titleOk/textOk all true; no live model call or real TestChat data was used.
Integration assertions now also cover scoped numeric unsupported errors for native
review and compaction while retaining exactly the existing generic error shape.

Final pre-lazy full verification: typecheck passed; 1,387 unit tests passed (two
opt-in live cases skipped); production build passed; built/dev credential-free
integration and CJS-driven public ESM CLI help passed. Optional UI payload growth
was measured at 419.63 → 458.17 kB main JS (gzip 134.13 → 146.57 kB), prompting
narrow lazy mounting through the app's existing async-component pattern. Controllers
and event ownership remain unchanged; final post-change measurements follow below.

## Final outcomes

All live validation below is **NOT RUN**. Runtime requirements are verified against
release source; browser/unit/integration fixtures prove the client paths, not a
connected deployment's optional capabilities. No paid turn, authentication,
real configuration/resource/device mutation or pending 09/11 live acceptance ran.

| ID | Outcome and exact added behavior | Required native contract | Automated/browser verification | Remaining scope and risk |
| --- | --- | --- | --- | --- |
| 01 | Implemented: four distinct inline review targets, progress, native entry/result rows, existing turn interrupt | review/start (inline), item lifecycle, turn/interrupt | reviewTarget/controller, desktop/normalizer suites; review matrix/reopened history | No detached delivery; medium |
| 02 | Implemented: explicit idle-only compaction, pending/observed completion/failure/unknown/unsupported | thread/compact/start, contextCompaction lifecycle, native usage events | compaction + obsolete-turn regression, desktop; compaction matrix | No promised token reduction; medium |
| 06 | Implemented: collapsed MCP/search identity/status/arguments/query/progress/public results/errors | mcpToolCall/webSearch history/items; MCP progress events | bounded/malformed/secret normalizer; live ordering regression; execution matrix | History cannot reconstruct absent detail or search status; medium |
| 08 | Implemented: lazy native process pages, loaded-item recent output, confirmed exact-ID termination | thread/backgroundTerminals/list/terminate | identity/false ack unit, process matrix, stale/uncertain mutations | Native list supplies no output or per-process connected status; medium |
| 12 | Implemented: remote staged/unstaged/untracked snapshot and lazy bounded per-file patches | command/exec argv/cwd/timeout/output cap plus remote Git | parser/argv tests; disposable real-Git fixture; working-tree matrix/stale replies | 300 paths/64 KiB caps; live latency not measured; medium |
| 15 | Blocked: no new side-chat UI | No verified question-only tool isolation contract | Floor fork/source/engine analysis; existing fork regressions retained | Ephemeral is not read-only; separate engine ownership would exceed ceiling; high |
| 16 | Partial: version-checked enabled boolean for existing simple-name base-user MCP definitions | config/read layers + config/value/write expectedVersion | secret projection/exact scalar unit, MCP matrix/conflict/stale/uncertain | No add/remove/command/URL/secret/profile/project edits or auto-reload; medium subset |
| 17 | Partial: actual vertical curated collection browser/filter/returned details and state | plugin/list with explicit vertical kinds, forceRefetch:false | projection/serializer unit, curated matrix/empty/error/stale | Collection may be unavailable/empty; broader reads can sync bundles; lifecycle high risk, read subset low |
| 18 | Implemented: lazy available Apps picker and removable exact structured references in drafts/submissions/history | app/list and UserInput mention app://id | exact serializer/draft/connection/unit/shared suites; Apps matrix | Loaded threads only; saved availability must be rechecked; medium |
| 19 | Blocked: installed skills behavior preserved | No safe incremental roots getter/add/remove or standalone skill lifecycle | Floor shared replacement setter/plugin sync analysis; existing Skills suites | Cannot preserve shared roots or exact-resource removal through established workflow; high |
| 20 | Partial: actual readiness/count and selected thread summary; unknown contribution mode explicit | memory/status, thread/memory/read | null/zero/bounds unit, memory matrix/stale replies | No effective-mode getter, so no preference/reset controls; low subset |
| 25 | Implemented: editable text presets, accepted recent text, explicit editing/deletion/clearing, supported aliases | Browser profile storage; aliases open existing controls | composer/accepted storage/credential/error tests; prompt matrix/reload | 20 presets/30 prompts/8,000 chars; no queue/auto-send; medium |
| 31 | Partial: service status and environment-scoped registered-client pages | remoteControl/status/read, remoteControl/client/list | allowlisted projection unit, Remote Control matrix/stale replies | Registered ≠ connected; pairing/revocation/expiry/authorization lifecycle not accepted in this scope; low reads |

Live version was not queried; the evidence version is the supported **0.169.0 floor**,
not an assertion about any running listener. Ordinary generic RPC consumers retain
their original HTTP error shape; numeric codes are scoped to usage/review/compaction.

Protected regressions: CAP-001 fork/revert orchestration, source preservation,
cutoffs and editable draft tests; CAP-002 conversation transfer/imported persistence,
cancellation/unknown outcome and full export fixtures; CAP-003 normalizer,
metadata recovery/cache/attribution and historical-label suites all pass in the
full unit run. Native history order is authoritative; transient overlay ordering
adds no stored metadata. New pending native actions also block same-thread native
fork/revert before destructive history writes; other conversations remain usable.

The short-history regression comparison used the exact same original conversation-
tools fixture against both production builds. Before: zero older-page requests in
all three viewports. The first changed layout fetched one older page at 1280 and
375 widths because a programmatic bottom scroll also satisfied the near-top
threshold. The smallest fix excludes bottom-follow scroll events from automatic
older paging; upward scroll and explicit Load earlier retain their existing paths.
The new viewport test reproduces both sides. No history/pager API or cache changed.

Review lifecycle follow-up: native turn interruption now uses the acknowledged
review thread/turn identity through the existing gateway, including before the
turn/started event. Cancellation has its own in-flight guard and propagates errors;
it cannot claim a request when the ordinary chat interruption guard returned early.
One bounded early completion is reconciled by turn identity when events precede
the review reply. Focused race/viewport/desktop/component suites: 229 passed.

MCP cache audit: floor config_processor.rs clears the native plugin/skills caches
after a successful config mutation. That is a native consequence of the explicit
version-checked scalar save, not an automatic MCP reload or an extra client read.
No startup cache invalidation is introduced; a later native catalog read may rescan.
Saved/overridden replies never claim that effective runtime state was verified.

Native review result rows now retain reliable turn execution model/effort evidence
and display recorded item completion time only after the turn is complete. Missing
or streaming evidence stays unavailable. The CAP-003 regression covers both known
and unknown review metadata; no composer preference is used as historical evidence.

Preset keyboard audit: the editor is inside the existing composer form. Plain
Enter in the preset-name input is prevented from implicitly submitting the chat;
IME confirmation is left alone. Browser coverage holds a nonempty chat draft,
presses Enter in the preset name and asserts no native turn and no draft change.

Structured-result follow-up: native public MCP structuredContent is rendered as
bounded inert JSON through the same credential/metadata/diagnostic-key projection.
Empty text content is not mislabeled Empty result when structured results exist.
The new regression covers public values plus omitted secret/debug/_meta fields.
Focused shared normalizer/desktop/export/curated suites: 248 tests passed. Final
full unit suite: 1,394 passed, two opt-in live tests skipped (119 files passed,
two skipped). No dependencies or runtime baseline were changed.

Background output code-path limit: output uses matching loaded command items,
not remote output reads. At most 200 rows × 6,000 characters can exist in the
bounded view (including hidden details DOM). Matching searches loaded history per
row; worst-case rendering depends on loaded history size. No live stress/heap
measurement of 200 concurrent native background processes was performed.

## Final verification commands and results

Application source is through `3c18734` plus the earlier listed feature/safety
commits. Later commits contain verification harnesses and documentation only.
The final source passed:

```sh
pnpm run typecheck
# PASS frontend + server, ES2020 libraries / existing runtime baseline
pnpm run test:unit
# PASS 119 files, 1,394 tests; 2 opt-in live files/tests skipped
pnpm run build
# PASS production frontend, compressed assets and public ESM CLI (Node 18 target)
pnpm run test:integration:fixture
# PASS built CLI and dev server; generic error shape preserved, scoped review/
# compaction/usage unsupported evidence, native-title/auth redaction, one upstream
# connection per entry; independently managed fixture survives WebUI shutdown
node -e "const {execFileSync}=require('node:child_process');const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!help.includes('--port'))throw Error('Missing CLI options');console.log('CJS harness loaded public ESM CLI: --help and --port PASS')"
# PASS: public entry is ESM; no public CJS library export is invented
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-approved-browser-matrix.cjs
# PASS 11 shipped UI scopes, each 3 sizes × 2 themes; plus stale replies,
# uncertain mutations and isolated TestChat hrefOk/titleOk/textOk
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-conversation-tools.cjs
# PASS existing 09/11/24/32 fixtures, all sizes/themes; live status unchanged
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-approved-execution.cjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-approved-plugins.cjs
# PASS final structured-result/sanitization follow-up on the affected real UI flows
CONVERSATION_MEASURE_OUTPUT=output/playwright/approved-performance PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/measure-conversation-tools.cjs /tmp/approved-baseline .
# PASS identical production fixture, 3 alternating before/after trials,
# plus complete large export and lazy asset assertions
```

No final failing check remains. During development, fixture timing/HMR interruptions
were rerun on stable source; an async slash-action assertion now waits for the
actual lazy panel to open. A confirmed layout-induced older-page fetch was fixed,
not waived. Original old-page/startup assertions remain enabled. Comparison
support in the existing browser script can serve an extracted production build
(`TOOLS_DIST_ROOT`), select a viewport (`TOOLS_WIDTH`), or record only startup
(`TOOLS_STARTUP_ONLY`); these do not change app behavior or acceptance claims.

Browser Use was not used because these checks need isolated HTTP/WebSocket
interception, delayed responses and page/storage manipulation. CJS Playwright
exercises the actual changed controls. All native writes target intercepted
fixtures; the Git fixture owns its temporary repository. No credentials, paid
calls or live conversations/configurations/devices/processes were used.

## Comparable performance evidence

Baseline: clean `main` at `99acc2c`, built before implementation with the same
existing `node_modules`/locked dependencies and build settings; copied to
`/tmp/approved-baseline/dist`. Final manifest identity is checked against the
measured artifact. Node v22.23.2, production builds, gzip level 6, 1280×900,
fresh contexts, 7,000 ms startup wait, same metadata/model/project/history/empty-pin
responses and intercepted WebSocket. Three alternating before/after pairs agree.
These are fixture measurements, not native server or live model latency.

| Metric | Before | Final |
| --- | ---: | ---: |
| Main JS bytes | 419,631 | 436,492 |
| Main JS gzip bytes | 134,127 | 140,070 |
| Startup requested JS bytes | 493,577 | 511,136 |
| Startup API requests | 14 | 14 |
| Startup fixture API bytes | 1,606 | 1,606 |
| Duplicate API calls per method/path | 0 | 0 |
| Optional feature chunk fetches before open | 0 | 0 |

Main JS grows by 16,861 bytes (4.02%), gzip by
5,943 bytes. Lazy mounting removed about 22 kB from the initial optional-panel
startup regression. The remaining payload supplies the new native item normalization,
review/compaction state and composer serialization/storage. No new dependency,
startup RPC, polling or notification subscription. Optional ConversationTools,
AppsPicker, PromptLibrary and RemoteControlStatus chunks were absent from every
startup request trace. Existing Skills route remains lazy.

Large export: 2,000 turns, 4,003 message headings including two imported messages
and the large command; 4,539,118 Markdown bytes from 4,957,246 fixture API bytes.
One initial detail read plus 199 serial older-page reads. Observed completion
767.7 ms; maximum animation-frame gap 33.3 ms; no recorded long tasks.
All prompts/answers ordered, Portable prefix exactly once, 300,000-character command
included without overflow, no page error. This does **not** resolve live 11 acceptance.
No live request latency, context reduction, memory heap, server catalog cost or
200-process stress profile is claimed. Feature-specific code-path bounds and
cache implications are recorded in their manual tests and scope notes above.

Reports (generated, ignored artifacts):

- `output/playwright/approved-performance/performance-comparison.json`
- `output/playwright/approved-browser-matrix.json`
- `output/playwright/approved-screenshot-evidence.json`
- `output/playwright/approved-testchat-results.json`
- `output/playwright/conversation-tools-results.json`

## Screenshot evidence

Actual controls tested at 1280×900, 375×812 and 768×1024, both themes. Thread tool
URL: `http://127.0.0.1:4173/#/thread/approved-fixture`; MCP/curated browser URL:
`http://127.0.0.1:4173/#/skills`. Existing acceptance fixture:
`http://127.0.0.1:4173/#/thread/tools-fixture`. Assertions cover the respective
operation, errors/empty/unknown states, native payloads and isolation described above.
All 66 new-feature screenshot paths, URLs, viewport/theme and results are in the
[screenshot manifest](../output/playwright/approved-screenshot-evidence.json).

Examples (absolute paths):

- `/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/approved-18-375-dark.png`
- `/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/approved-17-1280-light.png`
- `/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/testchat-approved-features-cjs.png`

![Dark Apps picker, 375×812](../output/playwright/approved-18-375-dark.png)
![Light curated collection, 1280×900](../output/playwright/approved-17-1280-light.png)

The isolated TestChat fixture submitted a unique marker and representative Markdown,
code and file/reference links, then inspected the actual rendered assistant row:
hrefOk, titleOk and textOk all PASS. It uses disposable intercepted data, not any
pending live 09/11 acceptance dataset.

## Files, commits and final repository state

No README expansion, package/dependency/runtime-baseline update, branch creation,
switch, push, merge or rebase. Origin was verified as
`https://github.com/naoto-aoki-fy/codex-webui.git`; merge/rebase markers absent.
Work stayed on `main`. The persistent 5173 server was not stopped or restarted.
4173 was started from this checkout after the listener check and serves current
source; it is left running. The exec sandbox did not expose a listener PID through
lsof, so ownership was established by this turn's successful launch/current-module
checks, not by inventing a cwd/PID result.

Changed files through this pass (including this report and manual indexes):

```text
PROJECT_SPEC.md
docs/approved-features.md
scripts/approved-fixture.cjs
scripts/measure-conversation-tools.cjs
scripts/test-approved-apps.cjs
scripts/test-approved-browser-matrix.cjs
scripts/test-approved-compaction.cjs
scripts/test-approved-execution.cjs
scripts/test-approved-mcp.cjs
scripts/test-approved-memory.cjs
scripts/test-approved-panels.cjs
scripts/test-approved-plugins.cjs
scripts/test-approved-processes.cjs
scripts/test-approved-prompts.cjs
scripts/test-approved-remote.cjs
scripts/test-approved-review.cjs
scripts/test-approved-stale.cjs
scripts/test-approved-testchat.cjs
scripts/test-approved-uncertain.cjs
scripts/test-conversation-tools.cjs
scripts/test-external-app-server.cjs
src/App.vue
src/api/apps.test.ts
src/api/apps.ts
src/api/backgroundTerminals.test.ts
src/api/backgroundTerminals.ts
src/api/codexGateway.test.ts
src/api/codexGateway.ts
src/api/curatedPlugins.test.ts
src/api/curatedPlugins.ts
src/api/mcpConfiguration.test.ts
src/api/mcpConfiguration.ts
src/api/memoryStatus.test.ts
src/api/memoryStatus.ts
src/api/normalizers/executionDetails.test.ts
src/api/normalizers/executionDetails.ts
src/api/normalizers/v2.test.ts
src/api/normalizers/v2.ts
src/api/remoteControl.test.ts
src/api/remoteControl.ts
src/api/workingTree.fixture.test.ts
src/api/workingTree.test.ts
src/api/workingTree.ts
src/components/content/AppsPicker.vue
src/components/content/BackgroundTerminals.vue
src/components/content/ConversationTools.vue
src/components/content/CuratedPlugins.vue
src/components/content/McpConfiguration.vue
src/components/content/MemoryStatus.vue
src/components/content/PromptLibrary.vue
src/components/content/SkillsMcpHub.vue
src/components/content/ThreadComposer.submission.test.ts
src/components/content/ThreadComposer.vue
src/components/content/ThreadConversation.vue
src/components/content/WorkingTreePanel.vue
src/components/content/composerContracts.ts
src/components/content/composerInput.ts
src/components/content/conversationViewport.test.ts
src/components/content/conversationViewport.ts
src/components/sidebar/AccountSettingsPanel.vue
src/components/sidebar/RemoteControlStatus.vue
src/composables/desktopTurns.ts
src/composables/liveItemOrder.test.ts
src/composables/liveItemOrder.ts
src/composables/threadCompaction.test.ts
src/composables/threadCompaction.ts
src/composables/threadReview.test.ts
src/composables/threadReview.ts
src/composables/useDesktopState.messages.test.ts
src/composables/useDesktopState.ts
src/server/codexAppServerBridge.ts
src/style.css
src/types/codex.ts
src/utils/composerDraftStorage.ts
src/utils/desktopMessageReconciliation.ts
src/utils/promptLibrary.test.ts
src/utils/promptLibrary.ts
tests/chat-composer-rendering/approved-execution-details.md
tests/chat-composer-rendering/apps-picker.md
tests/chat-composer-rendering/index.md
tests/chat-composer-rendering/optional-tools-loading.md
tests/chat-composer-rendering/prompt-library.md
tests/git-worktrees-rollback/current-working-tree.md
tests/git-worktrees-rollback/index.md
tests/git-worktrees-rollback/native-review.md
tests/theme-layout-terminal/background-processes.md
tests/theme-layout-terminal/index.md
tests/thread-loading-state/index.md
tests/thread-loading-state/manual-compaction.md
tests/thread-loading-state/thread-conversation-loads-earlier-turns-on-demand.md
tests/website-docs-misc/curated-plugins.md
tests/website-docs-misc/index.md
tests/website-docs-misc/mcp-configuration-switches.md
tests/website-docs-misc/memory-status.md
tests/website-docs-misc/remote-control-status.md
```

Application/verification commits (chronological; this final documentation commit
is reported separately in the completion response):

```text
e4b9f0d docs: bound approved feature scopes against runtime contracts
3ae0ebe feat: show bounded MCP and web search execution details
9eeb1e3 feat: inspect remote Git working-tree changes on demand
85ecb95 feat: request native conversation compaction while idle
e7799f7 feat: run native inline code reviews with supported targets
968c818 feat: inspect and terminate native thread background processes
e30392f feat: add text presets prompt history and supported command aliases
d3e92f8 feat: inspect native memory readiness and thread summary
036190a feat: inspect native Remote Control status and registered clients
91e2905 feat: select Apps using native structured conversation references
d14e98b feat: edit existing MCP enablement with config version checks
d4df127 feat: browse the native curated plugin collection without bundle sync
73a8596 fix: preserve observed execution order across live overlay buckets
3ec56a5 fix: correlate compaction failures with the native compaction turn
405f36f fix: restrict working-tree previews to literal Git paths
1505c0d fix: retain uncertain mutation outcomes across connection changes
2efe196 fix: avoid older-history reads while following the conversation bottom
12ec620 fix: preserve native review outcomes metadata and history safety
3a37ed8 perf: load optional conversation tools only when opened
817468e fix: prevent preset-name Enter from submitting the chat draft
3c720ed fix: label saved MCP settings without claiming runtime verification
3c18734 fix: preserve safe structured MCP results and accurate empty states
0944a8e test: compare startup assets and retain conversation tool regressions
```

Final completion checks require `git status --short` to be empty on `main`; the
completion response records the actual result after the documentation commit.
