> Status: `thread-live-state` retirement is implemented. Its candidate-removal and compatibility discussion below records the prior assessment; the route now returns JSON 404. `thread-stream-events` is now also retired with JSON 404; only its HTTP adapter was removed and all shared buffers/error recovery remain. The sections below retain the prior assessment.

# Legacy Thread Endpoint Retirement Plan

This plan is based on a static repository review. No code was changed during the audit. Repository searches cannot establish whether independently maintained clients use these endpoints, and production traffic was not measured. The absence of repository callers is not evidence that external consumers do not exist.

## Findings and compatibility status

| Endpoint | Verified repository facts | Compatibility still unresolved |
|---|---|---|
| `/codex-api/thread-file-change-fallback` | No current frontend, executable test, or script URL caller was found. Its handler reads `thread/read` and the session log, then returns recovered patch changes as `{ data }`. | Whether external clients consume its turn-indexed response or rely on its recovery behavior. |
| `/codex-api/thread-live-state` | No current frontend caller was found. `PROJECT_SPEC.md` documents it as a retained diagnostic/recovery API, and manual procedures call it. It assembles full history with recovered items and has pending-materialization and read-failure behavior. | Whether external clients depend on the documented diagnostic API, response envelope, or reconstructed history. |
| `/codex-api/thread-stream-events` | No current frontend caller was found. Manual stream-parity tests query it during active turns. It exposes buffered notifications as `{ events }`. | Whether external diagnostic clients depend on buffered event retrieval, timestamps, or limit behavior. |

No blanket HTTP API stability guarantee or maintained external-client inventory was found. The project does document compatibility boundaries for other APIs, and explicitly retains `thread-live-state`; this is evidence that its compatibility decision must be deliberate. Historical test procedures and results do not establish current external usage.

## Shared mechanisms to preserve

All retirements must preserve the normal `thread/read` path and these shared recovery mechanisms in `src/server/codexAppServerBridge.ts`:

- `callRpcWithArchiveRecovery`, thread-read snapshots (`storeThreadReadSnapshot`, `getLastThreadReadSnapshot`, and their state), and the generic RPC fallback for recognized empty reads.
- `isThreadMaterializationPendingError` and the generic RPC response for pending materialization.
- Stream event recording and bounded buffering (`recordStreamEvent`, `streamEventsByThreadId`, and `getStreamEvents`) because `mergeStreamTurnErrorsIntoThreadResult` uses them to merge errors into normal history and earlier pages.
- `mergeStreamTurnErrorsIntoThreadResult`, WebSocket/SSE notification delivery, thread ID extraction, earlier-history caching and deduplicated reads.
- Session timestamp and generation metadata recovery, skill-input recovery, and inline-payload sanitization used by normal history.
- `parseApplyPatchInput` and shared patch/file-change collection used by file rollback, Undo/Redo, and other active features.

Removing `thread-live-state` cache invalidation must leave earlier-history cache invalidation intact. Removing `thread-stream-events` must not remove the buffer, its producer, or error merging.

## Independent retirement steps

Each endpoint needs its own compatibility decision, implementation, and validation. Do not proceed to code removal until maintainers decide whether to continue support, deprecate for a defined window, or retire with an explicit compatibility break. Where possible, gather representative deployment access logs over an agreed period, inventory supported integrations and scripts, and ask identified consumers. No traffic during a measured period only covers the deployments and period observed.

### 1. `thread-file-change-fallback` (retired)

The user explicitly authorized this compatibility break with no replacement. The route now returns HTTP 404 JSON and its exclusive implementation is removed. The following original planning details document the boundary; the remaining endpoints still require separate decisions.

This is the smallest repository-level removal and should be considered first.

**Candidate removal in `src/server/codexAppServerBridge.ts`:** the GET route; `buildSessionFileChangeFallback`; `SessionRecoveredTurnFileChanges`; and `mergeRecoveredFileChange` (current references indicate it is exclusive to the fallback builder). Preserve `parseApplyPatchInput`, `SessionRecoveredFileChange`, its parsing/count helpers, and all rollback consumers. Recheck imports before deleting any filesystem dependency.

**Documentation and tests after a decision:** update `docs/legacy-api-and-optional-feature-audit.md` and `docs/api-wrapper-cleanup.md` with the decision, retired-route behavior, and any replacement. Add a focused retirement procedure under `tests/thread-loading-state/`; no endpoint-specific executable test was found to remove. Check middleware behavior rather than assuming an unhandled route produces JSON 404.

**Compatibility evidence needed:** identify consumers of `{ data }`, its turn IDs/indices, and patch details; decide whether this capability is discontinued or replaced. Normal `thread/read` is not verified as equivalent.

