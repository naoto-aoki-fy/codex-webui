> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

# Phase 9-C-1: `codexAppServerBridge.ts` modularization audit

## Scope and verification

This is a read-only structural audit of the bridge and related server modules. At audit time, `src/server/codexAppServerBridge.ts` contained 4,438 lines (164,896 bytes). No production changes were made. The working tree was clean before saving this report. The focused test command completed the full Vitest suite: 49 files and 482 tests passed. No build, browser, live-server, memory, or latency profiling was performed.

## Architecture

The bridge currently combines HTTP middleware and routing, JSON validation/formatting, thread RPC coordination, recovery and response shaping, session-log enrichment, Git and filesystem operations, persistence, authentication refresh, and SSE delivery. It imports existing route modules for account, skills, and prompts, plus `AppServerWebSocketClient`, `PersistentThreadIndex`, and generation metadata modules.

The browser WebSocket upgrade transport is already isolated in `src/server/browserNotificationTransport.ts`; `src/server/httpServer.ts` composes it with the bridge. `AppServerClient` owns the app-server connection-facing state: pending RPCs and server requests, subscriptions, stream-event buffers, last-read snapshots, earlier-page cache and in-flight reads, reconnect/restore promises, and auth refresh single-flight. A versioned `globalThis` singleton shares the client and Telegram service across middleware instances. Each middleware instance owns its own thread-search index and build promise. SSE owns a per-request notification subscription and 15-second heartbeat.

## Responsibility map

| Approximate lines | Responsibility | Main dependencies |
|---|---|---|
| 125–404 | Session skill/timestamp/generation enrichment and fork metadata recovery | Session JSONL, metadata stores, message timestamps, RPC |
| 405–483 | API performance logging configuration and request byte helpers | Environment, synchronous file reads |
| 484–870 | Inline media detection, persistence, sanitization, thread-turn trimming | Filesystem, temporary media directory, crypto |
| 871–1043 | Error classification, event-error merging, JSON responses, imported SQLite history | Client buffers, SQLite CLI |
| 1044–1317 | Projectless folders, GitHub clone, fork cutoff, archive recovery | Filesystem, Git, RPC, persistent index |
| 1318–1904 | Session patch parsing and file Undo/Redo | Session logs, filesystem, Git fallback |
| 1905–2159 | Search, process helpers, branch helpers, normalization | Ripgrep, child processes |
| 2160–2306 | External ChatGPT token refresh | Credential checks, auth file, HTTP |
| 2311–2730 | Thread titles/pins, session index cache, workspace roots | Global-state updates, streaming JSONL, realpath |
| 2731–2876 | Worktree rollback, Telegram config, request body and upload handling | Git, filesystem, HTTP streams |
| 2885–3280 | `AppServerClient` implementation | WebSocket transport, persistent index, metadata store |
| 3281–3415 | Method catalog, shared runtime, thread-search index construction | Global singleton, RPC |
| 3416–4438 | Middleware factory and HTTP route dispatch, including SSE | All route and runtime responsibilities above |

Key exports include `createCodexBridgeMiddleware`, `AppServerClient`, `forkThreadAtCutoff`, `callRpcWithArchiveRecovery`, `sanitizeThreadTurnsInlinePayloads`, session/workspace canonicalization helpers, `writeWorkspaceRootsState`, error classifiers, `buildProjectlessFolderName`, and `refreshChatgptAuthTokensForExternalAuth`.

Request history processing has a significant ordering contract: RPC/archive recovery, fork metadata recovery, turn trimming, stream error merge, inline payload sanitization, session enrichment, then snapshot storage. Earlier-page reads have their own shaping path. Preserve both flows independently during extraction.

## Safe extraction candidates

1. **Inline media sanitization** (approximately 484–851) into `threadInlinePayloads.ts`. Move its field allowlist, MIME helpers, filesystem persistence, and sanitizer together. Retain bridge re-exports initially. Existing tests cover nested payloads, non-image values, method exclusions, and recovered thread history. This is the safest next implementation task.
2. **HTTP primitives and error classifiers** into a small `bridgeHttpUtils.ts`, preserving exported classifiers and the JSON error/status contract. Test malformed/empty bodies and retired endpoint JSON 404 behavior.
3. **Thread title/pin persistence and session-index title cache** into `threadPresentationStore.ts`. Test title merge precedence, malformed/missing JSONL, cache signature changes, pin normalization, and the 500-title limit.
4. **Workspace-root canonicalization and state updates** into `workspaceRootsStore.ts`, retaining transactional global-state updates. Existing canonicalization and write tests should be extended for concurrent updates, symlinks, and unknown remote fields.
5. **Process helpers** into `bridgeCommands.ts` without merging their distinct contracts. Test spawn failures, raw/trimmed output, timeout behavior, and Git errors.
6. **Patch parsing and pure diff logic** into `turnFilePatches.ts`; leave filesystem writes and route orchestration in place. Cover add/update/delete/move, multiple hunks, newline behavior, and reversibility.
7. **Git/worktree routes** into `gitWorkspaceRoutes.ts`, depending on the workspace store and command helpers. Preserve partial-creation rollback and exact HTTP responses. Test empty repositories, branch allocation, collisions, persistence failures, cleanup, and branch listing.
8. **Session enrichment and fork recovery** into `threadSessionEnrichment.ts`, keeping module-level cache ownership together. Test metadata order, missing/changed logs, concurrent recovery, retry throttling, and fork inheritance.
9. **External auth refresh** into `externalAuthRefresh.ts`, leaving refresh single-flight and connection-generation checks with the client. Test credential-store checks, concurrent credential changes, and stale connection replies.
10. **`AppServerClient`** into `appServerClient.ts` after its module-level index/metadata dependencies can be injected through narrow interfaces. Test pending request rejection, reconnect, subscription restore, snapshots, approvals, and cache invalidation.
11. **SSE handler** into `bridgeSse.ts` while runtime ownership stays explicit. Test ready/event envelopes, close and abort cleanup, heartbeat cleanup, and disposal during an active stream.

