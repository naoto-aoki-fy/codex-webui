> Historical structural audit; removed-feature descriptions are superseded by [current capability ownership](native-capability-consolidation.md).

> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

> Historical audit: application-managed file Undo/Redo, filesystem restoration during conversation revert, project creation, GitHub cloning, automatic chat directories, camera/folder attachments, and project aliases/manual ordering have since been removed. Native thread operations, existing workspaces, file/image attachments, and diff inspection remain. Earlier implementation details below describe the pre-removal code. Current verification: [workspace workflows](../../tests/projects-sidebar-new-chat/native-workspace-workflows.md).

# Phase 9-E-1: `codexGateway.ts` Audit

Audited `src/api/codexGateway.ts` at `90c89a9` on `main`. This audit made no production or test changes. Verification passed: typecheck, build, 898 unit tests, WebSocket fixture and Unix socket fixture.

## Executive summary

The gateway is 1,885 lines and combines public API adapters, payload normalization, history conversion, model capability presentation, workspace cache coordination, resume request coalescing, and project/persistence adapters. The safest improvements are narrow extractions of pure conversion helpers that preserve gateway exports. Keep transport state, resume coordination, workspace cache/mutation sequencing, and catalog ownership together until their lifecycle behavior is characterized.

No new defect was reproduced. Shared catalog ownership, deferred submission configuration, resume-cache freshness, and unanswered RPC lifetime need focused characterization before behavioral changes. This is an analysis-only audit; 9-E-2 was not started.

## Structure

| Lines | Responsibility |
|---|---|
| 1–147 | Imports, public data types, workspace state, collaboration defaults |
| 148–227 | Primitive readers and rate-limit normalization |
| 228–282 | RPC error wrapper, history indexing, effort/speed normalization, page types |
| 283–409 | Thread listing, summaries, detail and older-history pages |
| 410–452 | Notifications, method catalog, server requests, rate limits |
| 453–504 | Resume coalescing, archive, rename, rollback |
| 505–557 | File Undo/Redo adapters (out of scope for follow-up changes) |
| 558–720 | Thread metadata conversion, start and fork operations |
| 721–845 | Attachment conversion, submission configuration, start/interrupt turn |
| 846–932 | Speed configuration, shared reasoning catalog, model/config APIs |
| 933–1048 | MCP directory APIs and collaboration-mode presentation |
| 1049–1178 | Workspace normalization, cache, generation guards, mutation queue |
| 1179–1266 | Git/worktree adapters (out of scope for follow-up changes) |
| 1267–1533 | Directory/project operations, workspace mutations, composer/thread search |
| 1534–1602 | Telegram adapters (out of scope for follow-up changes) |
| 1603–1663 | Error-message conversion, title and pin persistence |
| 1664–1805 | Skill grouping and composer prompts |
| 1806–1828 | Upload with abort timeout |
| 1829–1885 | Thread goals and account APIs |

## Public API and dependencies

Preserve all existing named exports and types, including overload behavior. Runtime exports cover thread reads and mutations, turns, RPC/events, account and configuration, model capabilities, MCP, workspace/project operations, search/composer, title/pin persistence, skills, upload, thread goals, Telegram, Git/worktree, and file-change adapters. `CurrentModelConfig` is private but forms the inferred return contract of `getCurrentModelConfig`.

Notable API contracts include `forkThread(id)` versus `forkThread(id, cwd, model)` behavior, absolute history turn indices, active-turn metadata, catalog failure fallback to empty results, and differing throw/empty/null/false/best-effort error policies. Collaboration submissions include explicit settings and `developer_instructions: null`.

Production consumers include `App.vue`, `useDesktopState.ts`, `useNewThreadRuntime.ts`, `useFolderPicker.ts`, `SidebarThreadTree.vue`, `ThreadComposer.vue`, `ThreadConversation.vue`, `DirectoryHub.vue`, and `ThreadGoalPanel.vue`. Some other imports are type-only.

Dependency direction is UI components/composables → gateway → `codexRpcClient`, DTOs, normalizers and shared utilities. The gateway does not import server bridge code; integration occurs through HTTP routes and payload contracts. The bridge and app-server client own upstream transport, request correlation, recovery and server-side history behavior.

## Ownership, lifecycle and coordination

| Owner | State/responsibility |
|---|---|
| Gateway module | Shared `reasoningCatalog` ref, resume promise map/timers, workspace generation/request/cache/mutation queue |
| Each notification subscription | Browser WebSocket/SSE connection, fallback/reconnect timers and disposer |
| Desktop-state instance | UI lifecycle guards, history loading/reconciliation, model refresh publication and recovery orchestration |
| Server bridge/client | Upstream connection, RPC pending maps, subscription restoration, history recovery/enrichment and pagination cache |

