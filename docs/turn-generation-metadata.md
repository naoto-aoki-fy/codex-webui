# Per-turn generation metadata

Product guarantees: [CAP-003 Historical Response Metadata](product-requirements.md#cap-003-historical-response-metadata).
This document owns current model/effort recovery implementation details.

Codex-generated rollout JSONL is the source of historical model and reasoning
metadata. Parsed results are persistently cached on the App Server host. The
application no longer records settings from turn submissions, RPC responses, or
notifications into a separate persistent metadata store. It no longer copies
metadata between source and forked conversations.

## Read and write path

1. `AppServerClient.rpc` observes content-bearing `thread/read`, `thread/resume`,
   `thread/fork` and `thread/turns/list` results. It starts optional asynchronous
   recovery through `RolloutGenerationMetadata.recover(threadId)`.
2. The reader calls `thread/read` with `includeTurns: false` to resolve the native
   rollout path, checks that it is a normalized absolute path under the resolved
   Codex home's `sessions/YYYY/MM/DD/` or `archived_sessions/`, and calls `fs/getMetadata`.
3. It reads `<remote CODEX_HOME>/cache/model-history/v1/<sha256(threadId)>.json`
   through `fs/readFile`. Version 1, source path, positive modification timestamp,
   exact turn IDs and execution provenance must validate before reuse.
4. On a miss or changed timestamp it reads the rollout through `fs/readFile` and
   parses complete `turn_context` rows. Only exact `payload.turn_id` values are
   used. Model and effort are independent; missing fields stay unknown, null
   means unspecified, and `none` is a real effort value. Conflicting duplicates
   suppress the conflicting field. A second source stat prevents caching a
   snapshot observed changing during the read.
5. `fs/createDirectory` and `fs/writeFile` persist only the compact parsed cache.
   Original rollouts are never written, deleted or modified. Unknown timestamps
   cannot validate or persist a cache. Explicit refresh bypasses cached data.
6. The client emits `turn/generationMetadata` only for requested exact turn IDs.
   `useDesktopState` merges this evidence into history/live messages; the V2
   normalizer and `ThreadConversation` retain the per-response display. No
   currently selected model or effort substitutes for missing history.

Missing paths, malformed rows, unsupported filesystem APIs, denied reads and cache
write failures do not block conversation loading. A restart validates and reuses
an unchanged persistent cache without transferring the original rollout again.
The pinned metadata API exposes mtime but no file length: changes preserving the
same timestamp require explicit refresh. This limitation is unchanged.

## Forks and existing data

Native Fork and Fork and Revert use each destination's own rollout/cache. No
parent lookup, transcript matching or custom metadata inheritance remains. If
native fork/revert output lacks inherited `turn_context` rows with matching IDs,
those responses show unknown metadata; their content remains visible. Portable
Fork and existing imported transcripts remain in `ConversationTransferService`;
imported transcript attribution does not become execution metadata.

Old `$CODEX_HOME/codexapp-turn-metadata/` stores are left untouched. They are no
longer read or written, and are never relabeled as rollout-derived cache entries.
The shared metadata value/provenance/label helpers remain for normalization and
UI compatibility. Old browser fresh-fork/recovery keys are not deleted. A legacy
recovery draft can still be read by the composer, but new fresh-fork state is not
created. Ordinary drafts and ambiguous-send protection remain active.

## Performance and verification

Recovery coalesces concurrent reads, serializes source transfers and admits at
most 16 queued threads. Bounds remain 16 MiB per source, 2 MiB per cache, 10,000
turn IDs and 512 characters per field. No session traversal, per-message RPC,
source-to-fork history read, synchronous filesystem work or new request fanout is
introduced. Native metadata-only pagination does not trigger rollout recovery.
Notifications do not invalidate the history index merely to update labels.

The fixture verifies seven cold RPCs and three warm/restarted RPCs, with exactly
one source transfer across cold plus restart. It also covers append invalidation,
explicit refresh, changing-source rejection, read failures, malformed records,
thread isolation, revert-shaped replacement data and rejection of request-derived
cache values. Run `pnpm exec vitest run src/server/rolloutGenerationMetadata.test.ts
src/server/turnGenerationMetadata.test.ts`. These are protocol fixtures, not proof
of live provider execution or fork rollout behavior on every server version.

## Remote home discovery

The connection/profile-scoped resolver starts empty. After the handshake it
validates and caches `initialize.result.codexHome`, the server's effective home
including its default directory. WebUI's `CODEX_HOME` is never a source for this
remote path. Home-dependent operations wait for initialization before deciding
whether discovery is needed. The initialization helper only waits and applies
metadata; it never invokes home resolution or config discovery.

If handshake metadata is missing or invalid, successful existing `thread/read`
responses can supply the home from native session/archive paths, including custom
directory names.
When a consumer still needs an unresolved home, concurrent demands share one
`config/read` with `includeLayers: true`. Only the base user layer (null or
legacy omitted profile) supplies its config file's parent directory; no local
file existence check is performed. POSIX, Windows and UNC rules follow the
remote path. Unsuccessful discovery can retry on later demand.

The first resolved value survives for the connection/profile lifetime, including
when a thread response wins a race with configuration discovery. Reconnection or
profile changes clear the cache, apply the new connection's initialization
metadata, and retire in-flight results. Initialization metadata is applied before
normal and internal thread reads, including subscription recovery.
Uploads share this resolver unless `CODEXUI_REMOTE_UPLOAD_DIR` explicitly overrides
the destination. WebUI-local state storage remains separate. See the
[discovery checks](../tests/website-docs-misc/codex-home-discovery.md).
