# Phase 9-D-10: Final `useDesktopState` Audit

Audited commit: `5963e97` (`refactor(desktop): extract model preference helpers`). This is a read-only audit; no production, test, or documentation changes were made during verification.

## Executive summary

The structural refactor passes. `useDesktopState.ts` is 3,808 lines, down 1,370 (26.5%) from the 5,178-line baseline at `5cc4e16`. All seven named exports and all 61 returned API keys match the baseline. All requested verification commands passed, including 898 unit tests. No extraction regression was confirmed. Several async race cases remain plausible and lack dedicated reproduction; structural closure is reasonable if those follow-ups are tracked.

## Extracted modules and boundaries

| Module | Lines | Role |
|---|---:|---|
| `src/utils/turnTiming.ts` | 29 | Timestamp parsing and duration formatting |
| `src/utils/desktopMessageReconciliation.ts` | 222 | Equality, merging, optimistic matching and upserts |
| `src/composables/desktopStatePersistence.ts` | 421 | Storage, migration, normalization and serialization |
| `src/composables/desktopNotificationReaders.ts` | 615 | Notification parsing |
| `src/utils/desktopProjectGroups.ts` | 304 | Workspace grouping, naming and ordering |
| `src/utils/desktopModelPreferences.ts` | 16 | Model ordering and fallback selection |

The helpers have suitable dependencies. No helper owns module-scoped reactive state or performs storage/network/timer work at import time. A static graph walk of 16 reachable local modules found no import cycle. Notification readers import `clamp` from persistence; this is a small utility dependency. `App.vue` is the only direct production consumer found; other imports are tests.

## Compatibility and reactive ownership

An AST comparison confirms identical named exports and composable return keys relative to baseline. The API includes project groups and display names, thread selection and navigation, message/loading refs, model/reasoning/collaboration/speed preferences, notification-derived state, submission/interrupt operations, project operations, and polling controls.

All 101 pre-existing helper function bodies inspected across the extracted files match the baseline after formatting/comments are ignored. The three model preference helpers are extracted calculations. Message reconciliation returns prior message objects and arrays when unchanged; project helpers preserve identity on their existing no-op paths. Tests exercise these identity guarantees and public re-exports.

Composable refs, caches, request maps and timers remain instance-owned. The exception is pre-existing gateway-owned shared `reasoningCatalog`, which creates a multi-instance ownership risk described below.

## Lifecycle review

- Restart clears history payload and matching cache metadata; resume state is retained intentionally.
- Lifecycle generations suppress stale history, ancillary and pending-request publication after stop.
- Model refreshes use lifecycle, version and selected-thread checks for both success and failure.
- Skills requests coalesce by directory and guard publication and cleanup by ownership.
- Selected loading state is derived from visible per-thread loads.
- Selection generations protect global errors from obsolete `selectThread` failures.
- Timers are cancelled on stop and callbacks use lifecycle checks where applicable.
- An accepted submission may continue once after disposal while suppressing UI synchronization; tests cover this deliberate continuation behavior.

Focused tests cover these corrections, late successes/failures, stop/restart and selection changes. These tests establish the covered sequences only; they do not establish safety for every interleaving.

## Remaining suspected risks

No issue below was reproduced as a confirmed defect during this audit.

| Severity | Location and sequence | Inferred behavior and follow-up |
|---|---|---|
| Medium | `useDesktopState.ts` around `loadMessages` and `loadOlderMessages` (2669, 2740): overlap a detail refresh with older-page loading. | Each response publishes history and pagination metadata independently; completion order may discard older rows or publish a stale `hasMoreOlder`. Add both-order tests and define replacement semantics. |
| Medium, potentially high | Completion handling around 2066: turn B starts, then a late completion for A arrives. | Completion clears thread active-turn state without matching the active turn ID. Verify transport guarantees and test out-of-order notifications. |
| Medium | Pruning around 1125 while a history request is pending. | Same-lifecycle response may repopulate state for a pruned thread. Add archive/workspace-removal tests with deferred detail and page responses. |
| Medium | Speed update around 877; stop/restart before remote completion. | Catch/finally lack lifecycle guards and may publish stale mode/error/loading state. Add deferred success/failure lifecycle tests. |
| Medium for multiple instances | Shared `reasoningCatalog` publication around 948 and clearing around 3684. | One instance can clear catalog state another instance uses. Production currently has one consumer. Define ownership and test two instances. |
| Low/medium | Model refresh A→B→A around 925. | A result can pass the selected-thread check after returning to A if no newer refresh superseded it. Test both navigation sequences and failures. |
| Medium | Submission snapshot around 3095; defer resume and change model before continuation around 3317. | Model may be reread while reasoning effort remains from the earlier snapshot. Define snapshot semantics and test consistency. |
| Low/medium | `refreshAll` selected-history error publication. | Uses lifecycle ownership but not selection-generation ownership; test rapid selection changes during failure. |

## Performance and memory

These are static code-path observations, not runtime profiler measurements. Reconciliation uses linear maps in the common path; optimistic equivalence matching can be quadratic in optimistic/incoming message counts. Streaming concatenates growing strings and copies arrays/records. Computed message projection rebuilds collections and assistant metadata objects. Thread-indexed record replacement may invalidate projections for other threads.

History state is pruned with thread lists and cleared on stop, but no explicit message-cache LRU/global size bound was found. Generation metadata and timing maps also merit retention review. Skills/history/list requests coalesce; model refreshes suppress stale publication but can still repeat config and paginated catalog reads. Persistence serializes synchronously to localStorage. No measured browser rendering, heap, or request-count profile was performed, so extraction should not be credited with execution-speed gains.

The production build reported a 410.20 kB main JavaScript asset (131.07 kB gzip); this is a current measurement, not a before/after comparison.

## Tests and verification

Each of the six helper modules has a dedicated test suite. Desktop-state suites cover selection, workspace presentation, history, messages, optimistic attachments, preferences and lifecycle races. Remaining meaningful gaps are the overlapping pagination/detail case, late old-turn completion, pruning with pending history, speed updates across disposal, multi-instance catalog ownership and model/effort consistency after deferred resume. No flaky test was observed in this single run.

Commands ran sequentially and passed:

1. `pnpm run typecheck`
2. `pnpm run build`
3. `pnpm run test:unit` — 66 files, 898 tests passed
4. `pnpm run test:integration:fixture`
5. `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture`

Both fixture transports verified built CLI and dev entry points, HTTP RPC, metadata, browser WebSocket readiness, connection/init counts and fixture survival after app shutdown. These fixtures are credential-free and do not verify a live Codex server.

## Recommendation

Close phase 9-D as a structural extraction phase; no confirmed extraction regression blocks closure. Track the suspected races above before claiming complete async race coverage. Prioritize stale-turn completion and deferred submission consistency, then speed lifecycle ownership and history response ordering/pruning. Do not infer that phase 9-E has started.

At audit completion the working tree was clean on `main`, at `5963e97`; no files had been changed by the audit and no commit was created.
