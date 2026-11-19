# Scoped persistence maintenance evidence

> Historical verification record. Numbering and commands describe that review.
> Current ownership: [maintenance scope](maintenance-scope.md). Current support and upgrades: [native server contract](native-project-migration.md).

Baseline: fresh checkpoint `0cb06a31d805f1ffead3ed23b0469268f5ba0d8a`,
created on clean `main` after `ebd3df5`. No earlier cleanup was reset.
Implementation: `c1f21517ca1b65ec982016b7d23e5cdebb567f3d`.
The accompanying safeguard verification/documentation commit completes this task;
its ID is reported by Git in the completion response.

| Item | Status | Removed responsibilities | Retained responsibilities / blockers |
| --- | --- | --- | --- |
| 04 | Reduced | New list snapshots, preview/title derivation, name/timestamp updates, archive/unarchive/delete flags and archive-path inference; list fields removed from the active TypeScript entry interface | PersistentThreadIndex, the same file/path and JSON record map, durable attachment intent and reconciliation remain. No blocker to the scoped removal. |
| 09 | Already absent; safeguard removal deferred | No runtime migration implementation remained to remove. Removed an unused importer branch in the native CRUD test mock and corrected the legacy-display fallback claim | Read-only Project receipt and independent legacy-pin checks remain. No applicable end-of-support policy proves these checks safe to delete. Native Projects/pins alone cannot prove migration. |

## Field and operation ownership

Repository searches covered runtime code, tests, scripts, docs, method catalogs
and the bridge's indirect `AppServerClient` dependency. The active index is wired
in `codexAppServerBridge.ts`, scoped by `profileStateDirectory`, and invoked by
`AppServerClient` RPC wrappers. It has no list-maintenance event subscription or
exclusive notification path to remove. `thread/list` passes directly to native
RPC, including section/order parameters and cursors. Rebuild remains 501.

| Persisted field | Previous writer | Reader / purpose | Cleanup |
| --- | --- | --- | --- |
| `thread` snapshot, including ID/cwd/source/provider/createdAt/path and arbitrary native metadata | Initial attachment intent and returned thread responses | Snapshot merged only to maintain itself; native listing never consumed it | Stop generating/merging; retain old data opaquely |
| `thread.preview` | Native preview or derived attachment label | Same obsolete snapshot merge | Stop deriving labels and updating preview |
| `thread.name` | Native thread response and name/set | No active presentation/recovery reader | Stop updating |
| `thread.updatedAt` | Confirmation, turn/start and thread responses | No active presentation/recovery reader | Stop updating |
| `thread.turns` | Always persisted empty | No recovery reader; reconciliation uses current returned history | Stop generating |
| `archived`, `deleted` | Initial defaults, native mutation results and archive path | No active list/recovery/upgrade reader | Stop generating/updating |
| `pending.token` | Pre-send UUID | Token-matched confirm/rejection cleanup, pending retry guard | Retain |
| `pending.text` | Exact pre-send attachment envelope | Match accepted user-message content in returned history | Retain |
| `pending.previous` | Native history or bounded recent thread/start snapshot | Exclude earlier identical turns from reconciliation | Retain |
| `firstTurnId` | Confirmed response or matching new history turn | Determines whether first attachment intent is required | Retain |

Legacy metadata may contain unique historical values; it is preserved, not
reconstructed or discarded. Whole-file updates retain unknown fields and unrelated
records. No conversion, deletion, pruning or retention change occurs. Shared queue,
interprocess lock, atomic rename, temporary-file cleanup and error distinctions
are unchanged. Rejections clear only their token's pending intent; ambiguous
transport outcomes remain pending without replay. The in-memory recent-start
snapshot still supplies previous turn IDs and stays bounded to 64 entries.

Only `PersistentThreadIndex` reads/writes `codexapp-thread-index.json` in production.
Tests seed/read disposable copies. Project/pin safeguards read profile-scoped
`.codex-global-state.json`, never the recovery index. Their roots/remote-project
parsing and identity-hashed receipts must remain; shared persistence helpers and
profile isolation remain unchanged. `project/import` in the method catalog is a
native RPC capability, not a legacy runtime importer, and is retained.

## Upgrade boundary

The historical source `3f659043adef2fb075919dec669e88e843fe4889` was inspected with
`git show`: its Project importer writes completion only after verified native
operations; its pin migrator moves sections before deleting the old pin key.
The checks below describe the guard used in that revision. See the [native server contract](native-project-migration.md) for current behavior.

`nativeProjects.ts` and `threadPresentationStore.ts` are intentionally unchanged.
Native CRUD, thread associations, ordering, capability checks, section moves and
pin pagination remain authoritative. Historical migration tests that require
credentials are not evidence of a current migrator.

## Validation

Baseline and final commands all exited zero:

- `pnpm run typecheck`
- `pnpm run test:unit`: baseline **1276 passed, 2 skipped**; final **1286 passed,
  2 skipped**. Both: 95 passed files, 2 skipped files (97 total).
- `pnpm run build`: frontend and ESM CLI built; identical frontend artifact names/
  sizes, CLI 182.28 KB at both baseline and final.
- `pnpm run test:integration:fixture`: built CLI and dev entry points passed HTTP,
  metadata, browser WebSocket and correlated-error checks; one upstream connection
  per entry, independent fixture listener survived both shutdowns.

Focused final commands:

```sh
pnpm exec vitest run src/server/persistentThreadIndex.test.ts src/server/remoteHistoryPager.test.ts src/server/appServerClient.test.ts src/server/projectHistory.test.ts
# 4 files, 41 tests passed
pnpm exec vitest run src/server/nativeProjects.test.ts src/server/nativeUpgradeAcceptance.test.ts src/server/threadPresentationStore.test.ts src/server/projectHistory.test.ts src/server/workspaceRootsStore.test.ts src/server/connectionProfile.test.ts
# 6 files, 39 tests passed
node -e "const {execFileSync}=require('node:child_process'); const assert=require('node:assert/strict'); assert.match(execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'}), /Usage:/); console.log('PASS CJS caller invokes public ESM CLI help')"
# PASS; the public package entry is an ESM executable, not a CJS export library
git diff --check
# PASS
```

Count reconciliation: index tests **9 -> 15** (two existing tests updated for
recovery-only ownership, six new tests); upgrade matrix **6 -> 10** expanded cases
(three error variants plus a different-connection receipt). Its existing six
cases now coexist with populated native Projects. No tests deleted or new skips.
The same two opt-in tests remain skipped: `maintenance.live.test.ts` requires
`CODEX_MAINTENANCE_LIVE=1` and credentials; `projectFiles.live.test.ts` requires
`CODEX_PROJECT_FILES_LIVE=1` and a live Codex installation. No authenticated live
turns, migration, reconnect or remote-server version validation was performed.
Unit recovery tests use actual temporary persistence with mocked remote RPCs;
protocol fixtures are independently managed synthetic WebSocket servers.
Browser automation was not run: no UI changed and no applicable rule requires it.

Performance audit: rename/archive/delete and turn responses without thread history
now avoid the old index read/lock/update. New intent no longer serializes native
metadata. History reconciliation still uses returned data, without duplicate RPCs
or new polling. Whole-file locked serialization remains O(stored records), with no
new fanout or cache invalidation. Existing full history reads for uncached initial
attachment intent remain unchanged. No live latency profiling was performed.

Tests clean temporary stores and restore environment variables. Protocol fixtures
stop their own children/listeners; no persistent dev server was touched. No real
user files were deleted, truncated or migrated. Only explicit task paths were
staged; nothing was pushed.
