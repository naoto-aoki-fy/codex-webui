# App-server client ownership

`src/server/appServerClient.ts` owns one transport per client, monotonic RPC IDs,
pending calls and approval handles, notification listeners, connection generations,
reconnect, subscribed thread IDs, stream buffers,
snapshots and earlier-page caching. Construction does not connect. The bridge
uses the same client for native calls and reconnection.

The bridge owns HTTP routing, archive/materialization fallback, history shaping,
search and shared runtime leases. Middleware release is idempotent and identity-safe;
the last owner disposes the shared client and active SSE requests. Matching runtime
versions reuse the shared object on hot reload; incompatible versions replace it.
The transport never owns the independently managed Codex process.

Disconnect rejects pending RPCs, clears approvals, events and snapshots,
advances connection generation and schedules reconnect. Obsolete socket replies
cannot settle new calls. Subscription restoration runs sequentially with
`excludeTurns: true`, reports per-thread failures and never gates unrelated RPCs.
Application operations are never automatically replayed. Ordinary calls have a
default 60-second caller deadline; native command RPCs default to 600 seconds. Deadlines
release pending ownership without cancelling remote work: outcomes can be unknown.
See [connection settings and recovery](external-app-server.md).

Earlier pages are direct native RPCs using `thread/turns/list`. The bridge uses
snapshot epochs to prevent stale detail replies from replacing recovery snapshots.
The 400-frame per-thread stream buffer supplies recent execution errors for
history rendering.

Historical generation metadata comes only from the rollout reader and persistent
remote rollout cache. Runtime settings recording and source-to-fork inheritance
are removed. Unsupported external token refresh returns an explicit protocol
error; no credential read, refresh coordination or success lifecycle remains.
See [generation metadata](turn-generation-metadata.md).

Lifecycle tests live in `src/server/appServerClient*.test.ts`,
`src/server/bridgeSse.test.ts`, and `src/server/sharedBridgeOwnership.test.ts`.
Remaining resource and deployment concerns belong in [open items](maintenance/open-items.md).
