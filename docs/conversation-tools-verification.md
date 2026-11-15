# Focused conversation-tools acceptance verification

## Revisions, boundaries and result

The starting branch was `main`, HEAD was verified as `8c64343`, and the working
tree was clean. Git establishes `997d9a2` as the pre-feature revision: it is the
immediate parent of `9eed459`, the first feature commit. The actual source diff
`997d9a2..8c64343` was reviewed, including the shared state/transport integration,
not just the implementation report. Two defects were reproduced and corrected:

- `8e8ae8b` — **fix: preserve refreshed native metadata after archive restore**.
  The second unconditional merge of the older unarchive response replaced newer
  list metadata, including its native read receipt. A new test failed with the
  old title/read state. Reconciliation now only reinserts a restored row if the
  refreshed page omitted it; otherwise the newer native row wins.
- `184e18e` — **fix: fence large command output without argument overflow**.
  A valid 300,000-character command output with 150,000 backtick runs caused
  `Math.max(...runs)` to throw `RangeError: Maximum call stack size exceeded`.
  The reproducing test failed before correction. A single loop finds the fence
  length without spreading an unbounded argument array. No worker/dependency added.

Both failing tests passed after the corrections (69 tests in their two suites).
`973217f` adds the reproducible measurement harness only. The compared final
application source is `184e18e`; later harness/documentation commits do not alter
that application source. Work stayed on `main`; no push, merge, rebase, branch
switch, Codex installation/startup, authentication change or paid turn occurred.
The persistent server on 5173 was not modified or restarted. The existing
verification backend on 4173 remains running.

Features 09, 11, 24 and 32 remain implemented, with fixture acceptance complete.
Live acceptance is explicitly limited below. Feature 22 remains a **scoped
implementation blocker**, not proof that web-search overrides are impossible.
No global configuration writes, new search controls or additional features were added.

## Actual diff review

| Area | Review result |
| --- | --- |
| Generic RPC errors | The generic bridge catch still returns HTTP 502 with exactly `{error: message}`. Only `account/usage/read` adds numeric `rpcCode` evidence. Built/dev integration assertions verify both shapes. Browser extraction does not infer unsupported from a permission/network error. |
| Archive restore | Mutation is acknowledged and identity checked before reconciliation. History/subscription caches are invalidated using existing owners. Native `projectId` determines grouping. Rejected/stale restores do not become acknowledged active rows. The corrected merge preserves fresher title/read receipts; an older restored row outside the first active page is still inserted. No archive index/pin/read-receipt mutation added. |
| Export | Uses normal detail and serial older-page APIs; no rollout scanning/reconstruction. Stable imported IDs are deduplicated before native history. Cursor/boundary and size/page guards fail without saving a partial file. The initially active turn is excluded, with an explicit note. Epoch checks before/after page awaits cancel stale connection/profile jobs without downloading or requesting subsequent pages. Large command fencing is corrected. |
| Metadata / CAP-003 | Export passes normalized historical metadata through `readGenerationMetadata`; no composer model/effort is passed into export. Missing evidence remains missing, explicit `none`/unspecified remain distinct, timestamp rules stay in the unchanged normalizer. Submitted-setting provenance stays labeled separately from execution evidence. |
| Usage | Null response, missing metric/history, empty buckets, explicit unsupported and ordinary errors remain separate. Zero is preserved only when actually returned. Only the five allowlisted summaries and native daily token buckets are displayed; no local aggregation, costs or polling. |
| Diagnostics | Latest 20 warnings, each at most 600 characters; redaction processes at most 6,000 characters per event. Capture uses the existing desktop event owner, not another subscription. Copy reports project fixed fields/enums and warning timestamps only, excluding all free-form warning/error text, URLs, paths, profiles, auth/config/environment/log/content fields. Readiness/disconnect/reconnect invalidate view state. No feedback transmission added. |
| Existing flows | Send/start/steer/interrupt/approval implementations, native read-receipt APIs, pin/section subscriptions, normal history pager, transfer persistence and fork/revert orchestration are unchanged. New epoch invalidation affects these new read jobs/warning state only; existing reconnect recovery still owns subscription/history recovery. |

Protected capability checks:

- **CAP-001:** fork/revert orchestration, historical cutoffs, original preservation,
  editable draft staging and explicit submission paths are unchanged. Existing
  desktop orchestration/failure-stage regressions passed; no live fork/generation
  was attempted in this pass.
- **CAP-002:** transfer creation/injection/persisted transcript decoration is unchanged.
  Existing transfer/import-prefix tests passed. The export tests and large browser
  fixture verify the repeated imported prefix occurs once and precedes native turns.
  Live imported-history acceptance requires designated data on this profile.
- **CAP-003:** normalizer, older-page, execution/submitted provenance, rollout-cache
  and desktop metadata regressions passed. Export never substitutes current settings.
  No live historical response was generated or borrowed from a real user thread.

## Live acceptance — existing server only

The configured verification backend connected to the existing default App Server
at `ws://127.0.0.1:4500` with its existing ChatGPT authentication. A separate
read-only initialization handshake reported:

```text
codex-web-local/0.169.0 (Rocky Linux 9.8.0; x86_64) screen (codex_webui_readonly_acceptance; 1.0)
```

This is runtime evidence, not the bundled 0.167.2 development package/schema.
The UI/report intentionally still say runtime version unavailable because their
current endpoint does not expose this handshake agent string.

| Feature | Live result | Evidence / remaining prerequisite |
| --- | --- | --- |
| 09 | **PASS** native archived listing, acknowledged restore and native metadata persistence; **FAIL** empty-thread active-list visibility after refresh; **NOT RUN** normal-history acceptance | Disposable empty conversations/projects only. ID, name, project ID, creation time and provider were equal before/after restore and reread; restored ID left the archived list. The UI inserted the acknowledged thread, but after refresh it was absent. An independent native active-list scan covered all 6 pages and also omitted the empty thread. No client-owned index or paid turn was introduced to conceal this native discoverability limit. Needs a designated nonempty persisted test conversation for complete live acceptance, including historical metadata. |
| 11 | **NOT RUN** multi-page/Portable Fork live export | Targeted native searches for known `maintenance-` and `portable-discovery-` test names did not identify suitable safe history. Needs a designated conversation with >10 completed native turns and, for Portable Fork acceptance, a persisted imported prefix on the same WebUI profile. No real user conversation content was exported and no paid turn was generated. |
| 24 | **PASS** actual response compatibility / browser rendering | Real `account/usage/read` returned all five integer summary fields, daily buckets with `YYYY-MM-DD` dates, and an additional `threadUsage` field that this account-wide UI ignores. Browser labels matched tokens, tokens/day, seconds and days. No timezone/cost inferred. Live fields were populated; absent/null/empty/unsupported/error cases remain fixture coverage. |
| 32 | **PASS** observed connection/capability state, preview/copy, reconnect invalidation | Real read-only `/tmp` directory browsing established positive `fs/getMetadata` and `fs/readDirectory` evidence. UI/report showed initialized Linux connection, supported observed APIs and unknown unobserved APIs. Preview equaled allowlisted clipboard JSON. Reconnecting only the verification WebUI's upstream connection cleared the old report and positive evidence to unknown; explicit refresh worked. No live warning was induced; warning bounds and adversarial secret redaction remain fixture-tested. |

The live browser used real API responses; only unrelated sidebar project/thread/pin
rows were filtered for screenshot privacy. Account/diagnostic values were not
stubbed. Early archive browser attempts needed an explicit list refresh and then exposed
the empty-thread limitation; one test-harness route teardown required cleanup. The
independent API probe and final read-only browser run provide the final evidence.
Disposable projects were deleted; final native listing showed three retained
archived verification conversations and no active verification rows, and the
remaining verification-project count was zero. No permanent thread deletion or
real-user conversation mutation occurred.

Live artifacts under `output/playwright/final-verification/`:

- `runtime-evidence.json`: initialization projection (no home/credentials).
- `live-probe.json`: usage field/type evidence, not raw account totals.
- `test-history-discovery.json`: targeted designated-history discovery.
- `live-archive-probe.json`: native restore, metadata, complete active scan and cleanup.
- `live-readonly.json`: actual usage labels, capability evidence, report copy and
  reconnect assertions; zero browser page errors.
- `live-diagnostics-light.png`, `live-diagnostics-dark.png`: actual diagnostics
  report at `http://127.0.0.1:4173/#/`, viewport 1280×900, both themes. Preview/copy
  and supported/unknown evidence assertions passed.

![Live diagnostic preview, light](../output/playwright/final-verification/live-diagnostics-light.png)
![Live diagnostic preview, dark](../output/playwright/final-verification/live-diagnostics-dark.png)

## Comparable fixture performance baseline

Both revisions used **the same installed node_modules tree**, with no installation
or version change: Node v22.23.2, pnpm 10.34.9, Vite 6.4.5. `package.json`,
`pnpm-lock.yaml`, `vite.config.ts` and `tsup.config.ts` have no diff between the
compared revisions. The baseline was extracted with `git archive`, not checked
out on another branch. Both ran `pnpm run build` with the same default production
settings. Sizes below are exact bytes; gzip uses Node zlib's same default level 6
for both, also matching the rounded build output.

| JavaScript artifact | Before raw / gzip | After raw / gzip | Delta raw / gzip |
| --- | ---: | ---: | ---: |
| Main entry | 403,498 / 128,568 | 419,631 / 134,127 | +16,133 / +5,559 (+4.00% / +4.32%) |
| Lazy ThreadConversation | 73,946 / 21,740 | 73,946 / 21,740 | 0 / 0 |
| Lazy SkillsMcpHub | 11,637 / 4,313 | 11,637 / 4,314 | 0 / +1 (changed import hash reference) |
| Shared lazy highlighting chunk | 165,061 / 54,699 | 165,061 / 54,699 | 0 / 0 |

No additional lazy JS chunks were introduced. The new feature code is in the main
entry. The extracted baseline's dependency manifest key has a different absolute
path because node_modules is shared; the highlighting artifact is byte-identical.

