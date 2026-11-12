# Per-turn generation metadata

The web backend records the settings from an accepted `turn/start` response,
keyed by thread ID and the returned turn ID. These are **submitted settings**,
not proof of the model or reasoning effort that executed. The UI marks them
`(sent setting)`. Execution evidence, when explicitly supplied with provenance,
takes priority independently for each field. Missing values remain unknown;
explicit null means unspecified, and `none` is an explicit effort value.

## Storage and recovery

Backend-local storage uses
`$CODEX_HOME/codexapp-turn-metadata/<server-hash>/<thread-hash>.jsonl`
(default local home: `~/.codex`). The server hash covers the normalized connection
URL and the external server's documented initialization `codexHome` value. The
remote home is identity data only: the backend never opens remote session paths
on its own filesystem. Keep this local storage when restarting the web backend.
A changed connection URL or remote home intentionally gets a separate namespace.
The protocol provides no server instance UUID; replacing a server behind the same
URL and home cannot be distinguished automatically.

Sidecars use the legacy `{turnId, metadata}` row shape. Writes are serialized
within the process and locked across backend processes, append complete rows,
and sync before returning the successful RPC. A storage failure emits a backend
warning but never rejects or retries the accepted submission. Crashes between
remote acceptance and local persistence remain a recovery gap; the protocol has
no transaction spanning the two systems. Native Codex session logs are untouched.

History read/resume and older-page snapshots merge sidecar evidence by exact
turn ID. Normal loading adds no RPCs. Forking reads the source once and copies
metadata into the fork's sidecar (response-cutoff forks reuse the source snapshot
already read for cutoff validation): exact turn IDs first, then unique item IDs,
then unique complete text transcripts bounded to 256 KiB per turn. Ambiguous
matches remain unknown. New fork turns have independent entries. Existing forks
without saved evidence cannot be reconstructed from undocumented parent fields.

## Legacy import

Legacy unscoped sidecars have no server identity. They are ignored unless an
operator explicitly binds them to the known original server with **both**:

- `CODEXUI_LEGACY_METADATA_SERVER_URL`: exact normalized URL (including trailing
  slash for a WebSocket root, e.g. `ws://127.0.0.1:4500/`).
- `CODEXUI_LEGACY_METADATA_CODEX_HOME`: exact remote initialization home value.

Keep these settings only for the intended legacy server. Legacy and current
records merge field by field; execution evidence cannot be overwritten by settings.
Older raw `turn_context` records are not scanned: there is no documented per-turn
execution-metadata RPC, and local paths need not refer to the App Server host.
Without scoped records, explicitly bound legacy evidence, or attributed metadata
in a response, historical footers correctly stay unknown.

## Bounds and performance

A sidecar read allocates at most 4 MiB; larger files are ignored, and appends
past that limit fail with a warning without failing the turn. Malformed and
incomplete rows are ignored independently. At most eight parsed sidecars are
cached; file inode/size/mtime/ctime invalidate them, including cross-process
updates. There is no retained session text. History merging is linear in the
returned turn count. Reads do not fan out across messages. Streaming deltas
write nothing. Each accepted turn adds one locked append and file sync; a fork
adds one source history request and one batched append.

Automated tests in `src/server/turnGenerationMetadata.test.ts` measure cold
2,000-turn enrichment and a cached page without network calls. Frontend state
recreation tests cover completed and active refresh recovery; they are fixture
checks, not authenticated browser or real Codex verification.

Measured in this workspace: 2,000-turn cold enrichment took 20.08 ms and a cached
10-turn page took 2.55 ms during the full suite; an isolated run measured
12.05 ms / 1.82 ms. These are local fixture measurements, not live-server latency
or browser rendering profiles. No extra RPCs were made in either enrichment path.
