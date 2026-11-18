# External Codex App Server, including SSH tunnels

## Ownership and startup

Machine A runs the web UI and Node backend. Machine B runs an independently
managed Codex App Server, owns repositories, execution, Skills, configuration,
credentials and native thread history. No shared filesystem, home, temporary
directory or CODEX_HOME is required. Loopback URLs never imply local ownership.

On B, use Codex-managed authentication and start the server independently:

```sh
codex login
codex app-server --listen ws://127.0.0.1:4500
```

On A, provide a tunnel in another terminal, then start the built application:

```sh
ssh -N -L 127.0.0.1:14500:127.0.0.1:4500 user@machine-b
CODEXUI_REMOTE_INITIAL_DIRECTORY=/home/user/projects \
  node dist-cli/index.js --host 127.0.0.1 --port 5900 \
  --app-server-url ws://127.0.0.1:14500 --connection-profile machine-b --no-open
```

The tunnel and server remain outside Codex WebUI's lifecycle. Shutdown, deadlines
and disconnects never stop them. Existing upstream authentication requirements
are preserved; no bearer-token or mTLS configuration is added. Client-managed
external token refresh is unsupported and returns instructions to log in on B;
Codex WebUI never reads A's auth.json to answer it.

`--host 127.0.0.1` binds HTTP to loopback. `--host 0.0.0.0` intentionally enables
LAN access (the existing default). Optional `--password <password>` protection
still applies. For development use
`CODEXUI_APP_SERVER_URL=ws://127.0.0.1:14500 pnpm run dev --host 127.0.0.1 --port 4173`.
Endpoint precedence: CLI, CODEXUI_APP_SERVER_URL, ws://127.0.0.1:4500.
Browser `/codex-api/ws` is a separate connection from the upstream transport.

## Capabilities and paths

The minimum supported deployment baseline is Codex 0.169.0 with the required
[native capabilities and pre-upgrade migrations](native-project-migration.md).
The implementation uses versioned protocol types generated with Codex 0.167.2
(`pnpm run generate:project-file-protocol`). This is the verified schema baseline,
not a claim that every external server implements these experimental APIs.
The packaged method picker is advisory, not runtime capability negotiation.
Use **Settings → Account → Check remote compatibility** (or authenticated
`GET /codex-api/connection-diagnostics?probe=1`) for connection-scoped evidence.
The initialization response contains platform/home metadata, not an authoritative
method-capability list. Only JSON-RPC `-32601` establishes unsupported; a valid
response establishes supported. Path, permission, transport/deadline and malformed
response failures are diagnosed separately and otherwise retain unknown support.
A previously successful API can remain supported while a particular path is denied.
Checks use the configured initial directory or a saved workspace, and perform only
metadata/directory reads, unmatched fuzzy search and `git --version`. Concurrent
checks coalesce. File reads are observed during actual previews; create/write
support stays unknown until a user-requested upload. Git API support and Git
executable availability are reported separately. Evidence resets on disconnect;
late results cannot update the next generation. An interrupted check asks for retry.
Missing required metadata APIs produce upgrade guidance before thread creation.
Optional upload/search/Git failures do not disable conversation features.
There is no local
filesystem, git, rg, credential or process fallback. Permissions and approval
failures are returned from B. Upgrade B if its protocol lacks a required method.

- Browsing, validation, preview and reads: `fs/getMetadata`, `fs/readDirectory`,
  `fs/readFile`. Paths retain remote Windows or POSIX lexical semantics.
- Registration and thread creation validate directories on B, without creating
  directories on A. Launch project arguments must be absolute remote paths.
- Git repository detection (`GET /codex-api/git/repository-status`): `command/exec`, using argv and an
  explicit remote cwd, without sandbox or permission overrides. Git must exist
  on B and server policy must permit the operation. The UI accepts existing
  worktree directories. Dedicated branch/worktree endpoints have been retired; `/codex-api/worktree/branches` and `/codex-api/worktree/create` return 404.
- Composer search: `fuzzyFileSearch`, using the selected remote root.
- Skills: `skills/list` and remote Markdown via `fs/readFile`; no local catalog
  supplementation. Native thread history is authoritative. Local session scans,
  SQLite imports, and session-derived timestamps/Skills/execution enrichment are
  unavailable. Existing local data is preserved; history rebuild returns 501.

Optionally set `CODEXUI_REMOTE_INITIAL_DIRECTORY` to an absolute directory on B.
Otherwise the picker uses a saved workspace. Without either,
enter an absolute remote workspace path. Neither A's home nor B's CODEX_HOME is
assumed to be B's user home.

A retains UI preferences, web authentication sessions, presentation assets and
application caches locally. `CODEX_HOME` on A names A's application state directory;
it does not select B's home, credentials or project files. Choose an explicit
`--connection-profile <id>` / `CODEXUI_CONNECTION_PROFILE` when changing machines,
even when the forwarding URL is unchanged. Restart A to switch profile and repoint
the tunnel; do not repoint a running profile at another host. The default `legacy`
profile exclusively retains old workspace/presentation state in place. Named
profiles start empty in hashed subdirectories; migration never copies legacy
roots to every profile. Workspace updates retain interprocess locking and atomic
replacement. Global browser preferences and A's web authentication remain global.
See [profile storage and upload controls](connection-profiles-uploads.md). These are not remote project
files. Generated inline images use `/codex-app-asset?id=...`; remote attachments
and project images use the remote image proxy.