Gateway import allocates module state but starts no network request. There is no gateway-wide dispose/reset API. Workspace reads wait for serialized mutations, coalesce an in-flight fetch, guard publication by generation and return clones. Mutations invalidate around execution and the queue continues after a rejection. Invalidated fetches are not cancelled; cached state has no TTL or cross-tab invalidation.

`resumeThread` coalesces by exact thread ID. Pending entries expire after 30 seconds; settled entries expire after two seconds. Identity checks prevent an old completion from deleting a replacement entry, but eviction does not cancel the original request. Browser notifications use WebSocket first, fall back to SSE after failed opening or 2.5 seconds, and reconnect with capped exponential delays. Each subscriber owns a separate transport. The server handles initialization and request correlation, rejects pending RPCs on disconnect, and does not replay application requests. Connection/initialization has a 10-second timeout; an established unanswered RPC has no explicit deadline.

History/session recovery stays server-side. The gateway converts results and pagination metadata; it does not scan session files or implement archive recovery.

## Concurrency risks and characterization

These are suspected risks, not confirmed defects. No new defect was reproduced during this audit.

| Concern | Observed behavior | Risk | Reproduction and likely boundary |
|---|---|---|---|
| Shared reasoning catalog | Gateway exports one ref; desktop instances write and clear it | One instance could clear capabilities another uses; medium for multiple instances | Load instances A/B, stop A, inspect B and submission. Decide ownership across gateway/consumer lifecycle |
| Concurrent model refresh | Each refresh fetches config and every catalog page; guards are instance-local | Duplicate requests and cross-instance last-writer publication | Resolve concurrent refreshes in both orders, including failure/stop. Characterize before coalescing |
| Catalog pagination | Repeated cursor stops; duplicate model records remain; later-page failure discards partial results | Conflicting capabilities or empty catalog after page failure | Test repeated/cyclic cursor, duplicate IDs, malformed data and later-page rejection |
| Submission capability lookup | Effort resolves against current shared catalog after model resolution | Catalog changes may omit or change requested effort | Defer config/catalog, alter capabilities, inspect exact `turn/start` payload |
| Deferred submission | Desktop captures effort and may reread model after resume | Submitted model and effort may represent different snapshots | Defer resume, change model/catalog, test stop/restart. Cross-layer characterization; leave `useDesktopState.ts` alone in this audit |
| Resume freshness | Settled result is reused briefly; mutations/notifications do not invalidate resume entries | Mutation followed by resume may reuse stale history/status | Resume, mutate, resume inside two seconds; also mutate during pending resume |
| Stalled RPC | Established RPC has no response deadline; resume eviction allows another call without cancelling the first | Pending calls retained or overlapping operations | Keep connection open without reply, retry after eviction, then deliver both replies |
| Workspace queue | Reads and later mutations wait behind earlier mutations | A stalled mutation can block unrelated callers | Defer mutation and inspect later read/mutation settlement |
| Workspace freshness | Cache persists until explicit invalidation | External/tab changes may remain invisible | Change server state externally, reread, then invalidate |
| History overlap | Gateway detail/page calls lack shared ordering coordination | Consumer may publish detail and page metadata out of order | Resolve detail/page in both orders, including reconnect and pruning |
| Notification multiplicity | Every subscription delivers independently; gateway has no replay/deduplication | Redundant work or late queued event delivery | Two subscribers, dispose during queued event, test fallback/reconnect |
| MCP pagination | No repeated-cursor guard | Repeated cursor can cause unbounded sequential requests | Stub repeated/cyclic cursors; keep any fix local to pagination |

## Performance and memory

These are code-path observations; no browser latency, heap, large-history or live request-fanout profile was measured.

- Normal detail loads use one RPC and older-page loads one HTTP request; server recovery can add upstream work.
- A model refresh requests config then pages sequentially. Concurrent refreshes duplicate work; no gateway catalog/config cache exists.
- Collaboration submission without an explicit model may fetch config and then catalog before `turn/start`.
- Model pagination stops repeated cursors but has no page/record budget for indefinitely unique cursors. MCP pagination has no such protection.
- History normalization and turn-index construction traverse returned turns. Resume promises briefly retain normalized histories and have no aggregate byte/concurrency bound.
- Workspace cache retains one state until invalidated; every read clones its arrays and records.
- Attachment deduplication uses nested searches; reasoning-option and workspace-array deduplication also have quadratic worst cases.
- JSON parsing, normalization, cloning and skill grouping run synchronously in the frontend. No synchronous filesystem/process operations occur in the gateway.
- Build reported main JS 410.20 kB (131.07 kB gzip), frontend build 4.06 seconds, CLI 271.89 KB. These are current measurements, not a gateway-specific comparison. Extraction alone should not be credited with speed gains.

## Test coverage and gaps

