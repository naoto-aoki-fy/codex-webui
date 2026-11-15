# Open technical items

Canonical outstanding concerns and decisions. Source and tests take precedence;
remove entries when their acceptance criteria are met. P1 means correctness work,
P2 means boundedness or deployment verification, P3 means measured optimization.
Static evidence below does not establish production frequency, heap growth or latency.

## Transport and notifications

### Slow browser consumers and socket shutdown

- **P2 · suspected issue.** [Browser WS transport](../../src/server/browserNotificationTransport.ts)
  sends without a `bufferedAmount` budget; disposal unsubscribes and closes the
  WebSocketServer without explicitly terminating connected sockets.
  [SSE](../../src/server/bridgeSse.ts) checks closed responses but ignores the
  return value of `write`. SSE request/heartbeat teardown is already idempotent.
- **Impact:** slow consumers may accumulate queued bytes; WS shutdown may leave
  sockets open. Neither an unbounded heap increase nor user-visible failure was measured.
- **Next:** characterize slow readers and open sockets at disposal; define a
  disconnect/coalescing policy that preserves approval and completion events.
- **Acceptance:** deterministic slow-reader/disposal tests prove the agreed queue
  bound and socket lifetime; reconnect recovery works without replaying turns.

### Verify authenticated deployment recovery

- **P2 · future improvement.** [Client lifecycle tests](../../src/server/appServerClient.rpcLifecycle.test.ts)
  and [desktop tests](../../src/composables/useDesktopState.messages.test.ts) cover
  reconnect, backend replacement and history ownership. They do not establish live
  approval recovery, authentication or cross-host MCP OAuth behavior.
- **Impact:** a deployment can pass fixtures yet fail with real credentials,
  callback networking or server versions.
- **Next:** run the [external-server procedure](../../tests/website-docs-misc/external-app-server.md)
  against the target deployment, including MCP callback routing when used.
- **Acceptance:** record actual Codex version, host/user/CODEX_HOME mapping,
  authenticated turn, approval, reconnect and independent process-survival results;
  resolve failures before claiming deployment support.

## History and rendering

### Aggregate resource budgets

- **P2 · future improvement.** [AppServerClient](../../src/server/appServerClient.ts)
  caps replay at 400 frames per thread, but not aggregate bytes/threads. Snapshots,
  subscriptions and pending approvals lack global budgets; page-cache expiry is
  access-driven. [Desktop state](../../src/composables/useDesktopState.ts) prunes
  retired threads but has no global loaded-history byte budget.
- **Impact:** long connected sessions with many large threads can retain substantial
  data. RPC deadlines bound caller duration, not concurrency or total memory.
- **Next:** measure thread churn, large histories and concurrent requests, then
  choose budgets and eviction rules that retain active approvals and recovery.
- **Acceptance:** representative heap/request measurements and eviction tests show
  agreed bounds without losing older-page access, active state or reconnect recovery.

### Initial conversation window and streaming work

- **P3 · future improvement.** [ThreadConversation](../../src/components/content/ThreadConversation.vue)
  initializes `renderWindowStart` at zero; later watchers enforce the trailing
  window. Render caches have entry limits rather than byte limits. Changed streamed
  text is reparsed/highlighted, and collapsed command output remains in `v-text`.
  [Component tests](../../src/components/content/ThreadConversation.test.ts)
  characterize cached mount, parser reuse and windowing.
- **Impact:** cached mounts and large outputs can do avoidable work; no current
  frame-time bottleneck or heap regression has been measured.
- **Next:** profile cached/uncached mounts, long streams and collapsed output before
  changing window initialization or cache ownership.
- **Acceptance:** measured work/retention improves on representative workloads;
  pagination, thread changes, copy, highlighting and scroll anchoring pass browser
  checks in light/dark themes and mobile layouts.

## Preferences and asynchronous state

### Speed-setting completion across lifecycle changes

