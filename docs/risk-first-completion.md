# Risk-first approved features: completion report

Implementation starts at clean `main` / `42a9790`. The supported runtime floor is
unchanged: independently managed Codex App Server **0.169.0**. Official contracts
were inspected at release commit
[`d32063f96c2dff1dc96af839b3952abb6acfeda4`](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs),
including native request processors and tests. Bundled generated types and the
0.167.2 development dependency were not treated as proof of runtime support.
No dependencies, baseline runtime, authentication transport, network listener or
App Server lifecycle ownership were changed.

Full implementation notes, phase gates, native source references and failure-mode
analyses are in [the risk assessment](risk-first-features.md). Phase 1 delivered
inspection before mutations; Phase 2 delivered native queue and explicit remote
worktree workflows; Phase 3 delivered restricted permission/configuration/Hook,
native sign-in and permanent-deletion operations. Hook mutation followed targeted
configuration work because the verified file/version contract was a prerequisite.
33's verified read-only scope was inserted before authentication/shell/deletion;
its full workflow was not specified by the inventory label. An alternate native standalone command contract was verified late, after the
initial thread-shell path was blocked. Its read-only gate preceded Full access;
the final feature change then tightened permanent deletion against commands from
other conversations and reran its irreversible-operation gate. This explicit
ordering deviation reflects that additional verified contract. Final audits corrected a profile
bound, input styling and lazy-preview ownership, without introducing further
mutation capabilities.

## Finalization

Permanent deletion is now operationally withheld in both its UI and feature controller. Feature 10 is PARTIAL for inspection only, with its mutation BLOCKED. See [finalization evidence](implementation-finalization.md). Authentication and queue guarantees retain their documented limits. All new live acceptance remains NOT RUN.

## Outcomes for all approved IDs

All **new live acceptance is NOT RUN**. No designated live accounts, conversations,
processes, repositories, devices, paid sessions or Cloud tasks were provided.
Fixtures and disposable Git repositories are development evidence, not live
App Server acceptance. No blocker was bypassed through global configuration.

The subsequent [high-impact evidence review](high-impact-evidence-review.md)
records corrective commits and remaining deletion, account-isolation and queue
guarantee gaps. It preserves these feature classifications and does not close
high-impact live acceptance.

Risks are estimates: tuple **P/I/R/T**, score **P + 2I + R + T**. The first score
is the reassessed full feature (previous assessment in parentheses); the second
is the initial delivered mutation/inspection scope before safeguards; the third
is residual risk for the delivered scope. A blocked scope has no shipped behavior
and no meaningful delivered residual score; its unsupported path retains the
full/attempted risk. High residual risks are reported as high, not relabeled.

Browser abbreviation **6V** means actual changed UI at `http://127.0.0.1:4173/`
(thread fixture route `#/thread/approved-fixture`, plus normal navigation), in
light/dark at **1280×900, 375×812, 768×1024**. Final runs use the same stable
production assets and credential-free intercepted HTTP/WebSocket fixtures.
Unit file names below are under `src/api/` or `src/composables/`; every delivered
scope also passes the final full suite. B filenames are `scripts/test-risk-*.cjs`.

