# Resume Cache and RPC Lifecycle Characterization

This document records the behavior characterized by commit `8e37cef` (`test(gateway): characterize resume cache and rpc lifecycle`). It describes current behavior; it does not prescribe or implement production changes.

## Gateway Resume cache

`resumeThread` coalesces requests by thread ID. A pending entry is evicted after 30 seconds, but eviction does not cancel the RPC. After settlement, the entry is retained for 2 seconds. Both successful and rejected promises are reused during that interval. Expiry or eviction allows a subsequent call to issue a new RPC. Replacement ownership checks prevent an older request's completion or cleanup from deleting a newer entry.

Archive, rename, rollback, turn start, fork, and thread start do not invalidate the Gateway Resume entry. Tests show that a successful mutation followed by Resume during the reuse window returns the same result object, including its pre-mutation history and status. This is a confirmed stale-result behavior for history/status-changing mutations; the tests do not demonstrate rendered UI impact. Mutation categories may need different invalidation decisions.

Pending Resume calls for the same thread share one RPC; another thread proceeds independently. If mutation succeeds or fails while Resume is pending, the original Resume remains the cached result. A late success or failure after pending-entry eviction does not displace a replacement request.

## RPC lifecycle boundaries

The app-server WebSocket transport has a 10-second connection/initialization timeout. Once initialized, ordinary upstream RPCs have no response deadline. Deterministic tests leave calls unanswered for 120 seconds of fake time; they remain pending until disconnect or connection replacement. Disconnect rejects pending calls and clears their ownership. Reconnection creates fresh request IDs. Replies from an obsolete socket cannot resolve requests on the new connection, and application requests are not automatically replayed.

The browser HTTP RPC wrapper also adds no application deadline or automatic retry. A pending fetch remains pending until fetch itself settles. Gateway cache eviction, browser HTTP fetch, upstream RPC waiting, and server-side history/session recovery are separate ownership boundaries; eviction of a Gateway entry does not cancel the upstream operation.

## Verification and limits

The characterization tests passed with the full unit suite (1,174 tests), typecheck, build, WebSocket fixture, and Unix fixture. The fixtures are credential-free protocol checks, not a live Codex server. No production fix, live UI impact, or live-server latency measurement is established here.

Potential follow-up boundaries, in order: define mutation-specific Gateway freshness; decide whether rejected Resume results should retain the same short reuse window; then consider an explicit upstream RPC deadline/cancellation policy and its interaction with browser HTTP behavior. These are recommendations for separate work, not changes made by the characterization task.
