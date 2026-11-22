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
3. WebUI creates version 2 files under its local cache root at
   `app-servers/<sha256(ID)>/model-history/v2/<sha256(threadId)>.json`.
   The schema stores the validated rollout snapshot and accepted modes separately.
   When the preferred file is missing, WebUI checks `model-history/v1/` for the
   same filename and continues using a version 2 file there in place. A version 1
   file retains its original bytes. New snapshots come from a validated rollout.
4. The parser reads complete `turn_context` records for model, effort and
   `payload.collaboration_mode.mode`, and `event_msg` records with
   `payload.type = "task_started"` for `payload.collaboration_mode_kind`.
   All fields use exact `payload.turn_id` values. Model and effort are independent.
   Null means unspecified effort and `none` is a recorded value. Conflicting
   values suppress the affected field. Conflicting modes explicitly clear an
   existing badge. A second source stat checks that the rollout stayed stable.
5. After Codex accepts `turn/start` with an explicit mode, the bridge makes a
   best-effort write keyed by the returned turn ID before acknowledging the send.
   Cache updates serialize, check the destination version under the write lock,
   and atomically replace version 2 files. An existing legacy, unsupported, or
   unreadable format is preserved. Validated
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

After the WebSocket send succeeds, WebUI can confirm a reply from the matching
`rawResponseItem/completed` function result. On the default event stream, WebUI
checks a fresh rollout snapshot after a successful terminal event. If the file
changes during the read, WebUI retries once within the same deadline. Both paths
require exact connection, thread, turn, tool call ID and answer values. Question
IDs are compared independently of their object order, and values for each
question must match in order. The bridge consumes raw question results before
notification delivery and diagnostic buffering.

The initial deadline covers sending the reply and native request closure. Once
both occur, the attempt stays in memory until an exact raw result or a terminal
event arrives. Successful completion starts a fresh deadline for the rollout
check. Interruption, failure, disconnect, rollback and deletion retire
unconfirmed attempts. Archive, thread closure and unsubscribe also settle an
attempt if it was still waiting for the terminal event. They let an already
completed turn finish its bounded rollout check. After closure the conversation
shows a read-only draft if it contains changes or a reply was sent or could have
been sent. The user can dismiss it during confirmation. The composer restores
**Stop** while the turn runs and the sidebar clears its pending-question indicator.

WebUI saves ordered, redacted records under
`app-servers/<sha256(ID)>/question-responses/<sha256(threadId)>.json`
in the profile data directory. Each record has the native turn ID and a stable
response ID. Private answers retain only a boolean indicating whether an answer
was provided. A confirmed answer remains visible with a warning when the local
write fails. Unconfirmed replies retain their draft in memory through navigation,
panel replacement and reconnect in the same tab. Retry is available when the
bridge establishes the frame never entered the socket and the question is still
pending. Confirmation, dismissal, deletion and profile teardown clear the draft.
Dismissal clears the local draft immediately. A later confirmation still saves
the redacted answer to history.

Existing history responses contain only records for their page or retained turn
IDs. The browser merges these with submission and completion records, by ID.
The renderer uses the preceding native item, then submission time, then the end
of the turn for placement. Saved answers stay in the originating thread and its
archive, and the bridge removes them when it observes permanent deletion.

## Performance and verification

Recovery coalesces compatible same-thread reads, serializes source transfers and
admits up to 16 metadata threads with one extra slot for reply confirmation.
Confirmation runs ahead of waiting metadata reads. Bounds remain 16 MiB per source, 2 MiB per cache, 10,000
turn IDs and 512 characters per field. Local recovery coalesces asynchronous cache
lookups. A missing preferred file adds one local lookup of the legacy path.
For submissions, WebUI checks whether the preferred file exists before
reading its contents under the write lock.
Existing metadata notifications carry the recovered evidence. No session traversal, per-message RPC,
source-to-fork history read, synchronous filesystem work or new request fanout is
introduced. Native metadata-only pagination does not trigger rollout recovery.
The reply retry adds at most one file read and one file stat for a changing
snapshot. Stable reads and metadata-only recovery keep their existing RPC counts.
Answer history reads one profile/thread file asynchronously, filters by exact turn
IDs before serialization and uses the existing native page. File read and write
cost grows with the number of saved answers in that thread.

The fixtures compare cold and warm RPC counts and cover legacy file byte preservation,
in-place reuse of version 2 files, concurrent writes, accepted mode without rollout access, conflicting evidence,
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
