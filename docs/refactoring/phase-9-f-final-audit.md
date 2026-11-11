# Phase 9-F: Final integration and correctness audit

## Scope and repository state

Baseline: clean `main`, `a97a3d5`. Read `AGENTS.md` and inspected current production code and characterization tests; earlier reports are historical evidence, not current verification. This audit covers frontend composition, gateway/normalizers, HTTP RPC, upstream transport, history/recovery, notifications, and teardown. No external documentation or live authenticated server was used. Telegram, authentication, Git/worktree and Undo/Redo production behavior are excluded from changes.

## Architecture assessment

The ownership boundaries remain appropriate: App owns application UI and composable lifetime; ThreadConversation owns rendering, scroll work and render caches; useDesktopState owns reactive thread state, optimistic reconciliation, refresh orchestration and lifecycle publication; gateway owns protocol conversion, model capability resolution and resume/workspace coordination; codexRpcClient owns browser HTTP and notification connections; bridge owns routing, recovery and shared runtime leases; AppServerClient owns correlation, subscription restoration and per-thread snapshots; AppServerWebSocketClient owns connection handshake and socket generation.

A local relative-import graph scan of 119 production `.ts`/`.vue` modules found 180 edges and no cycles (includes type imports; excludes tests; not a package/dynamic-runtime dependency proof). Extracted normalizers and reconciliation helpers do not import their orchestrators. No further extraction is justified by file length alone. App and conversation cleanup remove listeners/timers; conversation generations invalidate scroll work. Desktop lifecycle generations reject stale publication, but do not cancel accepted submissions. Gateway catalog leases now prevent one stopped consumer clearing another's ownership; refresh sequences protect newer successful publication. Mutable catalog publication remains an intentional shared boundary.

Errors differ by contract: model catalog failures return empty results, config reads reject, HTTP RPC wraps transport/protocol errors, and disconnect rejects pending upstream calls without replay. Unifying these policies would change behavior. No public API incompatibility is introduced by this audit.

## Prioritized task list (before follow-up execution)

| Priority | Finding and evidence | Task / disposition |
|---|---|---|
| P0 data preservation | `threadFileChangeRetirement.test.ts` writes unrelated tracked content, triggers Undo fallback and observes HEAD content instead; bridge uses `git checkout HEAD -- path`. Partial redo reports errors but Undo may count fallback as success. | Confirmed existing defect; production explicitly excluded. Requires preservation/partial-success design before release closure. Never reproduce on real user files. |
| P1 completion | Desktop completion clears active ID, in-progress, activity and pending request without matching completed ID against active ID. | Add deterministic old-A/new-B characterization; do not make a partial fix across all completion handlers. Real upstream ordering frequency unknown. |
| P1 history | `loadMessages` replaces persisted rows on nonsilent forced refresh; older-page reads independently merge rows and replace hasMore/index metadata. Both only check lifecycle generation. | Suspected detail/page ordering defect; characterize both orders and intended replacement policy before fixing. |
| P1 retention | Pruning removes thread records but same-lifecycle in-flight history can still publish; metadata and loading maps have different pruning coverage. | Suspected stale resurrection; deferred archive/remove fixtures needed. |
| P1 submission | Existing deferred-resume tests demonstrate captured effort combined with later/resumed model; gateway resolves effort against catalog at submission time. | Confirmed behavior, policy-dependent correctness; decide click-time snapshot versus resume-time preferences. No change. |
| P2 MCP pagination | `listDirectoryMcpServers` follows repeated/cyclic cursors without termination. | Characterize with bounded fake wire, then add local repeated-cursor termination and regression tests; preserve valid page order, aliases, errors and public shape. |
| P2 RPC retention | Existing real-client/fake-wire test retains two unanswered calls after 120 seconds with no deadline, clears them on disconnect/replacement, rejects stale socket replies and never replays. | Confirmed policy limitation; specify deadlines, caller cancellation ownership and accepted-turn ambiguity first. No timeout change. |
| P2 catalog work | Existing pagination tests prove repeated/cyclic model cursors terminate, partial failure discards results, overlapping requests/retries remain independent. Unique-cursor streams have no cap. | Preserve independent requests; choose budgets/coalescing only with measurements and freshness policy. |
| P2 notifications | SSE disposers and shared bridge releases are idempotent; browser WS disposal releases subscriptions but does not explicitly terminate active sockets. Browser callbacks lack a universal closed guard. | Suspected queued delivery/slow-reader retention; controlled teardown/backpressure characterization before behavior changes. |
| P3 recovery | Session/presentation cache signatures rely on size/mtime; search builds are generation guarded and TTL refreshed; pagination uses promise identity plus connection generation. | Signature collisions retain characterized behavior; budgets and stronger freshness need explicit design. |