For each extraction, run relevant focused tests, typecheck/build, and assess changed module-loading behavior. Route and module-loading changes should retain request counts, concurrency, cache invalidation, and parsing costs; this audit did not measure those live.

## High-risk boundaries

- **Client lifecycle:** connection generation guards, pending RPC rejection, server-request handling, subscription restoration, and reconnect single-flight must move as a coherent unit.
- **History recovery:** snapshots are in-memory fallback values. Empty-rollout and pending-materialization errors have distinct responses. Fork metadata recovery is best-effort and must not turn successful fork/read operations into failures.
- **Undo/Redo:** redo applies patches forward; undo reverses patch/change order and may restore tracked files from Git `HEAD`. Preserve patch filtering, rename handling, command-derived paths, partial errors, and response counts.
- **Shared runtime:** multiple middleware instances share one client; the current disposal path stops that client. Hot-reload replacement also has legacy-worker retirement logic. Do not change this ownership while doing leaf extractions.
- **Retired APIs:** `/codex-api/thread-file-change-fallback`, `/codex-api/thread-live-state`, and `/codex-api/thread-stream-events` explicitly return JSON 404s before SPA fallthrough.
- **Conversation rollback:** `thread/rollback` is an app-server RPC operation; filesystem rollback is a separate endpoint and operation.
- **Persistence transactions:** workspace updates preserve remote records, including unknown fields, and use locked global-state updates.

## Findings and evidence

- Subprocess setup is repeated across `runCommand`, `runCommandCaptureRaw`, and `listFilesWithRipgrep`; their timeout and output semantics differ, so consolidate only after extracting and characterizing them.
- Several workspace routes repeat path resolution and directory checks. A shared helper could reduce duplication, but response codes differ by endpoint.
- Session-log cache misses parse the same raw text for skills, timestamps, generation metadata, and fork parent; Undo/Redo parses it separately. A common parser is possible, though it would couple currently separate consumers.
- `asNonEmptyString` returns `null`, while `readNonEmptyString` returns an empty string; they are similar but not interchangeable without checking fallback behavior.
- `revertTurnFileChanges` assigns `patchHadError` without reading it. This appears dead local state; its patch-ID reporting behavior still needs explicit tests before alteration.
- Undo dynamically imports `writeFile` even though the module statically imports it. This is redundant, but should be cleaned separately from extraction.
- Identifier-reference inspection found no unreferenced private top-level function. Three exports have only test callers in-repository (`mergeSessionSkillInputsIntoTurns`, `canonicalizeWorkspaceRootsStateForRead`, `writeWorkspaceRootsState`); they are test seams, not confirmed dead code.
- Thread-search index is cached per middleware instance and has no normal invalidation for new messages, renamed threads, or archive changes. Each middleware instance can build its own index. This is a suspected stale-result/duplicate-work issue, not a measured production impact.
- Thread-list supplementation invokes `spawnSync('sqlite3', ...)`, blocking the event loop. No duration measurement was made.
- Event buffers cap events per thread, and session/fork caches have limits, but client snapshot, subscription, and total per-thread cache counts have no general bound. Memory growth was not measured.
- A notification can invalidate an earlier-page cache while its read is pending; that pending read can then repopulate the cache. A focused race test is needed to establish whether this creates observable stale data.
- Middleware disposal does not cancel an in-flight search-index build, and SSE intervals are request-owned. Repeated disposal can also stop the client shared by other middleware instances. These lifecycle concerns should be investigated separately from file moves.
- Request bodies/uploads and session logs are fully buffered/read on their respective paths; file search buffers and sorts the file list. No payload or latency profiling was performed.

## Recommended order and first task

Start with **9-C-2: extract inline media sanitization unchanged**. It is a cohesive, mostly stateless block with existing focused tests and no need to alter runtime ownership. Follow with HTTP primitives, then presentation and workspace stores, then command and pure patch helpers. Extract Git routes and session enrichment after those boundaries stabilize. Move `AppServerClient` and SSE later because they own connection, cache, timer, and listener lifecycles.

Keep stale search-index invalidation, cache bounds, disposal semantics, synchronous SQLite access, and session parsing performance as separate behavior-change tasks with their own evidence and regression tests. No Telegram work is included in this roadmap.