## Uploads and transfer limits

Uploads require `fs/createDirectory` and `fs/writeFile`. The bytes are written on
B before HTTP success returns. The returned path is used for both previews
(`fs/readFile`) and turn input. A rejected or timed-out write returns no usable
attachment. A timeout may still have created a file on B; it is never retried.

Uploads have a 20 MiB file limit (21 MiB total multipart request limit) and UUID
names. The dedicated staging area is `<remote CODEX_HOME>/codexapp-uploads`, or
`<CODEXUI_REMOTE_UPLOAD_DIR>/codexapp-uploads` when explicitly configured on A.
The latter is an absolute path on B, useful when initialization metadata is
unavailable. A's temporary directory is never used for remote uploads.

Retention is **indefinite**, including abandoned and unknown-outcome uploads.
A reserves attempted bytes in a locked, atomically replaced shared inventory before
writing on B and also appends its local intent journal. `GET /codex-api/uploads`
and the compatibility panel expose inventory, tracked-byte usage, unknown legacy
sizes and a cleanup preview. `CODEXUI_UPLOAD_CAPACITY_BYTES` defaults to 1073741824
(1 GiB), shared across all profiles in A's state directory; at 80% a warning is
reported. This is a tracked-attempt budget, not remote directory accounting or a
filesystem quota. Failed writes retain their reservations. Legacy journal entries
are imported once without dropping unknown sizes. Shared roots require shared
protection: a profile-local scan cannot authorize deletion of another profile's files.

