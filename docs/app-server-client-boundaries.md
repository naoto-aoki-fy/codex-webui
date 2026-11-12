# App-server client ownership

`src/server/appServerClient.ts` owns one transport per client, monotonic RPC IDs,
pending calls and approval handles, notification listeners, connection generations,
reconnect, subscribed thread IDs, auth-refresh single-flight, stream buffers,
snapshots and earlier-page caching. Construction does not connect. The bridge's
zero-argument `AppServerClient` subclass injects its attachment-only thread index;
the core never imports the bridge.

The bridge owns HTTP routing, archive/materialization fallback, history shaping,
search and shared runtime leases. Middleware release is idempotent and identity-safe;
the last owner disposes the shared client and active SSE requests. Matching runtime
versions reuse the shared object on hot reload; incompatible versions replace it.
The transport never owns the independently managed Codex process.

Disconnect rejects pending RPCs, clears approvals/events/snapshots/page caches,
advances connection generation and schedules reconnect. Obsolete socket replies
cannot settle new calls. Subscription restoration runs sequentially with
`excludeTurns: true`, reports per-thread failures and never gates unrelated RPCs.
Application operations are never automatically replayed. Ordinary calls have a
default 60-second caller deadline; standalone commands default to 600 seconds. Deadlines
release pending ownership without cancelling remote work: outcomes can be unknown.
See [connection settings and recovery](external-app-server.md).

Earlier-page reads share in-flight work and a 30-second cache. Promise identity,
connection generation and invalidation protect publication; snapshot epochs prevent
stale RPC results from repopulating invalidated snapshots. Stream history is bounded
at 400 frames per thread, not globally. These buffers merge execution errors into
history; they are not a browser replay API.

Generation metadata is persisted by `turnGenerationMetadata.ts`, scoped to server
endpoint and remote Codex home. Submitted values are distinguished from execution
evidence; fork inheritance is best-effort. See [generation metadata](turn-generation-metadata.md)
for provenance, legacy opt-in and storage compatibility.

Lifecycle tests live in `src/server/appServerClient*.test.ts`,
`src/server/bridgeSse.test.ts`, and `src/server/sharedBridgeOwnership.test.ts`.
Remaining resource and deployment concerns belong in [open items](maintenance/open-items.md).