| ID | Status and delivered behavior | Full / initial / residual risk | Verified runtime/API evidence | Automated and browser verification | Live | Limits / prerequisites |
|---|---|---|---|---|---|---|
| 05 | **IMPLEMENTED**: native direct children, active/archived lists, status/role, details, parent links and navigation | 3/3/2/3=14 (21) / 2/2/1/2=9 / 1/2/1/2=8 | `thread/list.parentThreadId`, `thread/read`; native relation-filter tests | U `subagents`; B `subagents`, 6V: lazy/empty/unsupported/delayed navigation, no recursion | NOT RUN | Direct children only; no spawning/termination, as approved |
| 21 | **PARTIAL**: loaded native Hook inventory and targeted saved enable/disable or exact-definition trust approval | 4/5/4/5=23 (22) / inspection 2/2/1/2=9; writes 3/5/3/4=20 / 2/5/3/4=19 | loaded-thread `hooks/list`; official TUI `hooks.state` upsert, config CAS/hash splitting | U `hooksInspection`, `hookPolicy`; B `hooks`, `hook-policies`, 6V each; preservation/stale/unknown/secret tests | NOT RUN | User/project command/MCP definitions only. Saved future-load policy is distinct from loaded state; no global reload, execution, plugin/managed edits or trust revocation |
| 23 | **PARTIAL**: public effective settings/layers/origins/restrictions/profiles; versioned model/effort default edits | 4/5/5/5=24 (24) / inspection 2/2/1/2=9; writes 3/4/3/4=18 / 2/4/3/4=17 | `config/read`, `configRequirements/read`, targeted `config/value/write`, native file/version CAS | U `configInspection`, `userConfigDefaults`, RPC errors; B `config`, `config-changes`, 6V each; global profile bound tested | NOT RUN | Only actual active base/user-profile file; no generic editor, profile lifecycle/switching, experimental flags or unknown/secret rewrites |
| 30 | **BLOCKED**: no speculative Cloud view or mutation | 4/5/5/5=24 (24) / no viable supported scope / — | Official Cloud crates exist but no supported App Server task integration API | Official request enum, Cloud client source inspection; unchanged regression suite | NOT RUN | Requires official remotely usable, server-owned Cloud contract; no private-endpoint/token proxy |
| 28 | **PARTIAL**: Claude Code/Cursor project configuration discovery and bounded source/destination manifest preview | 4/5/5/5=24 (24) / 2/2/1/3=10 / 1/2/1/3=9 | `externalAgentConfig/detect`, official migration sources and empty-session ledger early return | U `importPreview`; B `import`, 6V: source selection, scope/exclusion labels, empty/error/disconnect, no import | NOT RUN | No home/session discovery or import execution. File import lacks CAS/backup; session import may append to a destination absent from preview. Exact diffs/conflicts not supplied by contract |
| 34 | **BLOCKED**: no fabricated IDE bridge | 4/4/4/5=21 (21) / no viable supported scope / — | Native filesystem API does not expose active editor, unsaved buffer or selection identity | Repository/native protocol inspection; unchanged regressions | NOT RUN | Requires supported authenticated IDE context bridge; on-disk files are not editor buffers |
| 03 | **PARTIAL**: observed effective thread security; confirmed native approval and built-in sandbox changes | 5/5/4/4=23 (23) / inspection 2/2/1/2=9; writes 3/5/3/4=20 / 2/5/3/4=19 | normal resume/settings events; `thread/settings/update`; managed requirements/native writable-cwd semantics | U `threadSecurityObservation`, `threadPermissions`; B `permissions`, `permission-changes`, 6V each; refresh persistence and unknown reconciliation | NOT RUN | on-request/never and restricted built-in choices only; no custom roots/named-profile editing. Effective matching event required; no global changes |
| 04 | **PARTIAL**: exact native denied-review/target/thread/turn identities and bounded details | 4/5/3/4=21 (21) / 2/2/1/3=10 / 1/2/1/2=8 | `item/autoApprovalReview/completed`; retry requires opaque core Guardian event | U `deniedActionObservation`; B `denials`, 6V: dedup, association, secret/bounds/disconnect | NOT RUN | Public unstable projection cannot establish retry eligibility, expiry or original serialized denial. No retry reconstructed from displayed text |
| 29 | **PARTIAL**: actual auth/method inspection, confirmed native browser/device ChatGPT login, exact cancellation and account/cache reconciliation | 4/5/5/5=24 (24) / inspection 2/2/1/2=9; writes 4/5/4/4=22 / 3/5/4/4=21 | `account/read`, login start/cancel/completion; official account processor owns tokens, auth reload and notifications | U `nativeAuthentication` and auth tests; B `auth`, `native-authentication`, 6V each: cancel/completion races, code storage omission, unknowns and send barrier | NOT RUN | Signed-out default provider, known login policy and ≤20 idle loaded threads. No replacement OAuth/API-key client, account switching, external credential takeover or credential persistence. No cross-client activity lock |
| 27 | **BLOCKED**: no misleading dictation UI or silent/billable recording | 4/4/3/3=18 (18) / attempted 4/4/3/5=20 / — | Native realtime source routes completed transcripts/handoffs into coding admission; no transcription-only API | Official realtime admission/source inspection; no microphone/media/billable call | NOT RUN | Mandatory initial single-shot editable-input isolation cannot be established. `clientManagedHandoffs` does not suppress coding admission; no third-party substitute |
| 07 | **IMPLEMENTED**: explicit native Queue mode, list/preview, structured add, plain-text edit preserving other inputs, delete, reorder and confirmed idle start | 4/4/4/4=20 (20) / 3/3/2/3=14 / 2/3/3/3=14 | Five native `thread/queue/*` writes plus list/change events; native persistence and client ID acknowledgment | U `nativeQueue`, composer/drafts, HTTP UUID compatibility; B `queue`, `queue-management`, 6V each; refresh, ordering, rejection/unknown/reconnect | NOT RUN | Immediate steering remains default. Native editable text only, ≤100 displayed entries; no browser execution registry. External edits follow native non-CAS semantics |
| 13 | **IMPLEMENTED**: explicit remote worktree preview/create/reconcile, separate new-conversation setup in verified destination | 4/5/4/4=22 (22) / 3/4/3/4=18 / 2/4/3/3=16 | Established native `command/exec` fixed-argv Git and native project registration | U `createWorktree` with disposable Git repos and gateway/path tests; B `worktree`, 6V: confirmation/conflict/unknown reconciliation, preserved source draft | NOT RUN | POSIX new branch/separate path only; no force/reset/overwrite, automatic migration or cleanup. Actual Git creation disables Hooks |
| 14 | **BLOCKED**: no UI-only cwd update or implicit Fork substitute | 5/5/4/4=23 (23) / unsupported safe limited path retains 23 / — | `thread/settings/update.cwd` exists, but historical turns lack cwd provenance used by current relative-link renderer | Native settings and historical link/project ownership inspection; protected link/history regressions | NOT RUN | Requires historical per-response cwd identity/persistence and safe project/environment transition; current single-cwd links would be reinterpreted |
| 26 | **IMPLEMENTED for POSIX local contexts**: explicit native standalone commands, read-only default, confirmed Full access, bounded output/exit and exact termination | 4/5/5/5=24 (24) / read-only 4/4/3/4=19; Full 4/5/5/4=23 / 3/5/5/4=22 | `command/exec` caller process ID, deferred final exit response and exact `command/exec/terminate`; native local environment/shell and managed sandbox validation | U `nativeShell`, RPC error opt-in, complete Composer and desktop conflict guards; B `shell`, read-only/Full light/dark at all three sizes, cross-thread deletion exclusion and separate model Stop | NOT RUN | Requires a selected idle thread with exact single native local environment, POSIX cwd and native sh/bash/zsh. No PTY/stdin/history append, remote/mixed/unknown fallback or post-disconnect status getter. Full effects may be irreversible; no rollback/replay |
| 10 | **PARTIAL — inspection only; deletion mutation BLOCKED**: read-only native identity/scope inspection; controller cannot submit deletion | 5/5/5/5=25 (21) / 4/5/4/4=22 / 3/5/4/4=21 | Native `thread/delete`, post-success `thread/deleted`, attached/Fork-reference guards and native subtree ownership | U `threadDeletion`, imported-prefix guard, native cache/recovery/late-history/lazy-ownership and cross-thread standalone-command guards; B `deletion`, 6V: exact confirmation, no duplicate, reject/unknown, ACK/event, refresh | NOT RUN | Deletion submission is unconditionally withheld because native deletion lacks an atomic leaf-only precondition. Archive/restore are preserved. Earlier mutation fixtures are historical evidence only |
| 33 | **PARTIAL**: verified native Daybreak preference and advertised model access-program inspection | 3/4/3/4=18 (unassessed) / 2/2/1/2=9 / 1/2/1/2=8 | Official `daybreakEnabled`, model `availableAccessPrograms.cyber`, turn program/access enforcement tests | U `daybreakStatus`; B `daybreak`, 6V: missing/unset/false/empty/malformed/error/disconnect | NOT RUN | Capability exists in official release; not an unrelated security-scan product. No program-selection/entitlement/flag change or paid turn; full intended workflow beyond the inventory label remains unspecified |