Automatic deletion is disabled. The preview is empty and no deletion endpoint is
enabled: complete reference/submission status cannot be established from partial
history, drafts, other clients or profiles. No deletion was needed to verify this
work. Follow the [operator-assisted audit procedure](connection-profiles-uploads.md#conservative-cleanup)
on B; retain anything uncertain. Age and failed transfer status do not prove safety.

The pinned `fs/readFile` accepts only a path and returns whole-file Base64,
approximately 4/3 expansion plus JSON/decoded buffers. Browser Range handling does
not imply partial B-to-A transfer. Concurrent identical reads coalesce. Files up
to 16 MiB use a 32-entry / 16 MiB total cache for at most 2 seconds, reusable only
with fresh matching nonzero modification metadata. Generation changes clear it;
late results are rejected. Larger files coalesce only while in flight. Metadata
has no size: cold HEAD and cold ETag validation still need full reads; warm requests
can reuse valid bytes. If-Modified-Since can return 304 from metadata alone. Range,
Content-Length, If-Range and conditional semantics retain HTTP coverage.

Thread history uses native `thread/turns/list` when available, with opaque cursors
and `itemsView: full` for requested pages. A bounded `itemsView: notLoaded` index
scan preserves absolute turn positions used by fork/edit controls. Index work is
limited to 100 pages / 100,000 turns; oversized histories return actionable errors.
Only explicit method-not-found enables the full `thread/read` fallback; timeout or
permission failures do not masquerade as unsupported. Resume/fork responses and
legacy fallback paths may still transfer full history. See
[transfer benchmark and protocol limits](remote-transfer-performance.md) for exact
cache bounds, reproducible fixture results and paths that still transfer full data.

## Failure recovery

Upstream ping/pong liveness is independent of application events. Healthy idle
connections and silent long-running turns stay connected. Positive millisecond
settings on A:

| Setting | Default | Behavior |
| --- | ---: | --- |
| CODEXUI_APP_SERVER_PING_MS | 15000 | Transport ping cadence |
| CODEXUI_APP_SERVER_PONG_TIMEOUT_MS | 30000 | Missing-pong deadline |
| CODEXUI_APP_SERVER_RPC_DEADLINE_MS | 60000 | Ordinary RPC caller deadline |
| CODEXUI_APP_SERVER_COMMAND_DEADLINE_MS | 600000 | Long standalone command caller deadline |

Connection initialization has a 10-second deadline. Commands retain server-side
timeout defaults; a client deadline never terminates remote execution.
A local timeout or disconnect means a mutation's outcome may be **unknown**.
Inspect authoritative remote history/files before retrying turn submission,
steering, approvals or writes. Mutations are never automatically replayed.

Reconnect attempts coalesce and use exponential backoff with jitter (starting
around 500 ms, capped around 30 seconds). Successful reconnection refreshes the
selected conversation and running state without requiring the browser socket
to reconnect. Subscriptions resume with `excludeTurns: true`, separately from
initialization. A failed restored thread cannot gate account/model reads or
subscription removal.
The backend alone schedules manual and automatic subscription recovery: at most
3 concurrent attempts, 4 attempts per thread, a 5-second individual caller deadline,
a 30-second total job budget and exponential delays of 500/1000/2000 ms. Backoff
releases workers. Queued jobs, timers and pending calls are invalidated on disconnect
or shutdown; late responses cannot complete obsolete work. These fixed defaults
are exported as `RECOVERY_DEFAULTS`, rather than configurable environment options.
An RPC timeout releases the client but does not prove remote cancellation.

Browser WS and SSE readiness include a process-scoped `backendInstanceId` and
`connectionProfile`. A changed profile reloads the document once to discard old
remote caches and callbacks. Thread selection, per-thread context and drafts are
namespaced by profile; returning restores that profile's drafts. Legacy browser
keys remain exclusively legacy. The `connection-profile` URL hint prevents reload
loops when browser storage is blocked. Theme/language remain global. A new
instance invalidates browser subscription flags: selected and running threads
resume, while idle cached threads resume when opened. An ordinary browser socket
reconnect retains subscription flags and refreshes selected history only.
Concurrent resume calls coalesce; neither recovery path replays sends, steering
or approval replies.
Transport, per-thread recovering/recovered/failed subscriptions, expired approvals
and unknown submission outcomes have separate UI states. Exhausted recovery offers
**Retry subscription** through the same scheduler. Resume flags and read caches are
invalidated without clearing drafts or valid conversation items; successful selected
thread recovery refreshes history to find missed output. The UI offers **Refresh
history** for uncertain submissions. A missing turn in a refreshed/partial history
cannot prove failure, so uncertainty remains until independently established.
After a successful snapshot, transient connection errors clear while execution
errors remain. No turn/start, approval response or file write is automatically replayed.

Approval handles are unique to a client lifetime and discarded on disconnect;
stale browser replies cannot answer reused upstream IDs. There is no automatic
approval recovery guarantee: server-side behavior after a dropped connection
has not been verified against a live authenticated server. Inspect the thread
on B and resolve or interrupt blocked work there before continuing if an
approval does not reappear. Explicit reconnect remains available at
`POST /codex-api/reconnect` (authenticate first when web password is enabled).

## Unix sockets

Same-host Linux/macOS deployments can use `unix:///absolute/path.sock` with an
independently started `codex app-server --listen unix:///tmp/codex.sock`.
WebSocket framing and recovery are shared with TCP. Percent-encode special
characters; host, query, fragment and credentials are forbidden. Windows uses
ws/wss. Codex WebUI never creates or deletes the socket. This transport requires
access to the socket, but does not change project ownership rules.

## Verification and performance

See the [two-host smoke test](../tests/website-docs-misc/external-app-server.md).
Unit coverage uses mocked remote files, opposite-platform paths, real local
WebSocket transport fixtures and same-host command fixtures. These do not prove
real Codex authentication, approval recovery or two-host execution.

Current verification uses deterministic scheduler tests, actual local WebSocket
fixtures, opposite-platform path tests, HTTP/cache tests and browser fault injection
in light/dark themes. These fixtures establish client behavior only. See
[implementation verification](remote-reliability-verification.md) for commands,
results and benchmark evidence. No authenticated two-host streaming, approval
re-delivery or WAN throughput result is claimed for this change.

Performance audit: subscription attempts have bounded concurrency and deadlines;
backoff occupies no workers. Normal RPCs remain independent. Only selected recovered
history is refreshed automatically, with no per-thread background history fanout.
Diagnostics coalesce concurrent explicit probes and never issue write probes.
Profile selection adds no remote calls. Upload inventory uses local locked updates,
with O(tracked attempts) inventory payload; no remote filesystem/history scan is
performed for accounting. Native history metadata scans trade small bounded requests
for avoiding large item payloads; full fallback and large-file reads remain explicit
limitations. Browser recovery checks use synthetic responses and are not WAN profiles.

## MCP OAuth across hosts

`mcpServer/oauth/login` returns an authorization URL, not a callback relay. Codex
runs the callback listener on B, often on a different, ephemeral loopback port.
The browser must reach that listener; the WebSocket tunnel does not forward it.
See the [official MCP setup guide](https://developers.openai.com/codex/mcp/) and
[App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

Prefer authenticating on B using `codex mcp login <name>` as the same user with
the same CODEX_HOME as the server, then reload MCPs in the UI. Alternatively,
configure `mcp_oauth_callback_port = 14501` in B's Codex config (check support in
your Codex version), restart/reload configuration as required, and forward that
port from the **browser machine** before starting OAuth:

```sh
ssh -N -L 127.0.0.1:14501:127.0.0.1:14501 user@machine-b
```

Keep the callback port in the redirect URL unchanged. If the browser is on a third
machine, a tunnel on A alone is insufficient: forward from that machine to B.
For a dynamically selected port, inspect the actual authorization redirect URI
and forward that specific port before completing authorization; do not guess it
or rewrite the URL. If login expires, fix connectivity and explicitly start a new
login. Verify MCP status after reloading. This UI does not relay callbacks or
expose them on public interfaces. Real provider OAuth completion across hosts
requires manual verification and is not covered by the credential-free fixture.
