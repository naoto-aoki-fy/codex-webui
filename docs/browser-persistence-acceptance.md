# Focused browser persistence acceptance

This report is historical. The prompt library and its tests have since been removed. Existing browser records are left in place. See [current browser persistence](browser-persistence.md).

This review confirms the final [IndexedDB-record architecture](browser-persistence.md)
and adds failure-boundary evidence. It does not migrate storage again, add replay,
delete drafts, or change queue protocol/reconciliation semantics.

## Findings and focused fixes

- Queue and record transaction code required **no change**. In
  [`updateBrowserRecord`](../src/utils/browserTransactionalRecords.ts), `get` and
  `put` share a readwrite transaction and the returned promise resolves only in
  `tx.oncomplete`, never in request success. `nativeQueue.add` awaits the
  reservation before `thread/queue/add`. Abort/error rejects before send.
- Receipt settlement already compares the expected client ID. Mismatched RPC
  acknowledgment, lost response or failed clear retains uncertainty and the
  durable guard. No retry/replay is scheduled.
- Prompt mutations already read the current record and apply their specific delta
  inside that same transaction: changed preset IDs/deletions, append/deduplicate,
  or clear history. They never replace the record with the stale UI snapshot.
- Fixed one editor edge case: when a remote deletion had refreshed the preset
  list, Save previously mapped an absent ID, silently did nothing, then cleared
  the entered text. It now explicitly upserts that edited preset. The change is
  confined to `PromptLibrary.vue`; all other presets still come from the current
  transactional record.
- Fixed one visibility gap: a failed initial draft read returned an empty result
  without a warning. It now surfaces a warning in `ThreadComposer.vue` that stays
  until a draft read succeeds. A later successful save alone does not dismiss it.
  Recoverable records are not removed. Existing save-quota/archive-failure behavior
  already preserves the live draft and refuses destructive replacement.

## Historical conflict and upgrade policy

Different preset IDs are merged independently. For the **same** preset, the last
committed operation wins: edit after deletion recreates the edited ID; deletion
committed last removes it. This applies to explicit saves, not automatic replay.
History clearing removes recordings committed before the clear; a recording
committed afterward remains. Both operations retain current presets. History
recording still requires opt-in and filters credential-like text.