## Verification commands and results

Commands run from the repository root with existing installed dependencies. No
real credentials are needed. Playwright CJS is used because these flows require request/WebSocket interception,
synthetic failures, storage setup and delayed module responses; no Browser Use
bridge was available in this session. The final product-source pass is stable; screenshots
use production assets rather than concurrently changing Vite dependency caches.
The first development-server matrix was interrupted, and another run timed out
waiting for the lazy panel; both were superseded by full stable production runs.
No incomplete run is counted as acceptance.

```sh
pnpm run typecheck
pnpm run test:unit
pnpm run build
pnpm run test:integration:fixture
node -e "const {execFileSync}=require('node:child_process');const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!help.includes('--port'))throw Error('Missing CLI options');console.log('CJS harness loaded public ESM CLI: --help and --port PASS')"
APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-browser-matrix.cjs
APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-approved-browser-matrix.cjs
TOOLS_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-conversation-tools.cjs
CONVERSATION_MEASURE_OUTPUT=output/playwright/risk-first-performance PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/measure-conversation-tools.cjs /tmp/risk-first-baseline .
```

All commands **PASS**. Final units: **1,484 passed, two skipped**, 137 passing
files/two skipped. New browser matrix: **17/17 suites**; existing approved browser
matrix: **14/14 suites**; conversation-tools regression: all three viewports and
both themes. New mutation input borders/backgrounds and delayed controller loading across
navigation are also asserted in a separate six-view deletion run. Type checks, production build, both credential-free
integration entry points and CLI loading all pass. Evidence JSONs:

