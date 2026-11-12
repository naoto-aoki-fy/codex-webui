# App-server client ownership

`appServerClient.ts` owns the coherent client implementation: one transport per
instance, monotonic RPC IDs, pending RPC promises, approval requests, notification
listeners, connection generations, reconnect/restoration promises, subscribed
thread IDs, authentication refresh single-flight, pending generation settings,
400-frame per-thread event buffers, fallback snapshots, and 30-second earlier-page
read caches and in-flight deduplication maps.

The bridge owns the persistent attachment-only thread index. Generation settings are attached to live turns in memory; no metadata store is written.
These were the class's mutable module-level dependencies before extraction. The
core now receives narrow `threadIndex.call` interface;
the bridge's zero-argument `AppServerClient` compatibility subclass supplies the
same existing instances. No store, client, or transport is duplicated. The core
imports transport, credential access, external refresh, generation metadata
normalization, and HTTP value helpers directly; it never imports the bridge.
The local string validation helper preserves the original semantics.

The bridge retains HTTP routing, snapshot fallback selection, archive recovery,
SSE, middleware disposal, and the global shared runtime. The shared key
and `external-websocket-v1` version are unchanged. Matching hot-reload generations
reuse the existing object without an instanceof check; incompatible generations
still retire legacy workers and dispose the previous runtime before replacement.
The public bridge constructor remains callable without arguments and inherits all
previous instance methods. Prototype method ownership moves to the core class.

Transport construction remains a field initializer in the original position;
construction does not connect. Disconnect still advances the generation, rejects
pending RPCs, clears approvals/events/snapshots/page caches, and emits the same
notification. Subscriptions survive disconnect and restore once per generation.
Authentication replies still check the captured generation. Disposal delegates
to the existing transport. No method algorithm, RPC ordering, timer, or listener
registration changes were introduced.

## Performance audit

Code-path comparison shows the same transport allocation, RPC calls, cache keys,
TTL, invalidation, payloads, and asynchronous fanout. Dependency injection adds
only two property lookups in the existing store paths; the compatibility subclass
adds no transport or background work. There are no new network requests, blocking
filesystem operations, timers, listeners, or unbounded loops. Browser profiling
and live-server latency were not measured; no performance improvement is claimed.