**Mixed old/new-version tabs are unsupported.** They have no common transactional
write protocol. Follow the [safe upgrade procedure](browser-persistence.md#safe-upgrade-mixed-versions-are-unsupported):
pause submissions, preserve every tab's live draft and unresolved identities from
all applicable stores/profiles, reload every existing tab into the new build, then
verify recovery before resuming. If versions already overlapped, preserve and
inspect the union of legacy and IndexedDB identities; do not assume newer code
imported later legacy writes. The current client uses IndexedDB receipts only.
Never clear browser storage as recovery or to unlock
submission. An absent native queue row does not prove non-execution.

## Exact tests and commands

Start the current checkout's verification server if needed:

```sh
CODEXUI_CONNECTION_PROFILE=browser-fixture pnpm run dev --host 127.0.0.1 --port 4173
```

The commands below use the Chromium installation available in this environment.
`PLAYWRIGHT_BROWSERS_PATH` only locates that installation; it is not app data.

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-persistence-browsers node scripts/test-persistence-acceptance.cjs
PERSISTENCE_SCREENSHOTS=0 PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-persistence-browsers node scripts/test-browser-persistence.cjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-persistence-browsers node scripts/test-risk-queue.cjs
```

`PERSISTENCE_SCREENSHOTS=0` suppresses only the repeated screenshot matrix; all
functional cases execute and the focused light/dark screenshots are still saved.
All passed. Exact case names and implementation coverage:

| Test name / case label | What was verified |
| --- | --- |
| `queue/commit` | Native request success → reservation transaction complete → RPC → clear transaction complete; one RPC |
| `queue/abort-after-success` | Abort real transaction from reservation request-success listener; zero RPCs, previous committed record unchanged |
| `queue/quota` | Inject synchronous `QuotaExceededError` at `put`; transaction aborts; zero RPCs and no partial reservation |
| `queue/request-error` | Use `add` against the existing primary key to cause a real IndexedDB `ConstraintError`; transaction aborts; zero RPCs |
| `queue/wrong-client` | Hold RPC pending, reject duplicate send, return a different client ID; retain original reservation/uncertainty across reconnect and owner recreation; one RPC total |
| `queue/clear-failure` | After accepted RPC, abort clear transaction after its request succeeds; original marker remains, reconnect/recreated owner refuses replay; one RPC total |
| `queue reservation waits for transaction commit; abort, quota, request error, delayed wrong client and clear failure preserve boundaries` | Aggregate of the six cases above, using production controller/helper/receipt code |
| `prompt operations use current transactional records; delete/edit and history clear/record follow transaction order` | Real concurrent edits to existing distinct presets from stale snapshots; deletion/edit in both orders and concurrently; same-ID edits in serialized order and a deletion race; clear/record in both orders and concurrently; unrelated preset survives |
| `real-tab navigation, drafts, duplicate identity, structured reload, receipts, presets and storage events (IndexedDB transactions; Web Locks available)` | Existing actual-page test retained, including copied sessionStorage representing Duplicate Tab; divergent edits and reload restore each tab's own text, not the other tab's |
| `real-tab navigation, drafts, duplicate identity, structured reload, receipts, presets and storage events (IndexedDB transactions; Web Locks disabled)` | Same assertions with Web Locks removed; record transactions remain the authority |
| `draft read, quota and recovery failures stay visible without deleting saved data` | Actual composer shows quota/archive refusal and initial read-denial warnings; live text and every pre-existing draft snapshot remain; recovery refuses replacement when backup fails |
| `saving an editor after remote deletion preserves the edit and survives reload` | Actual UI storage-event refresh deletes the list row while editing; explicit Save recreates only that preset and persists the entered text after reload |
| `PASS 07 explicit queue vs steering, native persistence after refresh, acknowledgment, duplicate and uncertain writes; six views` | Existing lost-response UI fixture rerun, delayed/double-click behavior, retained draft and reload guard, no replay |

The duplicate-tab test copies inherited sessionStorage into a new document; it
does not automate the browser's native Duplicate Tab menu. Each document then
writes and reloads independently using real browser storage.

The queue quota failure is fault injection, not deliberate exhaustion of disk.
Request-error and transaction-abort cases exercise real IndexedDB failure events.
Queue/list/history/HTTP/WebSocket responses are fixtures; no live turn is sent.

Existing focused unit tests, with their existing names, also passed:

```sh
pnpm exec vitest run src/composables/nativeQueue.test.ts src/utils/queueSubmissionReceipts.test.ts src/utils/promptLibrary.test.ts src/utils/composerDraftStorage.test.ts src/utils/browserPersistence.multitab.test.ts src/components/content/ThreadComposer.submission.test.ts
```

**42 tests passed across 6 files.** Relevant existing names include:

- `requires an observed supported list, sends structured input once and validates native acknowledgment`
- `uncertain writes are never replayed and block another add until explicit inspection acknowledgment`
- `retains a lost-acknowledgment registration guard across owner recreation and reconnect`
- `never redirects a submitted payload when selection changes during asynchronous receipt recovery`
- `serializes concurrent receipts, refuses same-thread reservation and compare-clears exact identities`
- `preserves legacy presets/history without opting users in and merges concurrent edits from stale editors`
- `retains bounded opt-in text, filters credentials, deduplicates and clears history independently`
- `isolates duplicated session identities, reloads, clearing, profiles and all payload fields`
- `copies legacy drafts without consuming recovery data and survives denied writes`
- `reads the existing fork recovery key and tolerates unavailable storage` (extended
  to assert the read warning survives a successful write and clears after a
  successful read)

The unit queue/prompt tests mock the record boundary. They prove controller/delta
behavior, **not** native IndexedDB commits; the real-browser cases above establish
those boundaries.

## Broader verification and exclusions

Passed in this review:

- `pnpm run test:unit`: **1,589 passed, 2 skipped**, 150 files passed, 2 skipped.
- `pnpm run typecheck`: frontend and server passed.
- `pnpm run build`: frontend and CLI passed.
- `pnpm run test:integration:fixture`: built CLI and dev protocol fixture passed.
- Public entry CJS-host smoke on Node 22.23.2:
  `node -e "process.argv = ['node', 'codexapp', 'help']; const entry = require('./dist-cli/index.js'); console.log('CLI entry exports:', Object.keys(entry))"`;
  exit 0, CLI help and `CLI entry exports: []` (CLI has no library API).

The two full-suite skips are deliberate opt-in live tests:

1. `serves files through Codex CLI 0.167.2 RPCs` in
   `src/server/projectFiles.live.test.ts`: `CODEX_PROJECT_FILES_LIVE` was not `1`.
   Its separate Windows gate did not apply on this Linux host.
2. `accepts native Projects, fork/revert, transfer and persistent rollout cache on the live server`
   in `src/server/maintenance.live.test.ts`: `CODEX_MAINTENANCE_LIVE` was not `1`;
   requires live credentials/server/disposable turns.

**Browser engine tested: Chromium 156.0.8078.4 only.** Firefox and WebKit were not
tested, so their behavior is not established by this review. No acceptance test
cases were skipped in the browser commands above.

This is credential-free fixture evidence. IndexedDB transactions, document reloads,
local/sessionStorage, events and rendered UI are real. RPC responses, server queue
state and bridge transport are simulated. The integration fixture is not a real
Codex App Server. Live authentication, actual model execution, native exactly-once
behavior and live server latency were not exercised or claimed.

Performance audit: the editor fix adds at most 20 ID comparisons on explicit Save;
draft read-failure tracking adds one in-memory flag and no extra storage/network
calls. No new startup reads, RPCs, polling, subscriptions, payload copies or cache
invalidation paths were added. Production main JS is 495.69 KB / 158.33 KB gzip;
lazy prompt-library JS is 5.11 KB / 2.10 KB gzip in this run. No dependencies changed.

## Screenshot evidence

Actual changed UI, URL
`http://127.0.0.1:4173/?connection-profile=legacy#/thread/a`, viewport **1440x1000**,
light and dark. All paths are under
`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`:

- `acceptance-draft-failure-light.png`, `acceptance-draft-failure-dark.png`:
  visible quota/recovery failure, unsaved text retained and saved records unchanged.
- `acceptance-preset-conflict-light.png`, `acceptance-preset-conflict-dark.png`:
  preset recreated by explicit edit after remote deletion, present after reload.

![Draft recovery failure, dark](../output/playwright/acceptance-draft-failure-dark.png)
![Preset conflict, light after reload](../output/playwright/acceptance-preset-conflict-light.png)

Screenshots are generated evidence, not committed artifacts. The test runs leave
4173 available and do not restart the persistent 5173 server.
