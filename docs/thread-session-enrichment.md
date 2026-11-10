# Thread session enrichment ownership

## Ownership before extraction

The bridge owned a module-level session-details map, incremental generation-log
cache, successful-fork map, retry-deadline map, and in-flight promise map. All
survived HTTP requests and app-server client replacement for the life of the
loaded bridge module. The bridge also owned the shared generation metadata store,
used by submission/notification handling as well as read enrichment.

## Ownership after extraction

`threadSessionEnrichment.ts` owns the same module-level caches. The bridge creates
one enrichment facade with its existing generation metadata store. The facade
accepts only the store's merge/save methods; recovery takes the same narrow RPC
executor argument as before. Creating a facade does not reset any cache.

The bridge retains RPC routing, response envelopes, sanitization, pagination,
snapshots, archive recovery, thread restoration, runtime/client ownership, and
submission/notification persistence. These depend on runtime or HTTP state and
are outside the extraction. The skill merge public export remains available from
the bridge through a re-export. The extracted module never imports the bridge.

## Compatibility and performance audit

- Session keys remain exact paths; every lookup still stats the file. A matching
  size and mtime reuses parsed details. A miss reads the log once. Replacement
  uses the same generation-cache device/inode identity and size/mtime signature.
- Session details retain FIFO insertion order, a 64-entry bound, and no promotion
  on hits. Generation parsing remains separate and incremental; parsers are not
  combined. No watcher, timer, eager read, or new invalidation mechanism is added.
- Merge order remains skills, timestamps, then persisted/submitted and execution
  generation metadata through the existing store. Missing logs still permit
  submitted metadata. The existing fork inheritance algorithm is unchanged.
- Fork recovery still resolves the explicit/log parent before checking success,
  retry and in-flight state. The first caller receives enriched turns; concurrent
  waiters return their original result after awaiting recovery. Success/retry maps
  retain FIFO bounds of 64. Failures retain a 30-second retry deadline.
- Recovery still reads the parent once via RPC, enriches source then fork, inherits
  metadata, and persists it. No RPC is added or reordered. HTTP call sites and
  response construction are unchanged.
- Static comparison of the moved function bodies confirms unchanged filesystem
  calls, blocking parsing, payload construction, and fanout. Mocked tests count
  cache reads/stats and recovery RPC calls. No live latency, memory or browser
  profile was measured; this structural refactor makes no performance claim.

Focused unit tests cover malformed/missing logs, skills, generation evidence,
cache hit/invalidation/FIFO limits, fork parents, concurrent deduplication,
success tracking, bounded failure tracking and retries. Existing history tests
cover normal/earlier reads, timestamps, generation metadata and snapshots; existing
archive tests retain the restoration/recovery assertions.
