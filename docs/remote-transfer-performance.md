# Remote transfer budgets and fixture benchmark

Run `pnpm exec vitest run src/server/remoteTransfers.benchmark.test.ts --reporter=verbose --disableConsoleIntercept`. This is a credential-free in-process transport fixture with a synthetic 2 ms delay per RPC, **not a real WAN benchmark**. Results vary by CPU and scheduling. The baseline models the historical uncached file/full-history transfer path; this benchmark does not claim all intermediate releases lacked history coalescing.

Representative run (Node on Linux):

| Fixture | Baseline RPCs / response bytes / elapsed | Result RPCs / response bytes / elapsed |
| --- | --- | --- |
| 8 MiB file, five sequential accesses | 10 / 55,924,575 / 244.1 ms | 6 / 11,185,259 / 55.0 ms |
| 1,000 turns with 4 KiB items, recent + three older pages | 4 / 16,715,704 / 63.0 ms | 6 / 241,227 / 16.4 ms |

Afterward the file cache retains 8,388,608 bytes and one entry; history retains a 23,927-byte index and one entry. These are explicit cache occupancy measurements, not process RSS. Peak Base64 decoding/JSON allocations and live WAN latency have not been measured.

## Supported protocol and boundaries

The installed pinned `codex-cli 0.167.2` generates the authoritative client schema with:

```sh
node_modules/.bin/codex app-server generate-json-schema --experimental --out /tmp/codexapp-r7-schema
```

`FsReadFileParams` contains only `path`; `FsGetMetadataResponse` has timestamps and type flags, but no length. Consequently cold HEAD, cold ETag checks, and cold browser Range requests still transfer the **entire file from B to A**. Browser 206 responses do not imply upstream ranged transfer. `If-Modified-Since` and `If-None-Match: *` can use sufficient fresh metadata without downloading bytes. Warm HEAD, ETag and Range requests reuse bytes after metadata validation.

File reads coalesce up to 64 distinct active reads, with explicit retryable busy errors above that limit. The cache is bounded to 16 MiB / 32 entries and a two-second TTL; larger files are not retained. Every HTTP access fetches metadata, and a changed timestamp invalidates cached bytes. Unknown/zero modification timestamps disable byte reuse. Timestamp-preserving edits can remain cached for at most two seconds. Disconnect changes the generation, clears cached/pending ownership and rejects late responses; each client instance belongs to one explicit profile. Remote images require browser revalidation to prevent a reused path URL retaining another profile's image.

`thread/turns/list` really exists in the pinned experimental schema. Native history reads use metadata-only `thread/read`, an `itemsView: notLoaded` index scan, and `itemsView: full` pages. The index scan is necessary because upstream pages have neither total turn count nor absolute turn indices, while the UI's fork controls require exact positions. This costs additional requests but avoids transporting every conversation item's body. Older pages continue with actual opaque cursors; arbitrary boundaries seek with metadata-only pages. There is no invented cursor or local-slicing claim of native pagination.

Index work is bounded to 100 pages of at most 1,000 turns and 16 MiB, with at most 16 concurrent/retained thread indexes. Exceeding a budget produces an actionable error. Indexes expire after two seconds and invalidate on thread notifications, recovery and disconnect; stale work stops before additional requests. Only explicit JSON-RPC `-32601` enables the legacy fallback; timeouts, permissions and malformed responses remain errors. Legacy full-history fallback coalesces reads with a 30-second cache, bounded to 16 entries / 32 MiB aggregate; fallback snapshots have the same count and byte bounds. Native pages preserve locally saved generation metadata.

Direct `thread/resume` and fork/revert validation paths can still hydrate full history. Servers without native turn pagination use full upstream transfers and local history slicing. No mutation is retried by these caches. Reconnecting clears ownership; cached data never crosses a client generation or explicit profile.

## Live measurement still required

On disposable two-host data, record B-side RPC counts and bytes, A-side request latency and RSS while opening an 8 MiB file repeatedly, sending conditional/HEAD/Range requests, and paging a long thread. Confirm actual server response formats and method availability. Repeat after editing files, adding turns, reconnecting, and restarting A with another profile using the same forwarding URL. Do not present fixture timings as WAN evidence.
