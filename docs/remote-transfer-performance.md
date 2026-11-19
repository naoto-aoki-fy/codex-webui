# Remote transfer budgets and fixture benchmark

Run `pnpm exec vitest run src/server/remoteTransfers.benchmark.test.ts --reporter=verbose --disableConsoleIntercept`. This is a credential-free in-process transport fixture with a synthetic 2 ms delay per RPC, **not a real WAN benchmark**. Results vary by CPU and scheduling. The baseline models uncached file reads.

Representative run (Node on Linux):

| Fixture | Baseline RPCs / response bytes / elapsed | Result RPCs / response bytes / elapsed |
| --- | --- | --- |
| 8 MiB file, five sequential accesses | 10 / 55,924,575 / 244.1 ms | 6 / 11,185,259 / 55.0 ms |

Afterward the file cache retains 8,388,608 bytes and one entry. These are explicit cache occupancy measurements, not process RSS. Peak Base64 decoding/JSON allocations and live WAN latency have not been measured.

## Supported protocol and boundaries

The installed pinned `codex-cli 0.167.2` generates the authoritative client schema with:

```sh
node_modules/.bin/codex app-server generate-json-schema --experimental --out /tmp/codexapp-r7-schema
```

`FsReadFileParams` contains only `path`; `FsGetMetadataResponse` has timestamps and type flags, but no length. Consequently cold HEAD, cold ETag checks, and cold browser Range requests still transfer the **entire file from B to A**. Browser 206 responses do not imply upstream ranged transfer. `If-Modified-Since` and `If-None-Match: *` can use sufficient fresh metadata without downloading bytes. Warm HEAD, ETag and Range requests reuse bytes after metadata validation.

File reads coalesce up to 64 distinct active reads, with explicit retryable busy errors above that limit. The cache is bounded to 16 MiB / 32 entries and a two-second TTL; larger files are not retained. Every HTTP access fetches metadata, and a changed timestamp invalidates cached bytes. Unknown/zero modification timestamps disable byte reuse. Timestamp-preserving edits can remain cached for at most two seconds. Disconnect changes the generation, clears cached/pending ownership and rejects late responses; each client instance belongs to one explicit profile. Remote images require browser revalidation to prevent a reused path URL retaining another profile's image.

## Native history request budget

The bridge requests thread metadata and one ten-turn content page on open.
Each earlier page takes a single `thread/turns/list` call. The CLI and dev
transport fixture verifies the opaque cursor and two content-page requests.
Historical response metadata recovery can make separate metadata and filesystem
requests. Normal
history loads have no metadata scan or WebUI page cache. Revert may page through
turn IDs to validate an explicit cutoff. Portable Fork and native response fork
verification may transfer complete source history.

## Live measurement

The fixture does not measure WAN latency, the App Server's own history work or
process memory. For a two-host measurement, record App Server RPC counts and
bytes, WebUI response latency and memory, and repeat after editing files, adding
turns, reconnecting and switching connection profiles.
