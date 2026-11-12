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
  --app-server-url ws://127.0.0.1:14500 --no-open
```

The tunnel and server remain outside codexapp's lifecycle. Shutdown, deadlines
and disconnects never stop them. Existing upstream authentication requirements
are preserved; no bearer-token or mTLS configuration is added. Client-managed
external token refresh is unsupported and returns instructions to log in on B;
codexapp never reads A's auth.json to answer it.

`--host 127.0.0.1` binds HTTP to loopback. `--host 0.0.0.0` intentionally enables
LAN access (the existing default). Optional `--password <password>` protection
still applies. For development use
`CODEXUI_APP_SERVER_URL=ws://127.0.0.1:14500 pnpm run dev --host 127.0.0.1 --port 4173`.
Endpoint precedence: CLI, CODEXUI_APP_SERVER_URL, ws://127.0.0.1:4500.
Browser `/codex-api/ws` is a separate connection from the upstream transport.

## Capabilities and paths

The implementation uses versioned protocol types generated with Codex 0.167.2
(`pnpm run generate:project-file-protocol`). This is the verified schema baseline,
not a claim that every external server implements these experimental APIs.
The packaged method picker is advisory, not runtime capability negotiation.
Missing methods surface errors for the affected operation; there is no local
filesystem, git, rg, credential or process fallback. Permissions and approval
failures are returned from B. Upgrade B if its protocol lacks a required method.

- Browsing, validation, preview and reads: `fs/getMetadata`, `fs/readDirectory`,
  `fs/readFile`. Paths retain remote Windows or POSIX lexical semantics.
- Registration and thread creation validate directories on B, without creating
  directories on A. Launch project arguments must be absolute remote paths.
- Git status, branches and detached worktrees: `command/exec`, using argv and an
  explicit remote cwd, without sandbox or permission overrides. Git must exist
  on B and server policy must permit the operation. Worktrees are allocated
  below B's reported CODEX_HOME/worktrees. Ambiguous failures retain files for
  inspection rather than risking deletion of an accepted operation.
- Composer search: `fuzzyFileSearch`, using the selected remote root.
- Skills: `skills/list` and remote Markdown via `fs/readFile`; no local catalog
  supplementation. Native thread history is authoritative. Local session scans,
  SQLite imports, and session-derived timestamps/Skills/execution enrichment are
  unavailable. Existing local data is preserved; history rebuild returns 501.

Set `CODEXUI_REMOTE_INITIAL_DIRECTORY` to an absolute directory on B for a new
installation. Otherwise the picker uses a saved workspace. Without either,
enter an absolute remote workspace path. Neither A's home nor B's CODEX_HOME is
assumed to be B's user home.

A retains UI preferences, web authentication sessions, presentation assets and
application caches in their existing locations. These are not remote project
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
A records each upload intent in its local `codexapp-uploads.jsonl` manifest before
writing on B. No automatic cleanup or deletion occurs at submission, completion,
reconnect or restart. To reclaim storage, inspect only paths in that manifest
and verify no retained thread references them before manually deleting on B.
Do not remove the staging area while history still needs its attachments.

Filesystem transfer uses whole-file Base64 RPC payloads: approximately 4/3 byte
expansion plus JSON and decoded buffers. HTTP ranges and HEAD requests still
read the whole remote file; large reads can consume substantial memory and
bandwidth. Remote streaming/range optimization is a follow-up. Git captures are
bounded to 1 MiB per stream; extremely large branch catalogs may be truncated
by the server. Inline presentation assets on A can be regenerated by reloading
native history if A's temporary asset cache is cleared.

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
subscription removal. Restoration is sequential to avoid fanout.

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
ws/wss. codexapp never creates or deletes the socket. This transport requires
access to the socket, but does not change project ownership rules.

## Verification and performance

See the [two-host smoke test](../tests/website-docs-misc/external-app-server.md).
Unit coverage uses mocked remote files, opposite-platform paths, real local
WebSocket transport fixtures and same-host command fixtures. These do not prove
real Codex authentication, approval recovery or two-host execution.

Code-path audit: one shared socket/handshake, coalesced reconnects, one ping timer,
per-request deadlines cleared on settlement/disconnect, sequential subscription
restoration without full histories, no local session traversal, and no per-Skill
Markdown read fanout when listing the catalog. Uploads are bounded; reads retain
the whole-file transfer limitation above. Disconnect invalidates history caches.
No browser profiler, real network latency, or two-host throughput measurement
was performed for this change.