- **P1 · suspected issue.** `updateSelectedSpeedMode` in
  [desktop state](../../src/composables/useDesktopState.ts) writes rollback/error/loading
  state in catch/finally without a lifecycle or request-owner check, unlike model refresh.
- **Impact:** a late failure after stop/restart may overwrite newer display state.
  This is code-path evidence, not a reproduced user-visible defect.
- **Next:** defer success/failure across stop/restart and overlapping model refresh;
  define which lifecycle owns completion before adding guards.
- **Acceptance:** both completion orders preserve current speed/error/loading state
  while an already accepted remote config write is not replayed or misreported.

### Submission preference snapshot policy

- **P2 · accepted limitation.** [Deferred-resume tests](../../src/composables/useDesktopState.messages.test.ts)
  characterize effort captured before resume combined with a model selected or
  returned later; [Gateway](../../src/api/codexGateway.ts) resolves effort against
  current capabilities at send time. Accepted submissions can continue after UI disposal.
- **Impact:** the sent model/effort can differ from a single click-time snapshot.
  This is confirmed behavior; whether it is undesirable is a product decision.
- **Next:** choose click-time or resume-time semantics before altering submission.
- **Acceptance:** document the chosen policy and assert exact once-only RPC payloads
  for preference/catalog changes, empty resume model and disposal.

### Short-lived Resume and workspace freshness

- **P2 · accepted limitation.** [Resume lifecycle tests](../../src/api/codexGateway.resumeLifecycle.test.ts)
  confirm archive/rename do not invalidate the two-second settled Resume window;
  failures are also briefly reused. Successful turn mutations and history revert
  do invalidate. Gateway workspace reads reuse cached state until invalidation;
  external/tab changes do not have a TTL-based refresh contract.
- **Impact:** callers can briefly observe pre-mutation Resume data or retain external
  workspace changes until refresh. Rendered UI impact is not established here.
- **Next:** define mutation-specific freshness and cross-client refresh requirements;
  preserve pending-operation identity and failure-retry behavior.
- **Acceptance:** tests cover mutations during/after Resume, external workspace edits,
  failure reuse and old cleanup versus replacement entries under the agreed policy.

### Duplicate catalog requests

- **P3 · future improvement.** `refreshModelPreferences` in
  [desktop state](../../src/composables/useDesktopState.ts) independently reads config
  and sequential model pages. Publication leases protect shared capabilities;
  they do not coalesce transport work. Model/MCP cursor cycles already terminate.
- **Impact:** N overlapping refreshes with P catalog pages can issue N × (1 + P)
  requests; actual frequency/cost is unmeasured. Unique cursors have no page budget.
- **Next:** measure real request counts; consider lifecycle-scoped in-flight sharing
  only if useful, with explicit freshness and failure semantics.
- **Acceptance:** request-count evidence supports the change; tests preserve record
  ordering, ID deduplication, empty-on-failure behavior, per-owner publication,
  stop/restart isolation and retry after failure.

## Files and storage

### Retention and large remote transfers

- **P2 · accepted limitation.** [Remote uploads](../../src/server/remoteUploads.ts)
  enforce 20 MiB per file and record intent before writing. Retention is deliberately
  indefinite, including abandoned/unknown outcomes. [Inline media](../../src/server/threadInlinePayloads.ts)
  reuses content-addressed files without automatic cleanup. [File service](../../src/server/appServerFileSystem.ts)
  reads whole Base64 files even for HEAD/ranges; no pre-read size budget exists.
- **Impact:** disk usage can grow; concurrent large previews can multiply transfer
  and buffer memory. Referenced uploads must remain available to durable history.
- **Next:** measure disk/transfer costs; define reference-safe retention and supported
  large-file limits. Follow [upload operations](../external-app-server.md) rather
  than deleting files solely by age.
- **Acceptance:** any cleanup preserves active and durable references and unknown
  outcomes; large-file/concurrency tests demonstrate agreed bounds and retain HTTP
  conditional/range/error semantics. No automatic deletion is implied today.