- `output/playwright/risk-browser-matrix.json`
- `output/playwright/approved-browser-matrix.json`
- `output/playwright/conversation-tools-results.json`
- `output/playwright/risk-first-performance/performance-comparison.json`

Focused units and browser runs also passed before each feature commit; exact
scopes and earlier gate counts are recorded in the linked risk assessment.

The integration fixture validates built CLI and dev entry points, one independent
upstream connection, protocol traffic, auth redaction, correlated new-operation
errors, the unchanged ordinary RPC error shape and independent fixture survival.
It remains a fake server, not a real Codex service. CLI smoke uses a CJS harness
for the public ESM CLI (`--help`, `--port`); no nonexistent CJS export is invented.
The `exists`-branch fatal line in the unit output is an expected disposable Git
conflict fixture, not a failed test. The repository's two live-only skips remain.

## Protected capabilities and previous acceptance

- **CAP-001 PASS (automated):** original preservation, exact Fork/Revert cutoffs,
  editable restored drafts and reload persistence; pending new actions block
  conflicting mutations. Native deletion honors upstream Fork-reference rejection.
- **CAP-002 PASS (automated):** Portable prefixes/receipts persist, imported
  source/destination behavior remains intact, and permanent deletion cannot split
  an imported native suffix from its persisted prefix. Large export includes the
  prefix exactly once; no migration or deletion of receipts.
- **CAP-003 PASS (automated):** native historical timestamps/model/effort and
  fresh post-restore metadata regressions pass. No historical value is fabricated
  from current configuration or a new action's status.
- Existing send/steer/interrupt/approval, pagination/bottom-follow, read receipts,
  pins/grouping, review ordering/cancellation, MCP/Web rendering, literal Git
  pathspecs, Apps/Skills/Plugin/Memory/Remote Control, usage/diagnostics and large
  command-output fencing remain covered by full units and browser regressions.

Previous live acceptance remains exactly as documented: **09** is implemented and
fixture-validated; empty-thread restore succeeded, but refresh omitted it from
the native active list. Nonempty restore remains NOT RUN. This is not classified
as a confirmed upstream bug/specification. **11** is fixture/performance-tested;
live multi-page and persisted Portable Fork export remain NOT RUN. Neither pending
live acceptance was resumed. **24** remains accepted for available live account
data, other states via fixtures. **32** retains observed live connection/copy/
reconnect acceptance, with adversarial warning/redaction fixtures.

Blocked **15/19/22** and withheld lifecycle/contribution/access extensions of
**16/17/20/31** remain closed. No local Codex process management, provider proxy,
automatic authentication, generic config editor, PTY terminal subsystem or network
exposure change was introduced.

## Performance

Same installed dependencies/build settings, Node v22.23.2 and Chromium;
production builds, 1280×900, three alternating before/after fresh contexts with
7-second startup samples. Baseline is the independently built clean `42a9790`
retained at `/tmp/risk-first-baseline`; after is final feature source `420ef60`.
All browser suites had finished before this paired measurement.

