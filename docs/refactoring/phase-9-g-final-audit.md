> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

# Phase 9-G final integration audit

## Scope and disposition

Resumed clean `main` at `a9cf361`. Read repository instructions, Phase 9-F and
9-G audits, progress and characterizations. User explicitly accepted optimistic
Undo validation with the residual external-writer race; it is no longer a gate
for the narrower preservation fixes. No branches, pushes, dependencies, Telegram,
authentication, public wire contracts or persistence formats were changed.

The authorized focused correctness work is complete subject to the verification
record in [progress](phase-9-g-progress.md). This is not proof of universal
correctness, complete data-loss prevention or live-server behavior.

## Confirmed defects corrected

- Undo no longer restores HEAD on unmatched updates, read/write exceptions,
  deletions or command-derived paths. It never writes the Git index. Staged,
  unstaged, combined and untracked conflicting bytes survive refused reversals.
- Added-file deletion requires exact expected bytes; symlinks/nonregular files
  are refused. Renames reject existing destinations and use exclusive creation.
  Updates reject non-UTF-8 content, unmatched or ambiguous reverse hunks, and
  edits detected by a final reread. Unrelated bytes outside matched hunks remain.
- Successful operation counts remain separate from full patch success. Any
  failed operation excludes its patch from `revertedPatchIds`; errors include
  the failing path and reason. Independent successful operations remain applied.
  Explicit patch selection never operates on command-only paths.
- Completion of an older turn cannot retire the newer active turn's identity,
  pending request, summary, error, activity, reasoning, command or agent state.
  The check precedes all realtime completion processing, including error readers.
  Only the old timing entry is removed; event-driven history sync still runs.
- Detail refresh preserves loaded history preceding its covered range and its
  absolute turn-index lookup. Pagination state follows the oldest retained page,
  including exhausted empty pages. Empty detail snapshots retain prior replacement
  semantics; missing recent rows are not unconditionally preserved by this fix.
- Pruning/archive invalidates history request ownership and cache/loading metadata.
  Old responses cannot resurrect retired history, erase a replacement's request
  entry or clear its loading flag. Lifecycle stop clears ownership as well.

Coverage includes clean updates/additions/moves, existing Redo execution, partial
patch failures, multiple selected patches, edited additions, rename conflicts,
missing preimages, repeat Undo, command scope, staged/unstaged/mixed/untracked
edits, editor writes before and after validation, both page/detail completion
orders, forced refresh during pagination, navigation, pruning and archival,
stale read success/failure, duplicate completions, live activity, approvals and
disposal. Existing streaming/submission/reconciliation tests remain in the suite.

## Accepted Undo limitations

The deterministic concurrent-editor characterization remains: after the final
validation read, an external edit can still be overwritten. An edit injected at
the initial read is now detected by final validation. This moves neither test
into a timing-dependent real-editor test nor removes the race evidence.

There is no filesystem compare-and-swap or transaction against external writers.
Additions can race validation/removal; updates and moves can race validation and
mutation. In-place writes preserve existing inode, permissions and hardlink
semantics; temporary replacement would change those semantics and is deferred.
Writes are not crash-safe; filesystem failures can leave partial operations.
Exclusive rename destination creation prevents replacement of an existing target,
but failure after creation may leave both paths. Errors do not imply compensation.

Delete and command-only records lack per-turn preimages and are refused even in
Git repositories. HEAD is deliberately not treated as a turn snapshot. Whitespace
normalization in the existing patch parser may cause a legitimate addition to be
refused; conservative refusal is preferable to content guessing. No force-restore,
backup, locking or recovery feature is introduced. Redo remains unchanged and is
not a safe conflict-recovery or backup mechanism.

## G-4: RPC lifecycle and ownership

Inspected `appServerWebSocketClient.ts`, `appServerClient.ts`, `codexRpcClient.ts`,
Gateway Resume and bridge RPC dispatch. Re-ran 53 focused lifecycle tests across
four files with deterministic wires/timers and disposable listeners.

- Initialization has its existing 10-second deadline, shared connection handshake
  and socket identity guard. Timeout/failure rejects initialization and permits
  a later connection; disposal does not terminate the independently managed server.
