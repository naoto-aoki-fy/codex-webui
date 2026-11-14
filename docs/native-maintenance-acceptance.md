# Native cleanup acceptance audit

Audit baseline (the proposed cleanup): `8565c81`.
Original pre-cleanup baseline: `3f659043adef2fb075919dec669e88e843fe4889`.
The final audit commit is reported in the completion message; use `HEAD` below
when reviewing this committed report. No branches were created/switched and no
production state, credentials, remote server configuration or deployment changed.

## 1. Independent upgrade safety

`nativeUpgradeAcceptance.test.ts` executes each row separately against a fresh
local home, the actual read-only Project/pin services and native RPC fixtures.
All six assert byte-identical stored state and no migration/mutation RPCs.

| Stored state | Project workflows | Pin workflows |
| --- | --- | --- |
| No legacy data | Allowed; no receipt required | Native pins allowed |
| Unmigrated Projects | Loading/registration/mutations rejected | Native pins allowed if no legacy pins |
| Interrupted Project migration | Same rejection | Independently checked |
| Completed Project migration | Native operations allowed | Native pins allowed |
| Completed Projects, legacy pins remain | Native operations allowed | Rejected with migration instruction |
| Legacy pins, no legacy Projects | Native operations allowed | Rejected with migration instruction |

**Found and fixed:** at `8565c81` the pin reader ignored legacy data, and the
browser gateway converted errors to successful empty lists. A Project completion
flag could therefore coexist with silently ignored pins. `c0c69b0` adds an
independent pin guard. Gateway errors now reach a visible sidebar warning; a
failed refresh preserves previously loaded pins and blocks UI pin changes until
recovery. No migration is run and no legacy key or native section is changed.

`projectHistory.test.ts` also invokes the HTTP adapter with both guards failing:
Project/pin endpoints return explicit 502 errors; native `thread/list` and direct
metadata `thread/read` still succeed, with the same state-file bytes afterwards.
The guards do not gate direct conversation navigation/history, Portable Fork,
revert or unrelated native RPCs. A failed Project load may temporarily lack native
Project labels, but thread visibility is not filtered by those legacy roots.