| Measurement | Before | After |
|---|---:|---:|
| Startup API requests (all three pairs) | 14 | 14 |
| Startup response bytes | 1,606 | 1,606 |
| Duplicate startup API requests | 0 | 0 |
| Startup JS bytes fetched | 511,136 | 537,692 |
| Main JS raw bytes | 436,492 | 463,042 |
| Main JS gzip bytes (level 6) | 140,070 | 147,965 |
| Intercepted native WS attempts / peak open / open at sample | 2 / 2 / 2 | 2 / 2 / 2 |
| Large export turns / messages | 2,000 / 4,003 | 2,000 / 4,003 |
| Large export Markdown bytes | 4,539,118 | 4,539,118 |
| Large export API bytes | 4,957,246 | 4,957,246 |
| Large export initial detail / older-page reads | 1 / 199 | 1 / 199 |
| Large export elapsed (one sample per revision) | 769.4 ms | 764.7 ms |
| Maximum animation-frame gap | 16.8 ms | 16.8 ms |
| Observed large-export long tasks | none | none |
| CLI build output (tsup report) | 184.80 KB | 186.17 KB |

Main JS grew **26,550 raw bytes / 7,895 gzip bytes** (6.08% / 5.64%); aggregate
startup JS grew 5.20%. Active queue/permission state, operation guards and Composer
controls are available immediately; optional panels and authentication/deletion/
command controllers remain lazy. No startup API/subscription increase appeared.
The small export-time difference is not evidence of a speedup; these are fixture
measurements, not live performance or a statistical latency benchmark. Startup
parse/interactive latency, large receipt-store reads and real long-running native
operations were not measured. An earlier intermediate source sample missed one
display frame; its repeat returned to normal. Both observations are retained in
local artifacts, but the table above uses the final source measurement only.
No unrelated source optimization was justified. The initial added socket assertion
assumed one attempt; the paired baseline disproved it. The report records actual
intercepted routes (two before and after), not live TCP connection claims.

Optional/lazy JavaScript bytes, raw/gzip, from the final manifest:

| Chunk | Before | After | Loaded before use? |
|---|---:|---:|---|
| ConversationTools | 14,143 / 4,902 | 75,143 / 21,263 | No |
| AuthInspection | — | 2,174 / 1,088 | No |
| NativeAuthentication UI | — | 4,742 / 1,963 | No |
| Native authentication controller | — | 8,298 / 3,187 | No |
| Native standalone command controller | — | 6,284 / 2,623 | No |
| Native deletion controller | — | 4,135 / 1,751 | No |
| AppsPicker | 2,827 / 1,317 | 2,827 / 1,316 | No |
| PromptLibrary | 3,698 / 1,630 | 3,698 / 1,629 | No |
| SkillsMcpHub | 20,300 / 7,286 | 20,302 / 7,287 | No |
| RemoteControlStatus | 4,066 / 1,689 | 4,066 / 1,688 | No |
| ThreadConversation | 74,644 / 21,914 | 74,650 / 21,918 | Yes, existing selected-thread route |
| Syntax highlighting | 165,061 / 54,699 | 165,061 / 54,699 | No |

The shared auth-inspection helper is 1,071 raw / 557 gzip bytes and is not fetched
at startup. Optional fetches are asserted in every paired startup sample. Syntax
highlighting loads when code rendering requires it. Large export retains the
Portable prefix once and includes a 300,000-character command output safely.

Per-feature request/fanout/text bounds and concrete audits are recorded in the
risk assessment. Deletion adds one receipt lookup through the existing application
JSON store to protect Portable prefixes; its cost depends on existing retained
receipts. A large-store lookup was not benchmarked and no storage rewrite was
introduced. Optional panels issue no startup requests, do not poll, and use
the existing single native event owner. Prompt queue notifications mark their
snapshot stale without forcing a thread/history read. Subagent loading stays
one level deep. Mutation pipelines guard connection/project ownership before
each chained request. Internal native errors are conservatively uncertain, never
replayed. No live performance is inferred from fixture timings.

## Browser evidence

