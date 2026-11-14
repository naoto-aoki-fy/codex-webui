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
turn ID. Submitted-setting enrichment adds no RPCs. Remote rollout recovery is
lazy and asynchronous. Forking reads the source once and copies
metadata into the fork's sidecar (response-cutoff forks reuse the source snapshot
already read for cutoff validation): exact turn IDs first, then unique item IDs,
then unique complete text transcripts bounded to 256 KiB per turn. Ambiguous
matches remain unknown. New fork turns have independent entries. Existing forks
can recover their own rollout evidence by exact turn ID; undocumented parent
fields are never used.

## Legacy import

Legacy unscoped sidecars have no server identity. They are ignored unless an
operator explicitly binds them to the known original server with **both**:

- `CODEXUI_LEGACY_METADATA_SERVER_URL`: exact normalized URL (including trailing
  slash for a WebSocket root, e.g. `ws://127.0.0.1:4500/`).
- `CODEXUI_LEGACY_METADATA_CODEX_HOME`: exact remote initialization home value.

Keep these settings only for the intended legacy server. Legacy and current
records merge field by field; execution evidence cannot be overwritten by settings.
Historical recovery also works without these sidecars; see below.

## Remote rollout execution evidence

Requested history pages schedule recovery over the existing App Server transport.
The backend calls `thread/read` with `includeTurns: false` and validates the
returned absolute `thread.path`. Only normalized POSIX or Windows paths matching
`sessions/YYYY/MM/DD/rollout-*.jsonl` are supported. The inferred remote home must
match initialization `codexHome` when supplied. No local HOME/session lookup,
SSH, command execution, additional connection, or startup-wide scan is used.

`fs/getMetadata` and `fs/readFile` read that remote file. Complete JSONL rows of
exactly `type: "turn_context"` supply `payload.turn_id`, `model`, and `effort`.
Only exact nonempty turn IDs correlate; timestamps and nearby messages never do.
Malformed and incomplete trailing rows are ignored. Identical duplicate fields
agree; conflicting values suppress that field for the entire turn. Missing fields
remain absent, null remains explicit unspecified, and `none` remains a value.
Each recovered field has execution provenance and outranks submitted settings
independently. No composer values are used. Existing metadata notifications update
only requested turn IDs without reloading conversation items or adding UI labels.

The separate remote cache is
`<REMOTE_CODEX_HOME>/cache/model-history/v1/<sha256(threadId)>.json`.
It contains only schema version, source path, source `modifiedAtMs`, and turn IDs
with model/effort evidence. Reads/writes/directory creation use filesystem RPCs;
original rollouts and backend-local sidecars are never modified by recovery.
Every recovery checks the source mtime. A matching schema/path/positive finite
mtime reuses the compact cache without reading the rollout. Changed sources,
invalid caches, or explicit refresh regenerate it. Source metadata is checked
again after a full read; a changed source is neither published nor persisted.
Unknown/zero timestamps allow uncached evidence but never validate/persist a cache.
**Refresh history** also forces regeneration via the backend-only
`thread/generationMetadata/refresh` RPC. It is not forwarded to Codex.

Concurrent thread requests coalesce. One recovery runs at a time with at most
16 pending jobs, each scoped to the transport generation. Late results cannot
cross a reconnect. Cache storage is on the remote host and survives backend
restarts; no rollout contents are retained in memory after recovery. Unsupported
methods, missing paths, permission/read errors quietly retain existing metadata;
cache write errors still permit evidence for the current request. Concurrent
backend processes may redundantly read/write the same cache; malformed partial
cache writes are treated as misses on the next request.

Limits: 16 MiB decoded source, 2 MiB compact cache, 10,000 turns, 256-character
turn IDs, and 512-character field values. The pinned metadata API has no file
size and `fs/readFile` returns the whole Base64 response. The transfer therefore
cannot be bounded before receipt; over-budget responses are rejected before
Base64 decoding. Large rollouts need upstream size/ranged-read support for
bounded transfer. Initial source reads can hold the single worker until the
existing RPC deadline; history loading itself does not wait. No automatic retry
loop or per-message file fanout is introduced. Cache hits cost three RPCs
(metadata-only thread read, source stat, compact cache read); cold successful
recovery normally costs seven including the cache miss and write. Each page
revalidates; native metadata-only index pages do not trigger recovery.

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

Remote recovery fixture audit in this workspace: concurrent cold recovery plus a
new service instance's cache hit took 4.01 ms for two turns. The source was 230
UTF-8 bytes (308 Base64 bytes), compact cache 331 bytes (444 Base64 bytes), with
one source read and ten total RPCs (seven cold, three warm). Assertions verify
these counts and no history-index invalidation on metadata notifications. These
are in-process fixtures, not WAN timing. Full suite and entry-point integration
cover normal loading; authenticated two-host latency, actual large-rollout peak
memory, filesystem API availability, and real per-turn IDs still need live checks.
