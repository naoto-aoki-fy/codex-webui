# Dead-code cleanup audit

The title RPC handler in `codexAppServerBridge.ts` always returns `{ title: '' }`. Keep it as a compatibility shim for older clients. The current frontend no longer calls it. Manual renaming, cached titles, provisional titles, and `thread/name/updated` handling remain active.

## Removed or consolidated functions

- Gateway: `generateThreadTitle`, `normalizeFallbackFileChange`, `normalizeThreadFileChangeFallback`, `fetchThreadFileChangeFallback`, `mergeRecoveredFileChangeMessages`, `enrichThreadMessagesWithFallback`.
- Desktop state: `requestThreadTitleGeneration`, `saveUnreadCutoffIso`, `removePersistedLiveMessages`, `omitKeys`, `getRateLimitSnapshotKey`, `normalizeRateLimitWindow`, `normalizeRateLimitSnapshot`, `normalizeRateLimitSnapshotsPayload`, `syncThreadStatus`.
- The inner `filterGroupsByWorkspaceRoots` duplicated the exported implementation. Production now resolves to that exported implementation, also used by the existing workspace filtering tests.
- Removed write-only `shouldAutoScrollOnNextAgentEvent` state and title-request capture variables.
- Removed gateway-local `ThreadFileChangeFallbackEntry` and unused legacy DTOs `ThreadListResult`, `ThreadSummary`, `ThreadReadResult`, `ThreadDetail`, `ThreadTurn`, `ThreadItem`, and `UserInput` from `types/codex.ts`. Active normalizers use the generated app-server DTOs instead.

## Dependency and compatibility evidence

Compiler unused-local diagnostics identified private candidates; repository reference searches traced their dependencies before removal. Private functions were neither returned from the composable nor registered as callbacks/routes. The fallback enrichment chain terminated at an uncalled private function. Server fallback/history routes remain registered. Active gateway rate-limit normalizers remain in use by account reads and notification handling. No persisted-data fields, storage keys, migrations, attachment handling, rollback paths, or file-change rendering changed.

Workspace-filter tests cover ordering, duplicate project names, workspace placeholders, and projectless groups. Title tests cover cached-title refresh, manual rename persistence, and notification-driven title updates. Existing message tests cover optimistic messages, history synchronization, and attachments. See the manual [title and recovery checklist](../../tests/thread-loading-state/thread-titles-without-generation.md).

## Performance audit

Each new-thread send previously invoked one additional title RPC with up to 300 prompt characters and cwd; it now invokes none. The synchronous server shim never generated a title. Removing the request also removes its promise/transport bookkeeping. Filtering retains the same operations and asymptotic cost. Unreachable helpers contributed no runtime requests. No new blocking operations, unbounded fanout, payload growth, or cache invalidation paths were introduced. No browser latency or allocation measurements were taken.

## Deferred candidates

Compiler diagnostics also identify unused UI computed values and handlers in App.vue, ThreadComposer.vue, and ThreadConversation.vue, plus `extractAssistantFileChanges` in the v2 normalizer and private server helpers. These remain for separate review of template/event and recovery behavior. Public exports and server endpoints are not considered removable merely because current frontend references are absent.

## Validation

- `pnpm run build`: passed frontend typecheck, Vite build, and CLI build.
- `pnpm run test:unit`: 312 passed, one failed. The failure, `refreshes a loaded optimistic thread when completion events arrive`, also reproduces from an untouched HEAD archive using the same dependency tree (duplicate `user:hi`). It is outside this cleanup.
- Focused title/workspace run: 11 passed, 34 skipped, including manual rename, cached title refresh, notification title update, and workspace filtering.
- `git diff --check`: passed.
- Browser/manual checklist was not executed; no UI or styling changes were made.
