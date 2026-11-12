> Historical structural audit; removed-feature descriptions are superseded by [current capability ownership](native-capability-consolidation.md).

# Phase 9-C-13: Final server bridge refactoring audit

> Historical audit: application-managed file Undo/Redo, filesystem restoration during conversation revert, project creation, GitHub cloning, automatic chat directories, camera/folder attachments, and project aliases/manual ordering have since been removed. Native thread operations, existing workspaces, file/image attachments, and diff inspection remain. Earlier implementation details below describe the pre-removal code. Current verification: [workspace workflows](../../tests/projects-sidebar-new-chat/native-workspace-workflows.md).

Audited commit: `3abbf25` (`refactor(server): extract SSE notification handling`). The audit was read-only; no production or test files were changed.

## Recommendation

Fix shared-runtime ownership, SSE teardown, pagination invalidation, and search-index freshness before phase 9-D. The extraction boundaries are sound; these are behavioral and lifecycle issues retained through the extractions.

## Structure

Current line counts: `codexAppServerBridge.ts` 1,871; `threadInlinePayloads.ts` 375; `bridgeHttpUtils.ts` 77; `threadPresentationStore.ts` 226; `workspaceRootsStore.ts` 270; `bridgeCommands.ts` 110; `turnFilePatches.ts` 272; `gitWorkspaceRoutes.ts` 455; `threadSessionEnrichment.ts` 287; `externalAuthRefresh.ts` 173; `appServerClient.ts` 458; `bridgeSse.ts` 39 (4,613 total).

A dependency scan found no circular imports across 32 reachable TypeScript modules. The extracted modules do not depend on the bridge; route handlers receive bridge-owned dependencies through context. The bridge still owns HTTP dispatch, response transformation, history pagination, archive recovery, search indexing, upload handling, SQLite supplementation, project directory allocation, Undo/Redo orchestration, instrumentation, and runtime composition. Its size alone does not warrant more extraction before correctness work.

Unused-symbol diagnostics identify `readCodexCredentialStore` (import at bridge line 31), `asNonEmptyString` (line 158), and `patchHadError` in Undo (line 734). Review the last before removing it because it may encode intended partial-patch semantics.

## Confirmed issues

1. **Shared runtime has multiple destructive owners.** `dispose()` unconditionally disposes the shared client and deletes its global registration. Reproduction: create middleware A and B, dispose A, and B's client is retired. Install a replacement runtime, then dispose stale B: it deletes the replacement registration without disposing the replacement. Fix with explicit, idempotent, identity-safe runtime release. Test multiple owners, last-owner shutdown, repeated disposal, and stale disposal after replacement. **High priority; fix before 9-D.**
2. **Pagination invalidation races with in-flight reads.** Cache population is unconditional after RPC completion. A deferred read followed by a notification for the same thread and then resolution stores the old result again; the next read serves that stale value without RPC. Snapshot invalidation has the same shape. Fix with per-thread invalidation epochs and only cache results from the current epoch. Test notification and snapshot invalidation during a read, and reconnect generations. **Medium; fix before 9-D.**
3. **Search results stay stale after thread changes.** Each middleware's search index has no TTL or mutation invalidation. After indexing, create/archive/rename a thread or add searchable messages; searches continue using old documents. Fix freshness and invalidation with a generation guard. Test mutations during and after index build. **Medium; fix before 9-D.**
4. **SSE ready-write failure retains its subscription.** Subscription setup precedes cleanup registration. The existing test makes the ready write throw and confirms the listener remains active. Register cleanup before fallible setup and release on failure. Test subscription and ready-write failures. **Medium; fix before 9-D.**
5. **Middleware disposal leaves SSE streams and heartbeat timers active.** The existing test confirms the response stays open and pings continue after disposal. Track active request disposers and call them during teardown. Test multiple streams, repeated disposal, and subsequent request close. **Medium; fix before 9-D.**

All four SSE limitations identified for this audit reproduce in current tests: repeated close/abort calls unsubscribe repeatedly (low immediate impact because set deletion is idempotent); close/abort listeners remain attached; middleware disposal leaves active streams and timers; and a failed initial ready write retains the subscription. These behaviors predate the SSE extraction and were preserved by it. Listener retention alone does not establish a memory leak.

## Runtime and compatibility

The shared client avoids duplicate upstream connections during ordinary use. Disconnect rejects pending RPCs and clears pending server requests, snapshots, event buffers, and pagination maps. Reconnect and subscription restoration are single-flight; application requests are not automatically replayed. Caveats: connected-but-unanswered RPCs have no deadline; same-version hot reload reuses old runtime objects and references; client disposal does not independently clear every listener/state map; browser transport disposal releases subscriptions but does not explicitly terminate connected browser sockets. Test these lifecycle cases before changing behavior. Slow-consumer/backpressure memory growth was not measured.

Public bridge exports and the zero-argument `AppServerClient` wrapper remain available compared with the pre-extraction version. No regression was found in tested route matching/envelopes, retired JSON 404s, RPC correlation, reconnect, auth-refresh single-flight, history/pagination, snapshots, session/fork metadata, Undo/Redo, Git/worktree operations, or SSE/WebSocket notification delivery.

Undo characterization preserves partial patch reporting, and fallback restoration uses `git checkout HEAD`; that can discard unrelated edits when reverse application fails. Characterize failure semantics before modifying Undo.