Existing tests cover gateway detail RPC shape and provider metadata, response-fork cutoff validation, resume failure coalescing and stalled-entry eviction, two-page model catalog traversal, collaboration payloads, attachment-only payloads, browser WS reconnect/disposal/fallback, server-side history recovery/pagination cache behavior, and app-server correlation/disconnect/reconnect. Desktop preference tests cover catalog-driven preferences but mock many gateway calls.

Gaps include malformed/empty catalog responses, repeated cursor and later-page failure, concurrent catalog requests, two independent desktop instances sharing the real reasoning ref, deferred model/effort consistency, resume invalidation after mutations, workspace generation/clone/failure races, notification delivery during teardown, and established unanswered-call deadline policy. Server fixture tests are credential-free and do not validate live Codex authentication or turns.

## Extraction candidates and order

Keep gateway exports as wrappers/re-exports and avoid importing the gateway back into extracted helpers.

| Order/task | Scope and target | Benefit/dependencies | Risk and focused tests |
|---|---|---|---|
| 9-E-2 | Rate-limit readers/normalizers and snapshot selection, lines 148–227 → `src/api/normalizers/rateLimits.ts` | UI rate-limit types; isolates compatibility conversion | Low. Test aliases, Codex bucket preference, fallback, malformed values, finite numbers and null/credit cases; verify gateway re-exports |
| 9-E-3 | Reasoning option/resolution calculations → `src/api/modelCapabilities.ts` | DTO types; isolates deterministic capability policy | Low/medium. Strings/objects, duplicate/unknown efforts, defaults, labels/descriptions. Keep ref and lookup in gateway |
| 9-E-4 | Thread metadata readers, start index and turn-ID lookup → `src/api/normalizers/threadMetadata.ts` | DTOs; stable conversions without duplicating `normalizers/v2` | Low/medium. Provider precedence, missing IDs, duplicate IDs, offsets and malformed numbers |
| 9-E-5 | Directory MCP response conversion → `src/api/normalizers/directoryMcp.ts` | Status type; separates conversion from RPC/pagination | Low. Alias fields, fallback tool names, malformed resources/templates |
| 9-E-6 | Workspace normalize/clone helpers → `src/api/normalizers/workspaceRoots.ts` | Path utility and workspace types; clarifies isolation | Medium. Paths, ordering, remote entries, duplicates and clone isolation; keep queue/cache in gateway |
| 9-E-7 | Skill path/group calculations → `src/api/normalizers/skills.ts` | Skill types; isolates grouping policy | Medium. Plugin/nested roots, missing roots, duplicates, ordering and precedence |
| 9-E-8 | Pure turn-input construction → `src/api/turnInput.ts` | Existing attachment prompt helper; separates payload construction from async resolution | Medium. Local/remote images, dual URL fields, attachment order/deduplication, skills and empty text |
| 9-E-9 | Characterize catalog ownership and deferred submission | Depends on model tests and explicit lifecycle/submission semantics | Medium/high. Two instances, stop/restart, deferred operations and exact payload |
| 9-E-10 | Characterize resume invalidation and stalled-call policy | Gateway/server lifecycle tests | Medium/high. Mutation/reconnect overlap, success/failure expiry, old completion and no-replay |
| 9-E-11 | Characterize pagination guards and catalog coalescing | Depends on ownership decisions; measure request counts | Medium. Repeated cursor, concurrency, cleanup, retry and fallback behavior |

The safest first implementation is 9-E-2, rate-limit normalization extraction, after focused tests establish conversion behavior.

Keep resume map/timer/identity coordination, workspace generation/cache/mutation queue, shared catalog ownership, asynchronous submission resolution, browser transport fallback/reconnect, and server RPC/recovery/cache invalidation together until lifecycle tests establish safe boundaries. Preserve wire methods/payloads, event behavior, overloads, error policies, phases 9-C/9-D behavior and server-side responsibilities. Authentication, Telegram, Git/worktree and file Undo/Redo are outside scope.

## Verification and repository state

Commands passed sequentially:

1. `pnpm run typecheck`
2. `pnpm run build`
3. `pnpm run test:unit` — 66 files, 898 tests passed
4. `pnpm run test:integration:fixture`
5. `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture`

Both fixture transports verified built CLI/dev entry points, HTTP RPC, metadata, browser WebSocket readiness, upstream connection/init counts, and fixture survival after application shutdown. They do not test authenticated live Codex turns or approvals.

Logs: `/tmp/9e-typecheck.log`, `/tmp/9e-build.log`, `/tmp/9e-unit.log`, `/tmp/9e-fixture-ws.log`, `/tmp/9e-fixture-unix.log`.

Final audit state: clean `main` at `90c89a9`; no source, test or documentation changes were made during the audit. No audit commit was created.