**Risk and validation:** external clients may silently lose reconstructed patch data. Check the retired response in development and packaged serving. Verify normal history and earlier-page loading plus file Undo/Redo and conversation rollback for add, update, delete, and move patches, including existing cases in `tests/git-worktrees-rollback/`. Statically, removal eliminates only work initiated by this route: a full-history RPC, session-file read, and scan. No runtime performance measurement was made.

### 2. `thread-live-state`

This endpoint has the strongest documented compatibility signal and needs explicit approval to withdraw its diagnostic/recovery contract.

**Candidate removal in `src/server/codexAppServerBridge.ts`:** the GET handler and response assembly; `liveStateCache`, its get/set/invalidate methods, notification invalidation, and its disconnect cleanup; plus route-exclusive reconstruction helpers: `mergeSessionCommandsIntoTurns`, `buildSessionItemOrder`, `parseExecCommandOutput`, `SessionRecoveredCommand`, `SessionRecoveredFileChangeItem`, and `SessionItemSlot`.

Current references also make `mergeItemsIntoTurns`, `captureItemFromNotification`, `capturedItemsByThreadId`, `CapturedItem`, and `MERGEABLE_ITEM_TYPES` candidates for removal with their producer call and disconnect cleanup. Confirm references again when implementing. Preserve stream buffering/error merging, snapshots, pending-materialization recovery, timestamps, generation metadata, skill recovery, and shared patch parsing.

**Documentation and manual procedures:** update `PROJECT_SPEC.md`, `docs/legacy-api-and-optional-feature-audit.md`, and `docs/api-wrapper-cleanup.md`. Update `tests/thread-loading-state/thread-stream-parity-stream-first-hydration-with-full-turn-history.md`, `thread-stream-parity-works-on-linux-oracle-a1-arm64.md`, `tests/auth-docker-runtime/docker-auth-startup-live-state-pending-read.md`, and `thread-detail-load-avoids-duplicate-live-state-history-fetch.md` so they describe supported behavior. Preserve historical context where useful; do not rewrite immutable `llm-wiki/raw/` sources.

**Compatibility evidence needed:** determine whether consumers require full reconstructed history, captured in-flight items, command/file-change interleaving, or the `conversationState`, `ownerClientId`, `liveStateError`, and `isInProgress` envelope. Generic RPC and paged history are not proven drop-in replacements. Approve withdrawing the documented contract and define any migration.

**Risk and validation:** the principal risks are breaking diagnostics and deleting state used by normal read fallback. Add focused coverage for snapshot fallback after recognized empty reads; pending materialization; buffered stream errors in normal and paged reads; genuine read failures; timestamp, generation, skill, and inline-payload enrichment; and page-cache invalidation/read deduplication. Validate first-turn and failure behavior against an independently managed external app-server, recording its Codex version and results. The credential-free fixture cannot prove live materialization behavior. Removal may reduce assembly work and captured-item memory; no runtime measurement was made.

### 3. `thread-stream-events`

This endpoint should be decided independently after the first two; its route is thin, while its backing buffer is shared.

**Candidate removal in `src/server/codexAppServerBridge.ts`:** only the GET route and its query/response adapter. Keep `StreamEventFrame`, buffer limits/state, `recordStreamEvent`, `getStreamEvents`, notification wiring, disconnect cleanup, and `mergeStreamTurnErrorsIntoThreadResult`.

**Documentation and tests after a decision:** update `docs/legacy-api-and-optional-feature-audit.md`, `docs/api-wrapper-cleanup.md`, and the stream-parity manual procedure. Replace HTTP polling with supported notification/history-error checks while preserving unrelated pagination assertions.

**Compatibility evidence needed:** find out whether external diagnostics use buffered replay, timestamps, or limit semantics. Choose an alternative or explicitly discontinue buffered retrieval. WS/SSE provides live notifications and is not automatically equivalent to replaying buffered events.

**Risk and validation:** deleting the helper or buffer would break normal history error merging. Check the retired response in development and packaged serving; verify buffer ordering, limit and overflow behavior, notification recording, disconnect cleanup, error merging in normal and paged reads, and WS/SSE delivery. Only route retrieval/serialization disappears; buffer allocation remains, so no buffer-memory saving is expected. No runtime measurement was made.

## Validation and implementation sequence

For each approved removal, make one focused change and update its documentation/manual procedure. Run the focused checks, then `pnpm run test:unit`, `pnpm run typecheck`, `pnpm run build`, and `pnpm run test:integration:fixture` as applicable. If runtime/module-loading behavior changes, also run the required built-entry CJS smoke check. Keep each endpoint independently revertible and do not combine removals into one change.

Recommended order: decide and implement fallback first; separately decide and implement live-state; separately decide and implement stream-events. No endpoint is safe to remove solely because repository caller searches found no frontend callers.