All files are local ignored artifacts under
`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`.
The JSON results map suites to assertions and exit status. Each new suite saves
`risk-<ID>[-scope]-<width>-<theme>.png`; reports retain exact paths. Final screenshots
wait 2.2 seconds after interaction. Representative inspected screenshots:

- Native deletion, URL `http://127.0.0.1:4173/#/thread/approved-fixture`, 375×812,
  dark: ID and consequences visible; bordered editable ID field and confirmation;
  no completed state before native evidence. Absolute screenshot path:
  `/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/risk-10-375-dark.png`.
- Worktree creation, same fixture URL, 768×1024, light: explicit remote destination
  and branch inputs, source draft preserved, no automatic prompt submission.
  Absolute screenshot path:
  `/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/risk-13-768-light.png`.

![Native deletion, dark 375×812](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/risk-10-375-dark.png)
![Remote worktree, light 768×1024](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/risk-13-768-light.png)

Native full-access confirmation also passed both themes/all three sizes. Example:
`http://127.0.0.1:4173/#/thread/approved-fixture`, 375×812, dark; wrong typed cwd
keeps execution disabled, permissions and irreversible effects are explicit.
Absolute screenshot:
`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/risk-26-full-375-dark.png`.

![Native full-access confirmation, dark 375×812](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/risk-26-full-375-dark.png)

## Commits and changed files

Implementation and corrective commits (no history rewrites):

```text
198f68e docs: assess risk-first feature scopes and baseline
5ecd8a6 feat: inspect native subagent relationships and metadata on demand
c7b3825 feat: inspect native Hooks definitions origins and trust without execution
9e2aa79 feat: inspect effective configuration layers profiles and restrictions
4ac7636 feat: preview remote external-agent configuration candidates without importing
cdc0f94 feat: inspect observed native thread permissions without extra resumes
1741cd0 feat: inspect exact native auto-review denials without unsafe retries
4d509cc feat: inspect native authentication state and allowed login methods
972cf59 feat: add explicit native prompt queuing while preserving immediate steering
e61cba7 feat: manage native queued prompts with explicit lifecycle safeguards
cb0e236 feat: create and reconcile explicit remote Git worktrees safely
c9d09f1 docs: record retry cwd and Hook mutation contract blockers
4a3468c feat: confirm and reconcile native thread permission changes
8647b24 feat: edit native user and profile model defaults with version checks
c7777cb fix: preserve uncertain native write outcomes and bound operation errors
0cfd373 feat: save scoped native Hook policies with explicit trust review
5172d36 feat: inspect native Daybreak preferences and advertised model programs
3b19d8a fix: support native queue identifiers on HTTP browser origins
8956447 feat: manage explicit native ChatGPT sign-in with account reconciliation
bb01604 docs: record native shell ownership and recovery contract blocker
84f9f50 feat: confirm native conversation deletion and protect imported history
9dd04d1 fix: bound named profile projections across configuration layers
c42dcbc fix: make confirmed mutation inputs visible in both themes
9c50e90 fix: retain deletion preview ownership across lazy loading
82da6ec feat: run bounded native read-only shell commands with exact process ownership
d008967 feat: confirm per-command native full access under managed restrictions
420ef60 fix: gate permanent deletion on all pending standalone commands
```

A final test-harness/report commit follows these; its confirmed hash is included
in the user-facing completion message. Nothing is pushed or merged.

Changed-file manifest (109 files, including this final report):

<details><summary>All task files</summary>

