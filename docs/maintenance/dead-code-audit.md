# Dead-code cleanup audit

The title RPC handler in `codexAppServerBridge.ts` always returns `{ title: '' }`. Keep it as a compatibility shim for older clients. The current frontend no longer calls it. Manual renaming, cached titles, provisional titles, and `thread/name/updated` handling remain active.

## Removed or consolidated functions

- Gateway: `generateThreadTitle`, `normalizeFallbackFileChange`, `normalizeThreadFileChangeFallback`, `fetchThreadFileChangeFallback`, `mergeRecoveredFileChangeMessages`, `enrichThreadMessagesWithFallback`.
- Desktop state: `requestThreadTitleGeneration`, `saveUnreadCutoffIso`, `removePersistedLiveMessages`, `omitKeys`, `getRateLimitSnapshotKey`, `normalizeRateLimitWindow`, `normalizeRateLimitSnapshot`, `normalizeRateLimitSnapshotsPayload`, `syncThreadStatus`.
- The inner `filterGroupsByWorkspaceRoots` duplicated the exported implementation. Production now resolves to that exported implementation, also used by the existing workspace filtering tests.
- Removed write-only `shouldAutoScrollOnNextAgentEvent` state and title-request capture variables.
- Removed gateway-local `ThreadFileChangeFallbackEntry` and unused legacy DTOs `ThreadListResult`, `ThreadSummary`, `ThreadReadResult`, `ThreadDetail`, `ThreadTurn`, `ThreadItem`, and `UserInput` from `types/codex.ts`. Active normalizers use the generated app-server DTOs instead.

- Command resolution: removed `resolveCodexCommand`, `getCodexCommandCandidates`, `getPotentialCodexExecutables`, `getNpmGlobalBinDir`, and `prependPathEntry`. Repository-wide searches found no callers, namespace/dynamic access, or tests consuming these exports. The package ships a bundled CLI, with no library entry or export map exposing this source module. Legacy missing-CLI error text and old manual cases do not invoke these helpers; their compatibility handling remains intact. `resolveRipgrepCommand` and all its shared prefix/package-discovery helpers remain unchanged.
- Normalizer: removed private `extractAssistantFileChanges`, its heading pattern, and its three exclusive helpers. No normalization path called it; structured file-change processing, attachment extraction, diff counting, and generated DTOs remain.
- Bridge: removed private `getSkillsInstallDir`, `runCommandWithOutput`, `fileNameFromPath`, an unused authentication message, and compiler-confirmed unused imports. Active definitions in `skillsRoutes.ts` and `codexGateway.ts` remain. The removed utility imports have no initialization side effects.
- UI scripts: removed `latestUserTurnId`, `isPaymentRequiredErrorMessage`, the no-op virtual-keyboard watcher, and the conversation-local `buildPlanMessageText`. Vue-aware diagnostics and full-file searches found no template, event, exposed, or dynamic references. Keyboard classes/spacer, plan rendering, and the desktop-state plan builder remain active. No templates or CSS changed.

## Dependency and compatibility evidence

Compiler unused-local diagnostics identified private candidates; repository reference searches traced their dependencies before removal. Private functions were neither returned from the composable nor registered as callbacks/routes. The fallback enrichment chain terminated at an uncalled private function. Server fallback/history routes remain registered. Active gateway rate-limit normalizers remain in use by account reads and notification handling. No persisted-data fields, storage keys, migrations, attachment handling, rollback paths, or file-change rendering changed.

Workspace-filter tests cover ordering, duplicate project names, workspace placeholders, and projectless groups. Title tests cover cached-title refresh, manual rename persistence, and notification-driven title updates. Existing message tests cover optimistic messages, history synchronization, and attachments. See the manual [title and recovery checklist](../../tests/thread-loading-state/thread-titles-without-generation.md).

## Performance audit

Each new-thread send previously invoked one additional title RPC with up to 300 prompt characters and cwd; it now invokes none. The synchronous server shim never generated a title. Removing the request also removes its promise/transport bookkeeping. Filtering retains the same operations and asymptotic cost. Unreachable helpers contributed no runtime requests. No new blocking operations, unbounded fanout, payload growth, or cache invalidation paths were introduced. No browser latency or allocation measurements were taken.

## Deferred candidates

`attachmentFeedbackText` and undo-side `patchHadError` are explicitly excluded pending functional review. Other diagnostics (`selectedModelId`, the implement-plan payload, `pendingTurnRequest`, and unused test imports) remain outside this focused cleanup. No CSS selectors, shared types, compatibility handlers, WebSocket/SSE fallback, or history restoration were removed.

Vue/TypeScript unused-local/parameter diagnostics decreased from 23 to 8. These optional diagnostics still exit nonzero for the deferred findings; no suppression was added.

## Validation

- `pnpm run typecheck`: passed frontend and server type checks.
- `pnpm run test:unit`: all 341 tests passed across 38 files.
- `pnpm run build`: passed frontend and CLI production builds.
- `node dist-cli/index.js --help`: passed, printing the expected CLI options. This is the public ESM executable smoke check; the package has no CJS library entry or public exports.
- `pnpm run test:integration:fixture`: passed built CLI and dev HTTP RPC, metadata, and browser WebSocket checks; one upstream connection per app instance and independent listener survival confirmed. This uses a credential-free fixture, not a live Codex server.
- `git diff --check`: passed.
- Browser/manual checks were not executed; no UI or styling behavior changed.

For the unused-code removal, code-path analysis finds no new requests, blocking work, unbounded fanout, payload growth, or cache invalidation. Removed functions were unreachable; removing the no-op watcher avoids its reactive subscription/callback scheduling. Ripgrep discovery retains its existing synchronous probes and candidate order. No runtime latency measurements were taken.