Startup comparison used the same 1280×900 production-build browser fixture,
fresh context/storage each run, all HTTP RPC responses intercepted identically,
and a mocked browser WS that opens without notifications. The selected fixture
thread and content had to render before measurement; this was not an error page
or zero-traffic boot. Each run observed a further 7 seconds of idle startup.

| Startup fixture metric | Before (3 runs) | After (3 runs) | Delta |
| --- | ---: | ---: | ---: |
| API requests per run | 14 / 14 / 14 | 14 / 14 / 14 | 0 |
| Combined API JSON bytes per run | 1,606 / 1,606 / 1,606 | 1,606 / 1,606 / 1,606 | 0 |
| Eager archive / usage / older-history calls | 0 / 0 / 0 | 0 / 0 / 0 | 0 |

All 14 endpoint/method keys occurred once per run, including one `thread/list`,
one `thread/resume`, one account/rate-limit read and one model catalog read.
No extra startup request, duplicate refresh, polling loop or new event subscription
was found. This is a controlled fixture comparison, **not production traffic or
live latency**, and is separate from the earlier 46-response / 9.65 KiB exercise.

The final large-history browser fixture exported **2,000 completed native turns,
4,003 messages** (including two imported messages once and one command result).
It contained Markdown/code and the 300,000-character backtick-heavy command output
that reproduced the corrected failure. One initial detail read and **199 serial
older-page reads** returned approximately **4.96 MB** of fixture JSON. The download
contained **4,539,118 bytes** (about 4.54 MB) of Markdown. Two complete measurement
runs took about **745 ms and 753 ms** from click preparation to download, including
Playwright coordination (a 100 ms post-download observation grace was excluded).
All 2,000 prompt/answer markers were present in order; the imported prefix appeared
once; command output was preserved. No page errors or >50 ms browser long tasks
were observed; maximum animation-frame gap was **16.8 ms**. Other interactions and
peak heap were not measured. This size does not establish behavior at the export
safety ceiling or on a slow remote connection. No broader optimization is justified
by this measurement.

`performance-comparison.json` contains exact bundle/startup/timing results and
`large-export-complete.png` shows the actual export menu after the successful
download at
`http://127.0.0.1:4173/#/thread/tools-fixture`, viewport 1280×900.

## Commands and automated/browser results

Repository inspection/review:

```sh
git status --short
git branch --show-current
git log --oneline -16
git show -s --format='%H %P %s' 9eed459 997d9a2 HEAD
git diff 997d9a2..8c64343 -- src
git diff 997d9a2..HEAD -- package.json pnpm-lock.yaml vite.config.ts tsup.config.ts
```

Focused regressions (including CAP-001/002/003 and generic RPC contracts):

```sh
pnpm exec vitest run src/api/codexRpcClient.test.ts src/server/codexAppServerBridge.archive.test.ts src/composables/archivedThreads.test.ts src/composables/conversationExport.test.ts src/composables/accountUsage.test.ts src/diagnostics.test.ts src/composables/useDesktopState.test.ts src/server/conversationTransfer.test.ts src/api/normalizers/v2.test.ts src/server/threadLiveStateRetirement.test.ts src/server/rolloutGenerationMetadata.test.ts src/server/turnGenerationMetadata.test.ts src/turnGenerationMetadata.test.ts
```

Result: **13 files / 182 tests passed**. Full validation:

```sh
pnpm run typecheck
pnpm run test:unit
pnpm run build
pnpm run test:integration:fixture
node dist-cli/index.js --help
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-conversation-tools.cjs
```

All passed: **1,355 unit tests passed, 2 skipped** (105 files passed, 2 skipped).
Built/dev integration verified unchanged generic errors, scoped unsupported usage,
auth redaction, one fixture upstream connection per entry point and fixture listener
survival. This fixture is not a real Codex server. Built ESM CLI help exited 0.
The browser matrix passed 1280×900, 375×812 and 768×1024, light/dark, actual changed
archive/export/usage/diagnostic UI, native-style failure cases, restore refresh,
Markdown downloads, report clipboard assertions and no external requests.

Reproducible production baseline/measurement:

```sh
task_baseline_dir=$(mktemp -d /tmp/codex-tools-before.XXXXXX)
git archive 997d9a2 | tar -x -C "$task_baseline_dir"
ln -s "$PWD/node_modules" "$task_baseline_dir/node_modules"
(cd "$task_baseline_dir" && pnpm run build)
pnpm run build
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/measure-conversation-tools.cjs "$task_baseline_dir" "$PWD"
```

Live scripts were saved with the local evidence (ignored generated artifacts):

```sh
node output/playwright/final-verification/runtime-probe.mjs
node output/playwright/final-verification/live-archive-probe.cjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node output/playwright/final-verification/live-readonly.cjs
```

They use the existing authenticated server and only their own disposable data or
read-only APIs. Do not rerun mutation probes against unverified server identities.
No new server/authentication lifecycle is part of these features or this report.