```text
docs/risk-first-completion.md
docs/risk-first-features.md
scripts/approved-fixture.cjs
scripts/measure-conversation-tools.cjs
scripts/test-external-app-server.cjs
scripts/test-risk-auth.cjs
scripts/test-risk-browser-matrix.cjs
scripts/test-risk-config-changes.cjs
scripts/test-risk-config.cjs
scripts/test-risk-daybreak.cjs
scripts/test-risk-deletion.cjs
scripts/test-risk-denials.cjs
scripts/test-risk-hook-policies.cjs
scripts/test-risk-hooks.cjs
scripts/test-risk-import.cjs
scripts/test-risk-native-authentication.cjs
scripts/test-risk-permission-changes.cjs
scripts/test-risk-permissions.cjs
scripts/test-risk-queue-management.cjs
scripts/test-risk-queue.cjs
scripts/test-risk-shell.cjs
scripts/test-risk-subagents.cjs
scripts/test-risk-worktree.cjs
src/App.vue
src/api/authInspection.test.ts
src/api/authInspection.ts
src/api/codexGateway.test.ts
src/api/codexGateway.ts
src/api/codexRpcClient.test.ts
src/api/codexRpcClient.ts
src/api/configInspection.test.ts
src/api/configInspection.ts
src/api/createWorktree.test.ts
src/api/createWorktree.ts
src/api/daybreakStatus.test.ts
src/api/daybreakStatus.ts
src/api/hookPolicy.test.ts
src/api/hookPolicy.ts
src/api/hooksInspection.test.ts
src/api/hooksInspection.ts
src/api/importPreview.test.ts
src/api/importPreview.ts
src/api/nativeAuthentication.ts
src/api/nativeQueue.ts
src/api/nativeShell.ts
src/api/nativeWriteOutcome.test.ts
src/api/nativeWriteOutcome.ts
src/api/subagents.test.ts
src/api/subagents.ts
src/api/threadDeletion.ts
src/api/threadPermissions.ts
src/api/threadSecurity.ts
src/api/userConfigDefaults.test.ts
src/api/userConfigDefaults.ts
src/components/content/ConfigInspection.vue
src/components/content/ConversationTools.vue
src/components/content/CreateWorktree.vue
src/components/content/DaybreakStatus.vue
src/components/content/DeniedActions.vue
src/components/content/HooksInspection.vue
src/components/content/ImportPreview.vue
src/components/content/NativeQueuePanel.vue
src/components/content/NativeShell.vue
src/components/content/PermanentDeletion.vue
src/components/content/PermissionsInspection.vue
src/components/content/SubagentsPanel.vue
src/components/content/ThreadComposer.submission.test.ts
src/components/content/ThreadComposer.vue
src/components/content/composerContracts.ts
src/components/content/composerInput.ts
src/components/sidebar/AccountSettingsPanel.vue
src/components/sidebar/AuthInspection.vue
src/components/sidebar/NativeAuthentication.vue
src/composables/deniedActionObservation.test.ts
src/composables/deniedActionObservation.ts
src/composables/desktopConnection.ts
src/composables/desktopHistory.ts
src/composables/nativeAuthentication.test.ts
src/composables/nativeAuthentication.ts
src/composables/nativeQueue.test.ts
src/composables/nativeQueue.ts
src/composables/nativeShell.test.ts
src/composables/nativeShell.ts
src/composables/threadDeletion.test.ts
src/composables/threadDeletion.ts
src/composables/threadPermissions.test.ts
src/composables/threadPermissions.ts
src/composables/threadSecurityObservation.test.ts
src/composables/threadSecurityObservation.ts
src/composables/useDesktopState.messages.test.ts
src/composables/useDesktopState.ts
src/server/appServerClient.test.ts
src/server/appServerClient.ts
src/server/codexAppServerBridge.ts
src/server/conversationTransfer.test.ts
src/server/conversationTransfer.ts
src/server/subscriptionRecovery.test.ts
src/server/subscriptionRecovery.ts
src/style.css
src/utils/clientMessageId.test.ts
src/utils/clientMessageId.ts
tests/chat-composer-rendering/index.md
tests/chat-composer-rendering/native-prompt-queue.md
tests/chat-composer-rendering/native-shell.md
tests/git-worktrees-rollback/index.md
tests/git-worktrees-rollback/native-worktree-creation.md
tests/thread-loading-state/index.md
tests/thread-loading-state/native-permanent-deletion.md
tests/thread-loading-state/risk-first-observation.md
```

</details>

Final branch: **main**. The initial working tree was clean and every file above
belongs to this task. Commits are local only. The final report commit is followed
by a clean-tree check; no merge/rebase/cherry-pick is in progress. Verification
server 4173 is left running from this checkout in the separate
`codex-risk-4173` tmux session after its former foreground verification session
expired. The existing 5173 tmux service was never stopped or restarted.

Remaining external prerequisites are the native contracts/designated test data
listed per feature. Partial milestones are not represented as full lifecycle
completion. No real-user login, deletion, permission/configuration change, worktree,
process termination or paid turn was performed for acceptance.