## Cache and performance observations

These are code-path observations, not heap or latency measurements:

- Search index/build promise is per middleware, so concurrent first searches can duplicate work. Indexing reads up to 100 histories with four concurrent reads; thread listing has no overall page or repeated-cursor guard. Add request-count tests and a repeated-cursor fixture.
- Event buffers are capped at 400 entries **per thread**, but have no aggregate thread/byte limit. Snapshots and pagination maps have no global size bound; pagination expiry is access-driven. Disconnect clears these maps. Define aggregate budgets and test many threads/large payloads. No leak or OOM was measured.
- Session enrichment and generation metadata caches are bounded at 64 paths. Session cache signatures use size/mtime (generation metadata also uses device/inode); same-signature replacement remains a characterization gap. Concurrent session misses are not single-flight and can parse large logs repeatedly.
- `spawnSync('sqlite3', ...)` blocks the event loop and has no explicit timeout. Results are limited to 200 rows, but duration was not measured.
- Inline media files are content-addressed and reused; upload files use unique temporary directories. No cleanup policy was found. Disk growth was not measured.
- JSON/multipart bodies are fully buffered; multipart concatenation adds another buffer. Ripgrep output is fully buffered and all paths are scored/sorted before limiting results. Large-body/tree behavior was not measured.
- Response instrumentation wraps methods and adds listeners even with logging disabled; RPC bodies are reserialized for byte counts. This is low-priority optimization, with no measured impact.
- The session-index title signature uses only size/mtime, excluding path and inode; identical signatures across replacement/path changes can preserve stale titles. Characterize before changing.

## Verification

- `pnpm run typecheck`: passed.
- `pnpm run build`: passed; frontend built in 4.13 seconds, CLI bundle 268.04 KB.
- `pnpm run test:unit`: 58 files, 685 tests passed.
- `pnpm run test:integration:fixture`: WebSocket fixture passed for built CLI and dev startup.
- `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture`: Unix socket fixture passed sequentially.
- `node dist-cli/index.js --help`: passed.
- `node --input-type=commonjs -e "process.argv=['node','dist-cli/index.js','--help']; require('./dist-cli/index.js')"`: passed; this exercises the CLI entry, not a library CJS export surface.
- Working tree was clean after verification.

Fixtures covered RPC, metadata, retired endpoint responses, browser WebSocket readiness, one upstream connection per host, and fixture-server survival. Real authenticated turns, approvals, and process survival against an independently managed Codex server were not tested. Logs were written under `/tmp/9c13-*.log`.

## Prioritized follow-up roadmap

| Task | Scope | Risk | Regression coverage | Blocks 9-D |
|---|---|---|---|---|
| 9-C-14 | Shared runtime acquire/release and identity-safe teardown; bridge | Medium | Multiple owners, last release, stale/repeated release | Yes |
| 9-C-15 | Exception-safe idempotent SSE request cleanup; `bridgeSse.ts` | Low | Ready-write/subscription failures, repeated close/abort, listener removal | Yes |
| 9-C-16 | Dispose active SSE responses/timers; bridge and SSE | Medium | Multiple streams, disposal, later close | Yes |
| 9-C-17 | Prevent stale pagination cache publication; `appServerClient.ts` | Low | Notification/snapshot during read, reconnect | Yes |
| 9-C-18 | Search freshness and mutation invalidation; bridge | Medium | Create/archive/rename/message changes, changes during build | Yes |
| 9-C-19 | Prevent disposed search builds from publishing; bridge | Low | Dispose during list/read stages | Yes |
| 9-C-20 | Characterize Undo preservation and partial reporting; bridge/patch tests | Medium | Reverse failure with unrelated edits, mixed success, selection scope | No; characterize first |
| 9-C-21 | Characterize session-index signature collisions; presentation/enrichment | Low | Same size/mtime replacement and path changes | No |
| 9-C-22 | Characterize unanswered RPCs and restore failures; client/transport | Medium | Missing response, failed resume, reconnect during restore | No |
| 9-C-23 | Characterize connected WebSocket shutdown and slow readers; notification transport/SSE | Medium | Open clients at disposal, queued bytes, listener errors | No |
| 9-C-24 | Bound aggregate caches; client | Medium | Many-thread/large-payload eviction and fallback correctness | No |
| 9-C-25 | Share search builds; bridge | Medium | Concurrent first-search request counts | No |
| 9-C-26 | Deduplicate session parsing; enrichment | Medium | Concurrent misses, append, truncation, replacement | No |
| 9-C-27 | Replace synchronous SQLite call; bridge | Medium | Locked/slow/missing database and result parity | No |
| 9-C-28 | Define temporary-file retention; upload/media | Medium | Abandoned files and active references | No |
| 9-C-29 | Bound request-body buffering; HTTP utilities/upload | Medium | Large valid bodies, limits, abort cleanup | No |
| 9-C-30 | Bound file-search work; commands/bridge | Medium | Large tree, cancellation, ordering | No |
| 9-C-31 | Remove confirmed unused symbols; bridge | Low | Typecheck and existing coverage; resolve Undo flag first | No |
| 9-C-32 | Reduce disabled instrumentation overhead; bridge | Low | Logging on/off and accounting parity | No |

Fix 9-C-14 through 9-C-19 as small independent changes before starting phase 9-D. No additional broad refactoring is recommended by this audit.
