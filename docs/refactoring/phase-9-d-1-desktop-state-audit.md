> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

# Phase 9-D-1: Desktop State Modularization Audit

Audit date: 2026-11-11  
Audited commit: `e3a5bb7` — `fix(server): stop search builds after middleware disposal`

## Scope and outcome

This is an audit-only assessment of `src/composables/useDesktopState.ts` and related frontend modules. No production or test code was changed. Telegram is out of scope. The working tree was clean after verification.

The safest first implementation is 9-D-2: extract the pure timestamp parsing and turn-duration formatting helpers into a small utility module, with focused unit tests. Keep reactive state, request coordination, subscriptions, and lifecycle ownership in `useDesktopState()` while extracting leaf responsibilities.

## Structure and public API

`useDesktopState.ts` contains 5,178 lines. Approximate sections:

| Lines | Responsibilities |
|---|---|
| 1–67 | Gateway, normalizer, metadata, path, and UI type imports |
| 68–375 | Navigation/unread helpers; model and collaboration persistence; context keys |
| 376–534 | Stored token normalization; selected-thread and project persistence |
| 535–802 | Ordering, equality, message merging, optimistic reconciliation |
| 803–1046 | Turn display types/helpers; group merging and pruning |
| 1047–1311 | Workspace identity, disambiguation, filtering, placeholders |
| 1313–1572 | Instance state, request/timer bookkeeping, computed UI projections |
| 1574–1896 | Selection, models, reasoning, speed, quota, delayed synchronization |
| 1897–2428 | Sidebar flags, optimistic threads, pruning, turn/live state mutations |
| 2429–3425 | Notification parsing, request normalization, live-message helpers |
| 3426–3756 | Realtime application and event-driven synchronization scheduling |
| 3757–4065 | Workspace operations and paginated thread-list loading |
| 4066–4355 | History, older messages, skills, refresh orchestration, selection |
| 4356–4492 | Archive, rename, fork operations |
| 4493–4810 | Submission, steering, new threads, turn start, interruption |
| 4811–4937 | Rollback and project mutations |
| 4938–5107 | Notification synchronization, subscription, replies, cleanup |
| 5108–5178 | Selection priming and returned public API |

Named exports are `findAdjacentThreadId`, `isThreadUnreadByLastRead`, `removeThreadFromGroups`, `collectWorkspaceRootPathsForProjectRemoval`, `buildWorkspaceRootsProjectOrderState`, `filterGroupsByWorkspaceRoots`, and `useDesktopState`. No type declarations are explicitly exported.

`App.vue` is the only production caller. It creates one composable instance and distributes its refs and actions to the UI. The returned API includes project and thread selection, message projections, live overlays, model/reasoning/collaboration settings, loading/error state, history, submission, interruption, project actions, and polling controls.

## Responsibility and dependency map

| Responsibility | Dependencies | Main coupling |
|---|---|---|
| Selection/navigation | Selected ID, groups, persisted selection | Updates displayed model/mode; route synchronization remains in `App.vue` |
| Project/workspace presentation | Roots, source groups, order/labels, path helpers | List generations, filtering, optimistic-thread retention |
| History | Resume/detail/older-page gateway methods | Optimistic reconciliation, live overlays, turn indices, realtime revisions |
| Submission | Selected context, model/effort/mode, attachments | Optimistic rows, active turn identity, persistence gates, synchronization |
| Streaming | Notification parsers and per-thread live maps | History reconciliation, completion, summaries, errors |
| Model/reasoning | Stored context choices, gateway catalog/config | Shared `reasoningCatalog`, selection, submission |
| Persistence | `localStorage` and gateway title/workspace APIs | Initialization, setters, pruning |
| Lifecycle | Subscription handle, timers, request maps | Explicit start/stop calls owned by `App.vue` |

The useful dependency direction is `App.vue → useDesktopState orchestration → pure helpers / gateway`. Extracted modules should not import the composable or create their own state instances.

## Reactivity and ownership

Reactive state is created per `useDesktopState()` call, mostly with `ref` and `computed`. The composable itself registers no `watch`, `watchEffect`, `reactive`, or Vue lifecycle hooks. Routing and related watchers live in `App.vue`, whose unmount handler calls `stopPolling()`.

Request promises, generations, timestamps, timers, sets, and maps are nonreactive coordination state. `reasoningCatalog` is an exception: it is a gateway-owned shared ref read and mutated by the composable, and `stopPolling()` clears it.

