# App-server project file reads

The reference development and integration version is **@openai/codex@0.167.2**
(upstream tag `rust-v0.167.2`). It is pinned as a development dependency, not
installed or launched by the production backend. Deployment must independently
provide a compatible app server at `CODEXUI_APP_SERVER_URL`; an existing server is
not assumed to run this version.

`pnpm run generate:project-file-protocol` verifies the exact CLI version and runs
`codex app-server generate-ts --experimental`, retaining the filesystem and
initialization type slice under `src/server/protocol/0.167.2/`. These files were
generated with that executable, not handwritten from the proposal. Upstream:
https://github.com/openai/codex/tree/rust-v0.167.2/codex-rs/app-server-protocol

## Ownership and compatibility

`ProjectFileService` uses the bridge's existing shared `AppServerClient`. Both
Vite and production HTTP receive that same service. `/codex-local-browse/...`,
`/codex-local-image?path=...`, and `/codex-local-directories?path=...` now read
project files exclusively using `fs/getMetadata`, `fs/readFile`, and
`fs/readDirectory`. Skill links using these endpoints follow the same boundary;
other skill-loading routes have not been migrated. Absolute paths belong to the
app server, with POSIX/Windows lexical rules selected from the path rather than
the Web host. Canonicalization is deferred.

The client requests `experimentalApi: true`. Initialization metadata is retained
for the current connection and cleared on disconnect; `codexHome` is not treated
as a user home directory. RPC errors preserve `code` and `data`. Unsupported
methods fail explicitly (HTTP 502), with no local fallback. Missing files map to
404 and permission failures to 403 using error messages because filesystem RPC
errors do not provide portable errno fields. Other failures remain 502 rather
than masquerading as missing files or empty directories. There is no startup
capability probe; support is established by the actual operation.

Web-generated inline images use `/codex-app-asset?id=...`, restricted to filenames
inside the Web-owned inline-media cache. Project paths never enter that branch.
Previously generated path-based inline-image URLs must be regenerated from the
original inline payload; arbitrary local-path compatibility is intentionally not
provided. Uploads remain deferred: an upload stored only on the Web host is not
readable through the migrated project endpoints when the hosts differ.

## HTTP and performance

HEAD, single byte ranges (including suffix/open-ended ranges), MIME types, ETag,
Last-Modified, conditional GET, and If-Range are supported. Directories are not
served as files. Malformed/multiple ranges are ignored. File reads are complete
Base64 transfers, including HEAD, ranges, and conditional requests: metadata has
no size, and a content ETag requires the bytes. This is not streaming or efficient
remote range access. Base64 adds approximately 33% to the wire payload; the JSON
string and decoded Buffer coexist in memory. Concurrent large requests multiply
that cost. There is no pre-read size limit or persistent file cache.

The directory picker performs two sequential RPCs (metadata plus immediate
children), independent of entry count; it does not request metadata per entry.
File requests perform metadata plus one read. No recursive traversal, blocking
filesystem calls, additional connection, automatic replay, unbounded request
fanout, or cache invalidation machinery is introduced. Concurrent browser calls
are not coalesced. These request counts are asserted by the HTTP fixture test;
large-file RSS, latency, and remote-network throughput have not been benchmarked.

## Verification

- `pnpm run test:unit`: mocked adapter, remote-only in-memory HTTP fixtures through
  production and Vite mounts, connection lifecycle, and application regressions.
  The remote-only fixture paths do not exist on the Web host.
- `pnpm run typecheck` and `pnpm run build`.
- `pnpm run test:integration:fixture`: credential-free existing bridge fixture.
- `pnpm run test:integration:project-files:live`: opt-in real pinned CLI, isolated
  temporary CODEX_HOME and loopback WebSocket, filesystem RPCs and HTTP range response.
  It requires Unix and the development dependency; it does not use account
  credentials, run turns, or touch the configured deployment server.

The real local CLI test is not proof of deployment compatibility or a physically
separate host. Before deployment, repeat the manual remote-host checks below
against the independently managed target server. Uploads, Git/search, workspace
creation, watchers, Undo/Redo and remaining filesystem consumers are deferred.

## Implementation verification result

The pinned CLI generated the checked-in types successfully. The opt-in live test
passed against a fresh `codex-cli 0.167.2` process over a loopback WebSocket,
including fs/createDirectory and fs/writeFile for fixture setup, fs/readFile,
fs/getMetadata, fs/readDirectory, initialization environment metadata, HTTP range
serving and missing-file status. No model turn or credentials were required.
The initially attempted Unix-socket test was rejected by the CLI's socket-directory
ownership validation in this environment; this run verifies WebSocket transport.
The configured deployment server and a physically separate host were not tested.