## Cross-layer flow assessment

Selection and refresh use lifecycle/selection versions; history requests coalesce per thread. Realtime revision guards protect active-turn state against older detail responses, but do not establish page/detail ordering or pruning epochs. History conversion preserves turn IDs/indexes and reconciliation preserves optimistic rows until persisted matches appear. Resume mutation invalidation now detaches entries after successful start/steer/interrupt/rollback and notifications; identity-guarded cleanup cannot remove replacement entries. Failure-derived rejection reuse and 30-second pending eviction remain deliberate characterized policies; eviction does not cancel upstream work.

New-thread and resumed-thread sends carry model context and submit once even if disposal occurs during resume. Steering, interrupt, completion and pending-request state cross several handlers: no claim of complete interleaving safety is made. Model/reasoning preferences retain persistence formats and capability fallback. Workspace reads/mutations retain queue ownership and clone isolation; a stalled mutation can hold later work, and external edits depend on invalidation. Settings persist synchronously through existing normalizers. Stop clears instance history and polling resources; upstream reconnect restores subscribed threads sequentially and does not replay application calls. A rejected/stalled restoration can block subsequent RPCs; retry/cancellation policy is unresolved.

Bridge recovery remains server-side: sessions, snapshots, pagination and event replay are composed before normalized UI publication. Existing fixture tests exercise protocol boundaries, not authenticated live turns, approvals or actual reconnect survival. No evidence warrants changing wire methods, payloads, overloads, persistence formats or recovery semantics.

## Performance and memory

Static observations, not latency/heap measurements:

- Model refresh costs one config request plus P sequential catalog requests; N overlapping refreshes can cost N(1+P). There is no settled model cache. Each loop is sequential, but aggregate fanout is not bounded.
- Event replay is capped at 400 frames per thread, not aggregate bytes/threads. Snapshots, subscribed-thread sets, loaded histories and pending RPCs lack global budgets. Access-driven page-cache expiry does not itself evict idle entries. Disconnect clears server snapshots/events/pending maps.
- Streaming appends growing strings and copies reactive records/arrays; computed projections still traverse history despite the conversation's bounded render window. Optimistic matching can be quadratic. Render caching limits DOM/parsing work, not total retained history.
- Session misses can repeat parsing. Bridge SQLite recovery uses synchronous `spawnSync`; JSON serialization, localStorage persistence, body buffering, multipart concatenation and response byte accounting can block or duplicate payload memory. Search indexing bounds concurrent history reads but total payload sizes remain variable.
- No browser profiler, heap profile, large-history benchmark, live API trace or slow-consumer measurement was performed. Build output and deterministic request counts below are the available measurements; structural cleanup is not evidence of a speedup.

## Closure recommendation

Close structural extraction work; do not start a broad rewrite. Do not declare the entire correctness/data-preservation effort complete: Undo preservation is a confirmed unresolved risk, and history/completion behavior needs focused tests and decisions. Remaining policy-dependent work should be separately scoped with acceptance criteria. Passing fixtures cannot establish that all races, leaks or performance issues are eliminated.

## Execution and verification

Pending final verification and follow-up results.