Selection changes synchronously update model/mode and clear the active reasoning item identifier. Per-thread history/live caches are retained. Equality and merge helpers preserve existing array/message identity when data is unchanged; extraction must preserve those references.

Risky extraction patterns include calling `useDesktopState()` in submodules, moving refs to module scope, passing snapshots instead of live refs, replacing refs, automatically subscribing during helper construction, or moving storage reads to module import time.

## Async lifecycle and race findings

These are confirmed code-path gaps; their user-visible effects were not reproduced with new runtime tests during this audit.

| Finding | Evidence and implication | Characterization test |
|---|---|---|
| Shared history loading flag under overlap | `loadMessages()` sets/clears one `isLoadingMessages` boolean. One thread's completion can clear it while another initial load remains pending. | Start A and B reads; resolve A first; assert loading remains true while B is pending. |
| Skills requests coalesce across directories | `refreshSkills()` awaits an existing promise without checking the new directory key. A B request can return with A's skills and never request B. | Switch cwd during a deferred skills read; assert request keys and resulting skills. |
| Stale model failure lacks success guard | Success checks refresh version and selection; `catch` can clear the shared catalog or set a banner after a newer refresh succeeds. | Resolve newer refresh, then reject older refresh; also reject after stop. |
| Stop does not invalidate every continuation | Some list/model paths have guards, but history, skills, quota, pending-request reads, and submission continuations lack a common disposal guard. The zero-delay ancillary timer is not tracked. | Stop while deferred operations are pending; settle them and inspect state, timers, and subscription. |
| Stop/restart bookkeeping may be inconsistent | `stopPolling()` clears messages but retains loaded-message/version/resume bookkeeping. Reusing the instance may report loaded state with no message cache. | Stop/start and reselect a previously loaded thread. Check practical reachability because normal unmount may discard the instance. |

Additional suspected races needing characterization:

- Older-page and full-detail reads are not coordinated with each other; a later detail response may replace older messages or pagination flags.
- Completion handling clears active-turn state without comparing the completed ID to the currently active ID; impact depends on event ordering.
- Existing-thread submission captures thread/mode before an `await`, while turn start reads reasoning from current selection. Test switching threads across that boundary.
- Selection/submission failures can update shared error state after navigation.
- A history response may restore state after a thread was removed or pruned.

Existing protections include per-thread history coalescing and forced follow-up reads; realtime revisions that protect newer turn state; list generations and cursor/request checks; workspace invalidation generations; selected-thread/version checks on successful model refresh; transient history-failure throttling; and optimistic-message retention on submission failure. Keep these guards together during early extraction.

## Performance observations

Static code-path observations only; no runtime bottleneck is claimed:

- `messages` rebuilds maps, sets, combined arrays, and some metadata-bearing objects when dependencies invalidate; cost scales with loaded history.
- Streaming deltas search arrays and concatenate accumulated strings, which merits profiling for long replies and command output.
- `applyThreadFlags()` traverses all source threads. Read marking also flattens/searches groups and serializes the read-state map.
- Optimistic equivalence matching may scan incoming messages repeatedly, creating potentially quadratic reconciliation work.
- Token updates stringify usage objects for equality and serialize the full usage map for persistence.
- History/live state uses deep reactive refs and retains visited-thread data. There is no general bounded history-cache eviction policy.
- Pruning does not comprehensively clear all bookkeeping, including message-load timestamps/failure maps, generation metadata, live plans, and pagination maps.
- Model refreshes use version guards but do not coalesce requests; stale work can still fetch config/catalog before being discarded.

Existing controls include two-second list/history/skills reuse windows, per-thread history coalescing, gateway resume coalescing and workspace caching, 220 ms notification debounce, 500 ms quota debounce, delayed sequential background pagination, and refresh of the selected thread rather than every dirty thread.

No browser profiling, heap measurements, render timings, or production request traces were collected. Build output is only a baseline: main frontend JS was 408.19 kB (130.56 kB gzip).

## Existing tests and gaps

Main composable coverage is in `src/composables/useDesktopState.test.ts`, `useDesktopState.messages.test.ts`, and `useDesktopState.modelPreferences.test.ts`. It covers workspace filtering/order/identity, selection contexts, persistence, optimistic sends/attachments, streaming/history reconciliation, completion during pending history, cancellation without steering replay, rapid steering, transient failures, disconnects, catalog fallback, model usage, reasoning persistence, local-thread retention, and paginated list merging.