Use the exact [migration source, environment, identity formula and observable
completion checks](native-project-migration.md#reproducible-migration-source-and-environment).
The old source is `3f659043adef2fb075919dec669e88e843fe4889`; Project completion
and removal of the old pin key must be verified separately. The old revision's
Project and pin migration suites were rerun from a new `/tmp` source archive:
**12 tests passed**, including interrupted migration retries and state preservation.
These are fixture checks of that revision, not a live migration.

## 2. Fast request semantics

Target-schema evidence was regenerated locally using the pinned executable:

```sh
pnpm exec codex --version # codex-cli 0.167.2
pnpm exec codex app-server generate-json-schema --out /tmp/native-acceptance-schema
```

The generated `v2/TurnStartParams.json` describes `serviceTierForTurn` as an
override only when starting a new turn: use `default` for standard speed;
**omitted or null inherits the thread tier**. It does not modify the saved thread
tier or a turn already being steered. Explicit `fast` requests Fast for that new
turn; explicit `default` prevents inheriting saved Fast. Persistent `serviceTier`
is a separate field for this and subsequent turns. The WebUI never supplies that
field in `turn/start`. Its nullable field description does not establish a clear
reset contract, so the implementation does not rely on `serviceTier: null`.

The existing speed-toggle action intentionally changes Codex config, and is not a
browser-only preference. Enabling serializes:

```json
{"method":"config/batchWrite","params":{"edits":[{"keyPath":"features.fast_mode","value":true,"mergeStrategy":"upsert"},{"keyPath":"service_tier","value":"fast","mergeStrategy":"upsert"}],"filePath":null,"expectedVersion":null}}
```

Disabling serializes the same feature edit, followed by
`{"keyPath":"service_tier","value":null,"mergeStrategy":"replace"}`.
This resets that config selection through the existing native config API. These
writes occur on a user's explicit mode toggle, not on model switching, thread
restoration, catalog refresh, or submission. They intentionally affect the
server's configured default; they are not advertised as per-thread persistence.
Unrelated configuration fields are not sent. No config writes were introduced by
this audit.

Actual serialized `fetch` bodies (parsed from `RequestInit.body` and asserted
with full equality in `codexGateway.test.ts`) for enable then disable:

```json
{"method":"turn/start","params":{"threadId":"existing","input":[{"type":"text","text":"enabled"}],"model":"chosen","serviceTierForTurn":"fast"}}
{"method":"turn/start","params":{"threadId":"existing","input":[{"type":"text","text":"disabled"}],"model":"chosen","serviceTierForTurn":"default"}}
```

| Case | Coverage and serialized outcome |
| --- | --- |
| Fast enabled | Exact config and `turn/start` frames above; provider/model metadata advertises `fast` |
| Disabled after enabled | Exact `default` frame above; no persistent thread override |
| Supported → unsupported | Same model ID under another provider with `serviceTiers: []`; Fast rejects before RPC, selected mode is not silently changed |
| Missing metadata | Fast rejects before RPC; UI says unknown, not inferred from model name; Standard sends explicit `default` |
| Restore existing Fast thread | State test supplies resumed `serviceTier: fast`, configured Fast, and uses the real gateway serializer: frame below uses `fast` |
| Restore saved Fast thread with configured Standard | Same state test sends `default`, overriding inherited Fast for the new turn, while leaving the stored thread tier alone |

Restoration fixture's actual serialized frame:

```json
{"method":"turn/start","params":{"threadId":"thread-1","input":[{"type":"text","text":"restored Fast marker"}],"model":"gpt-5.5","serviceTierForTurn":"fast","collaborationMode":{"mode":"default","settings":{"model":"gpt-5.5","reasoning_effort":null,"developer_instructions":null}}}}
```

The fixture's thread ID comes from the state suite's shared `thread` fixture;
see the test for its exact value. For Standard the only tier-field difference is
`serviceTierForTurn: default`. The current selected mode is initialized from
native config, not reconstructed as a separate saved per-thread preference.
A saved thread tier alone is not treated as permission to enable Fast silently.
Capability resolution uses the selected provider/model key; another provider's
entry never authorizes Fast. Supported/unsupported/unknown switching is tested in
the real compiled composer SFC as well as the pure capability resolver.

## 3. History boundary

**Found and fixed:** the HTTP adapter still had an internal full-read slicing
branch if an injected client omitted `readThreadPage`. The production client
already supplies it, but the remaining branch weakened the boundary.
`82893fc` removes it and tests a clear compatibility error with zero fallback RPCs.

Native pager implementation, absolute indices, cursor seek, limits, coalescing,
TTL, disconnect/invalidation guards and fork cutoffs were not changed in this
audit. Adapter tests now use native pagination fixture replies and the real pager
instead of relying on the removed branch. Metadata index sharing and notification
invalidation are asserted through `AppServerClient.readThreadPage`.
The unused full-history page cache has since been removed. Recovery snapshots
remain separate from native index invalidation; pagination uses only the native pager.

- `remoteHistoryPager.test.ts`: recent/older absolute positions, exact order,
  concurrent pages, reconnect, invalidation, malformed envelopes/repeated cursors,
  and -32601 upgrade rejection with no full-read fallback. Permission/disconnect/
  timeout errors preserve their original messages.
- `threadLiveStateRetirement.test.ts` and `threadFileChangeRetirement.test.ts`:
  unchanged item/error/media assertions, native earlier pages and fork cutoffs.
- `conversationTransfer.test.ts`: full `thread/read(includeTurns: true)` remains
  required for Portable Fork, including imported prefixes and incomplete receipts.
- `useDesktopState.test.ts`: `executeThreadRevert`, old absolute-index targets,
  fork-and-revert stages, restoration and history invalidation remain covered.
- `appServerClient.test.ts`: recovery snapshot invalidation on revert and active
  runtime replacement remain covered. Native cache/race coverage remains in
  `remoteHistoryPager.test.ts` and `remoteTransfers.benchmark.test.ts`.

## 4. Deleted-test audit

The [removed test-declaration diff](fixtures/native-cleanup-removed-test-lines.txt)
is mechanically extracted from `git diff -U0 3f65904..8565c81 -- '*.test.ts'`.
It includes rewritten declarations as well as deleted cases; it is not a count of
lost behaviors. The following maps the groups to active replacement protection.

| Original tests removed/replaced | Reason | Active replacement |
| --- | --- | --- |
| `useDesktopState.test.ts`: eight root/name/worktree inference cases and one path-based removal helper case | Native membership is by explicit ID; cwd inference and path-based writes retired | `nativeProjectGroups`, independent upgrade matrix, native deletion/history visibility test |
| `desktopProjectGroups.test.ts`: nine compatibility exports, legacy placeholders/disambiguation/reference-identity cases | Legacy grouping implementation/exports retired | No-inference test plus native duplicate names/roots, empty projects, ordering, unassigned history and clone isolation tests |
| `nativeProjects.test.ts`: eight declarations (nine expanded cases) for migration/import retry/adoption/conflicts/hidden imports and legacy read-only fallback | Runtime migrator/fallback retired; only pre-upgrade release migrates | Read-only incomplete/completed guard tests, byte-preservation matrix, native operations, imported receipt preservation; old revision's migration suite rerun separately |
| `threadPresentationStore.test.ts`: three migration cases rewritten/removed | Runtime pin migration retired | Native listing/reload/error tests plus independent remaining-pin rejection, browser warning and recovery |
| `remoteHistoryPager.test.ts`: one fallback/reconnect case rewritten | Missing native API intentionally ends support | Upgrade error before and after reconnect, zero full reads; native page/race/error tests retained |
| `workspaceRootsStore.test.ts`: four public-export/realpath/canonicalizer cases | Unused host canonicalization removed | HTTP remote cwd preservation for POSIX/Windows/UNC in archive tests; parsing/malformed-state/no-write safeguards retained |
| `codexAppServerBridge.archive.test.ts`: three realpath callback/caching cases | Obsolete callback interface removed | Three remote-path pass-through cases; archive/rate-limit recovery retained |
| `useDesktopState.test.ts`: two missing-local-CLI banner cases; messages suite: one stale CLI banner case | Local CLI startup retired | External connection error test; catalog lifecycle/race tests retain their substantive assertions with external errors |
| Revert wrapper assertions | Wrapper removed, behavior supported | Same assertions call `executeThreadRevert`; stage/failure/prompt-restoration cases retained |
| Search test declaration rewritten | More fixture variants, not deleted coverage | Native fuzzy ordering/non-substring matches, empty/malformed/unsupported results; original remote-only/no-local-command check retained |

No route-retirement, credential-redaction, pending-work/no-replay, service-worker
retirement, Portable Fork, metadata-recovery or absolute-index suites were deleted.
This audit adds tests; it does not remove any test declarations.

## 5. Validation layers and performance

| Layer | Executed evidence | Limit |
| --- | --- | --- |
| Code review | Guard call paths, actual serializer and locally generated 0.167.2 schema; native/full-read separation | Not server execution |
| Automated fixtures | Six independent upgrade cases; HTTP access after guard rejection; exact Fast frames; native pagination/cache/media/errors; transfer/revert regressions | Synthetic RPCs, disposable local state |
| Pre-cleanup source fixtures | 12 Project/pin migrator tests at exact commit `3f65904` in fresh source archive | Does not migrate a deployed home |
| Browser | Actual sidebar warning, accessible native thread/composer, Fast control, no warning overflow in both themes | Synthetic HTTP/WebSocket responses |
| Live Codex | **Unverified in this audit** | No currently authorized isolated server/profile was established; historical evidence or a shared listener was not reused as authorization |

Browser Use is unavailable, and response interception is needed here, so the
committed CJS Playwright script was used. Target:
`http://127.0.0.1:4173/#/thread/cleanup-fixture`, viewport 1280x900.
The existing 4173 server serves the current checkout's updated component module;
no unknown listener or persistent 5173 server was stopped. Screenshots:
`output/playwright/acceptance-upgrade-light.png` and
`output/playwright/acceptance-upgrade-dark.png`. A full commit ID initially
extended past the warning width; shared CSS now wraps it and the browser asserts
`scrollWidth <= clientWidth` before capturing each theme.

Commands/results:

```sh
# Independent upgrade/gateway/sidebar + adapter/media/native cache + restore cases:
pnpm exec vitest run src/server/nativeUpgradeAcceptance.test.ts src/server/threadPresentationStore.test.ts src/components/sidebar/SidebarThreadTree.test.ts src/api/codexGateway.test.ts src/server/projectHistory.test.ts src/server/threadLiveStateRetirement.test.ts src/server/threadFileChangeRetirement.test.ts src/composables/useDesktopState.messages.test.ts
# 8 files / 321 tests passed

pnpm exec vitest run src/server/remoteHistoryPager.test.ts src/server/conversationTransfer.test.ts src/server/appServerClient.test.ts src/composables/useDesktopState.test.ts src/api/modelCapabilities.test.ts src/components/content/ThreadComposer.submission.test.ts
# Retained pagination/Portable/revert/capability coverage passed

pnpm run typecheck
# Frontend and server passed
pnpm run test:unit
# 95 files / 1,277 tests passed, 2 opt-in live tests skipped
pnpm run build
# Frontend + public ESM CLI build passed

fixture_home=$(mktemp -d /tmp/native-acceptance-fixture.XXXXXX)
CODEX_HOME="$fixture_home" CODEXUI_CONNECTION_PROFILE=acceptance-fixture pnpm run test:integration:fixture
CODEX_HOME="$fixture_home" CODEXUI_CONNECTION_PROFILE=acceptance-fixture CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture
# Both credential-free TCP and Unix fixtures passed

node -e "const {execFileSync}=require('node:child_process');const h=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!h.includes('--port'))throw Error('Missing --port');console.log('CLI help smoke passed')"
# CLI help smoke passed; CJS harness exercises the public ESM executable
PLAYWRIGHT_BROWSERS_PATH=/tmp/cleanup-playwright node scripts/test-native-upgrade-browser.cjs
# Both theme assertions/screenshots passed
```

The baseline full suite was green. Audit-introduced fixture mismatches were fixed
before committing: adapter tests had injected the removed full-read-only client,
and Project/pin endpoint assertions initially expected 500 instead of the existing
502 mapping. Native assertions were retained at their supported entry points.
No failing assertions were removed to pass this audit.

Performance code-path audit: pin refresh adds one asynchronous profile-state read
per existing pin refresh, not per thread/message. It adds no migration writes,
section moves, duplicate list requests, new cache or unbounded fanout. Rejected
pin fixtures assert zero native pin RPCs. Successful refresh still lists native
section pages once. The HTTP adapter now performs zero full-read calls when its
required pager is missing. Native pager request coalescing/invalidation is
unchanged and measured by fixture call counts. No live latency/browser profiler
measurement was performed.

Review commands (resolve `HEAD` to the completion-report commit):

```sh
git diff --stat 8565c81..HEAD       # acceptance follow-ups only
git diff --stat 3f65904..HEAD       # entire focused cleanup + acceptance
git diff 8565c81..HEAD -- src/server/threadPresentationStore.ts src/api/codexGateway.ts src/components/sidebar/SidebarThreadTree.vue
git diff 3f65904..HEAD -- src/server/nativeProjects.ts src/api/modelCapabilities.ts
# Fast capability/submission + restoration hunks, with the rest of the narrow client cleanup visible:
git diff 3f65904..HEAD -- src/api/codexGateway.ts src/composables/useDesktopState.ts src/components/content/ThreadComposer.vue
```
