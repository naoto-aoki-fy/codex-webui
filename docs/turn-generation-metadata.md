# Per-turn generation metadata

Product guarantees: [CAP-003 Historical Response Metadata](product-requirements.md#cap-003-historical-response-metadata).
Codex rollout JSONL supplies historical model, reasoning effort and collaboration
mode by exact turn ID. The WebUI cache is scoped to the App Server profile and
thread. Accepted WebUI submissions can also supply an explicit collaboration mode.

## Read and write path

1. Content-bearing thread reads, resumes, forks and turn pages start asynchronous
   recovery. On reconnect, the same history request carries IDs for locally
   retained older pages. The bridge uses those IDs to scope recovery and strips
   them before calling Codex. The bridge reads submitted modes from the local
   profile cache independently of the rollout queue. Overlapping history pages
   share the local read and receive only their exact or retained IDs.
2. The reader resolves and validates the native rollout path under the Codex
   home's session or archive directory, then checks its modification timestamp.
   It validates the cached source path, timestamp, exact turn IDs and execution
   provenance before reuse.
3. The cache stays at
   `app-servers/<sha256(ID)>/model-history/v1/<sha256(threadId)>.json`.
   Its version 2 schema stores the rollout snapshot and submitted modes separately.
   A version 1 cache is rescanned for mode evidence when a rollout is available.
4. The parser reads complete `turn_context` records for model, effort and
   `payload.collaboration_mode.mode`, and `event_msg` records with
   `payload.type = "task_started"` for `payload.collaboration_mode_kind`.
   All fields use exact `payload.turn_id` values. Model and effort are independent.
   Null means unspecified effort and `none` is a recorded value. Conflicting
   values suppress the affected field. Conflicting modes explicitly clear an
   existing badge. A second source stat checks that the rollout stayed stable.
5. After Codex accepts `turn/start` with an explicit mode, the bridge makes a
   best-effort write keyed by the returned turn ID before acknowledging the send.
   Cache updates serialize and atomically replace the local file. Validated
   rollout mode supersedes submitted mode, and contradictory or conflicting
   evidence removes the submitted fallback. A pending local read skips turns
   superseded by newer submission or execution evidence.
6. `turn/generationMetadata` carries exact-turn evidence for the requested or
   retained turns. Prompt bubbles render a badge for Plan mode. The optimistic
   badge starts with the sent mode, transfers to the acknowledged turn ID and
   clears when the submission cannot be confirmed. Assistant metadata and
   timestamps continue to use their established evidence.

An available accepted mode can be recovered across a backend restart while the
remote rollout is blocked, unavailable or queued. Unchanged valid rollout
caches skip the remote source transfer.
An unknown mtime cannot validate or cache rollout evidence. Explicit refresh
rereads the source, including when a change preserves the recorded mtime. Missing
paths, malformed rows and local cache failures leave native history available.

## Forks and existing data

Native Fork and Fork and Revert use each destination's own rollout/cache. No
parent lookup, transcript matching or custom metadata inheritance remains. A destination displays the mode and response metadata supported by its own exact-turn rollout evidence. Portable
Fork and existing imported transcripts remain in `ConversationTransferService`;
imported transcript attribution does not become execution metadata.

Old `$CODEX_HOME/codexapp-turn-metadata/` stores are left untouched. They are no
longer read or written, and are never relabeled as rollout-derived cache entries.
The shared metadata value/provenance/label helpers remain for normalization and
UI compatibility. Old browser fresh-fork/recovery keys are not deleted. A legacy
recovery draft can still be read by the composer, but new fresh-fork state is not
created. Ordinary drafts and ambiguous-send protection remain active.

## Saved question responses

WebUI confirms a reply after the WebSocket send succeeds and Codex emits a
`rawResponseItem/completed` function result with the same connection, thread,
turn, tool call ID and answers. Question IDs are compared independently of their
object order, and values for each question must match in order. Native request
closure can precede the result or occur during cancellation. The bridge consumes
question results before notification delivery and diagnostic buffering.

WebUI saves ordered, redacted records under
`app-servers/<sha256(ID)>/question-responses/<sha256(threadId)>.json`
in the profile data directory. Each record has the native turn ID and a stable
response ID. Private answers retain only a boolean indicating whether an answer
was provided. A confirmed answer remains visible with a warning when the local
write fails. Unconfirmed replies retain their draft in memory through navigation,
panel replacement and reconnect in the same tab. Retry is available when the
bridge establishes the frame never entered the socket and the question is still
pending. Confirmation, dismissal, deletion and profile teardown clear the draft.

Existing history responses contain only records for their page or retained turn
IDs. The browser merges these with submission and completion records, by ID.
The renderer uses the preceding native item, then submission time, then the end
of the turn for placement. Saved answers stay in the originating thread and its
archive, and the bridge removes them when it observes permanent deletion.

## Performance and verification

Recovery coalesces concurrent reads, serializes source transfers and admits at
most 16 queued threads. Bounds remain 16 MiB per source, 2 MiB per cache, 10,000
turn IDs and 512 characters per field. Local recovery adds an asynchronous,
coalesced cache read and uses existing metadata notifications. No session traversal, per-message RPC,
source-to-fork history read, synchronous filesystem work or new request fanout is
introduced. Native metadata-only pagination does not trigger rollout recovery.
Answer history reads one profile/thread file asynchronously, filters by exact turn
IDs before serialization and uses the existing native page. File read and write
cost grows with the number of saved answers in that thread.

The protocol fixtures compare cold and warm RPC counts and cover cache upgrade,
concurrent writes, accepted mode without rollout access, conflicting evidence,
profile isolation, reconnect recovery and older pages. See the
[Plan-mode and metadata checks](../tests/chat-composer-rendering/per-response-model-and-reasoning-effort.md)
and [question history checks](../tests/theme-layout-terminal/plan-mode-question-panel.md#answer-history).

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
Uploads resolve the home before any remote filesystem mutation. They reuse a
known home and request `config/read` when discovery is needed. Unknown homes
block uploads. See the
[discovery checks](../tests/website-docs-misc/codex-home-discovery.md).