Gateway/normalizer coverage also tests resume coalescing and stalled-request eviction, paginated model catalogs, history normalization, and one-RPC normal history loading.

Focused coverage is missing or insufficient for rapid A→B→A selection with deferred outcomes; overlapping initial-history loading; cross-directory skills overlap; stale model failures and completion after disposal; older-message duplicate clicks and detail/page overlap; older-page failure/retry; exact subscription/timer cleanup; stop/restart consistency; late completion for an earlier turn; storage denial; identity assertions at extraction boundaries; and desktop/mobile route integration using the same instance.

Tests that call `stopPolling()` for teardown do not by themselves verify cleanup behavior.

## Modularization roadmap

| Task | Scope and target files | Benefit / risk | Required tests | Dependency |
|---|---|---|---|---|
| **9-D-2** | Move `parseIsoTimestamp` and `formatTurnDuration` to `src/utils/turnTiming.ts`; add `turnTiming.test.ts` | Small pure boundary; very low risk | Empty/invalid timestamps; zero, negative, nonfinite durations; rounding and minute/hour boundaries; summary behavior | None |
| **9-D-3** | Add async characterization in existing desktop-state test files, production unchanged | Establish behavior before structural work; low risk | Deferred promises/fake timers for selection, loading, skills/model refresh, and disposal | None; may follow 9-D-2 |
| **9-D-4** | Move message equality, merge, optimistic matching, live deduplication to `src/utils/desktopMessageReconciliation.ts` | Isolate cohesive pure algorithms; medium risk | Identity, attachment matching, repeated prompts, stale prefixes, metadata, preserve-missing ordering | Characterization for boundary |
| **9-D-5** | Move storage keys/codecs to `src/composables/desktopStatePersistence.ts`; keep refs in owner | Separate storage mechanics; low–medium risk | Legacy migration, corrupt values, context keys, unavailable/prototype-sensitive storage; preserve exceptions | Persistence characterization |
| **9-D-6** | Move stateless notification readers to `src/composables/desktopNotificationReaders.ts`; retain event application/subscriptions | Reduce parser bulk; medium risk | Malformed payloads, aliases, missing IDs, timestamps, image paths, command completion | Parser tests; timing helper available |
| **9-D-7** | Move workspace presentation helpers to `src/utils/desktopProjectGroups.ts`; retain requests, mutations, generations, retention | Clarify presentation boundary; medium risk | Duplicate roots, remote IDs, projectless groups, placeholders/order, unchanged identity | Existing grouping tests plus identity checks |
| **9-D-8** | Consider model-preference helper with explicit existing refs/callbacks; preserve catalog ownership | Reduce settings complexity if a narrow interface emerges; medium–high risk | Context persistence, fallback restoration, reasoning defaults, stale refreshes, submitted settings | 9-D-3 and 9-D-5; address stale failures separately |

Do not merge token-normalization implementations just because they share names: stored-data normalization accepts numeric strings and supplies defaults; notification normalization accepts aliases and requires complete numeric fields. Preserve both contracts.

Behavior fixes should be separate tasks after regression tests establish intended behavior, not bundled into extraction.

## Responsibilities to keep together initially

Keep history loading, realtime revision checks, optimistic reconciliation application, turn indices, and live cleanup together. Keep submission, active-turn identity, pending submission state, steering, and interruption gates together. Keep thread-list generations, roots invalidation, pagination, optimistic retention, and pruning together. Keep subscription handles, synchronization scheduling, disposal, and lifecycle bookkeeping together. Keep selection changes with their synchronous model/mode updates.

Rollback and excluded server, transport, runtime ownership, git/worktree, undo/redo, recovery, authentication, and Telegram areas were not audited for changes.

## Verification

| Check | Result |
|---|---|
| `pnpm run typecheck` | Passed |
| `pnpm run build` | Passed |
| `pnpm run test:unit` | 60 files; 740 tests passed |
| `pnpm run test:integration:fixture` | Passed |
| `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` | Passed after WebSocket fixture |
| Final Git status/diff | Clean |

Both fixture transports verified built CLI and dev entry points, RPC/metadata/browser WebSocket behavior, initialization counts, and fixture survival after shutdown. These are credential-free fixtures, not live Codex validation. Browser automation, live authenticated flows, and runtime profiling were not run. No package/runtime code changed, so an additional CJS smoke check was not applicable.