- Established ordinary RPCs settle by matching response ID, send failure or
  disconnect. Matching responses delete pending entries before settling.
  Disconnect/replacement rejects and clears the pending map; IDs remain monotonic,
  obsolete sockets and duplicate replies cannot settle newer requests.
- Non-idempotent operations are never automatically replayed. Subscription
  restoration remains sequential; a stalled resume can block later readiness.
- Browser RPC fetch has no application deadline/cancellation signal. An unanswered
  operation on a live connection retains its server pending entry and caller
  promise. Browser HTTP closure does not cancel the upstream operation. This is
  confirmed retention under the existing contract, not a newly bounded resource.
- Gateway Resume evicts pending coalescing entries after 30 seconds without
  cancellation, retains settled results/rejections for two seconds, and protects
  replacements with identity checks. Eviction is not settlement or upstream
  cancellation; callers may still await the evicted operation.

No safe new deadline, retry or cancellation contract was established. Options for
future authorization: per-method deadlines with explicit unknown-outcome errors;
caller detachment without upstream cancellation; or a supported correlated cancel
protocol. Each must define accepted-turn outcomes and avoid automatic replay.
No timeout or RPC policy change was made solely to hide retained promises.

## G-5: resource retention and performance

Concrete code-path audit and fixture counts, not browser/heap/latency measurements:

- G-1 removes Git root/tracked-list subprocesses and fallback checkouts. An update
  adds one full content reread; additions validate content once. Work remains
  sequential and request-scoped. Reverse matching scans for ambiguity. Large-file
  cost and crash behavior were not benchmarked.
- G-2 adds an identity lookup before completion handling; adds no network requests,
  timers, caches or fanout. Obsolete events still use existing debounced sync.
- G-3 adds instance-owned tokens, removed on pruning/archive/stop. Cache timestamps,
  pending entries and pagination flags now retire together. Detail reconciliation
  adds scans and a merge over retained history; no extra HTTP requests or parallel
  reads are introduced. Payload bytes and valid older history can now remain
  resident rather than being incorrectly discarded. No global eviction budget is
  introduced; pruning does not cancel upstream work. Existing detail coalescing
  and one older-page request per thread remain.
- Streaming strings and reactive projections still grow with accumulated output;
  the render window and bounded render caches do not bound all history bytes.
  No measured bottleneck justified changing these representations.
- Server stream replay is capped at 400 frames per thread, not aggregate bytes;
  page caches expire on access, and pending maps/snapshots have no global budget.
  Disconnect clears pending requests, replay and read caches. Steady connected
  retention needs a product budget/deadline policy before eviction changes.
- Model and MCP pagination have existing cursor-cycle protection; overlapping
  catalog reads can still duplicate work. Workspace reads retain generation and
  clone boundaries; mutations are queued and invalidate on success/failure. A
  stalled mutation can hold its queue. No new global cache was added.
- Notification unsubscribe/reconnect timers and stop/unmount timer cleanup remain
  covered by existing lifecycle tests. Synchronous JSON/localStorage/SQLite work,
  large response normalization and serialization remain structural observations;
  no representative workload was measured to justify a rewrite.

## Final integration boundaries and future work

Production changes are confined to Undo, reverse-patch ambiguity and desktop
completion/history ownership. Function signatures, response DTOs, RPC methods,
imports and persistence formats remain compatible by diff inspection; builds and
fixture tests verify the exercised entry points. No module dependency edge was
added to production code. No broad Git/worktree, UI rendering or provider changes.

No remaining confirmed critical Undo fallback loss or reproduced newer-active-turn
retirement/history-response corruption is left in the exercised scenarios. This
statement excludes the explicitly accepted external-writer race and untested I/O
failure/crash scenarios. Tests do not prove all possible interleavings or upstream
snapshot ordering. Completions without a known newer active identity still use
existing semantics; no speculative ordering is inferred from opaque IDs.

Future work: authorize RPC deadline/cancellation and aggregate retention budgets;
measure representative large histories/streaming/catalog workloads before further
optimization; verify real authentication, turns, approvals, reconnect and process
survival with an independently managed matching Codex server. These were not
verified by credential-free fixtures. No new major refactoring phase is proposed.
