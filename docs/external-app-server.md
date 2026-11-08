# External Codex app-server

Start these independently with the same user, working paths, and `CODEX_HOME`:

```sh
codex app-server --listen ws://127.0.0.1:4500
# Another terminal:
node dist-cli/index.js --app-server-url ws://127.0.0.1:4500
# Or development:
CODEXUI_APP_SERVER_URL=ws://127.0.0.1:4500 pnpm run dev --host 127.0.0.1 --port 4173
```

Endpoint precedence is CLI `--app-server-url`, then `CODEXUI_APP_SERVER_URL`,
then `ws://127.0.0.1:4500`. The `ws`, `wss`, and `unix` transports are supported. URL credentials
and fragments are rejected. The browser's `/codex-api/ws` is a separate socket.
The backend requires no Codex installation and never launches or kills app-server.

## Unix domain sockets (AF_UNIX)

On Linux/macOS, connect directly to an independently started Unix socket listener:

```sh
# Start the official Codex app-server:
codex app-server --listen unix:///tmp/codex.sock
# Another terminal, after building this project:
node dist-cli/index.js --app-server-url unix:///tmp/codex.sock
# Or development:
CODEXUI_APP_SERVER_URL=unix:///tmp/codex.sock pnpm run dev --host 127.0.0.1 --port 4173
```

The existing `ws` client performs HTTP Upgrade and WebSocket framing over AF_UNIX;
there is no TCP proxy or raw JSONL transport. Initialization, RPCs, notifications,
approvals, deadlines, and reconnect behavior are shared with TCP connections.
The browser-facing HTTP and WebSocket endpoints do not change.

Use an explicit absolute socket-file path with no host, credentials, query or
fragment. Percent-encode special path characters (for example `%20` for a space).
Bare `unix://` is rejected: this client does not infer Codex's default socket path.
Windows hosts must use `ws://` or `wss://`; WSL can use Unix sockets within Linux.
The backend user must have access to the socket and its parent directories.
The operating system's Unix socket path-length limit applies; use a short path
if connection fails. The backend never creates, removes, or owns the socket file.


Authentication and provider, sandbox, approval, and memories defaults belong to
Codex. Manage authentication in the server environment (for example `codex login`).
The old web login endpoints return an explanation instead of launching a CLI.
Account reads and logout use server RPCs. Legacy process configuration flags are
rejected; explicit per-thread RPC settings are preserved. `--login`/`--no-login`
are compatibility no-ops; the `login` command explains external authentication.

After a disconnect, pending operations fail and approval requests are discarded.
Retrying an operation opens a fresh connection and handshake; requests are never
replayed automatically. Before resending a turn, read its thread to check whether
the server accepted it. To explicitly reconnect and resume known thread subscriptions
without restarting the web backend:

```sh
curl -X POST http://localhost:5900/codex-api/reconnect
```

With password protection, authenticate the HTTP request first. Resuming threads
can fail if the server no longer has a thread; inspect the error and reopen it.
Connection plus initialization has a ten-second deadline. Check the listener,
URL, TLS trust, and server logs on failures. Shutdown closes the connection only.

Filesystem browsing, uploads, session recovery/indexing, git, skills, and credential
refresh assume shared local files. Merely specifying a remote WebSocket URL does
not support a split-host deployment; paths, credentials and `CODEX_HOME` must match.

Method-picker metadata is packaged in `src/server/appServerMethods.json`, extracted
from the checked-in `documentation/app-server-schemas/json` snapshot. It is advisory,
not feature negotiation. Update it with protocol schema changes; no runtime schema
command is executed. The snapshot's originating Codex version is not recorded.

Historical migration audit: validation used a local `ws` protocol fixture. No Codex executable or Docker was
available in that audit environment, so no real Codex version, authenticated turns,
provider Docker matrix, or external Codex process survival has been validated.

Performance audit: the regression fixture asserts three concurrent connection
requests produce one socket and one initialize exchange; the bridge fixture
asserts concurrent reconnects produce one replacement socket and one thread resume.
Notifications are delivered once per server frame, and there is no retry timer or
request replay loop. Resume restoration is sequential (one request per known
thread), avoiding concurrent fanout. Method metadata is bundled, removing process
startup and schema filesystem work. Browser payloads and browser notification
transport are unchanged; disconnect invalidates live thread caches. No browser
profile or real-server latency measurements were collected.

## Migration audit follow-up

Disconnects also notify connected browsers, clear pending approvals and release
the local running-turn indicator. This does not interrupt the server's turn:
reopen/read the thread before deciding to submit again. Disconnect invalidates
cached account status. Successful archive/unsubscribe removes the thread from
subscription restoration, preventing obsolete threads from blocking reconnect.

Reproduce controlled built/dev integration checks (free ports 4198 and 4199):

```sh
pnpm run build
node scripts/test-external-app-server.cjs
pnpm exec vitest run src/server/appServerClient.test.ts src/server/appServerWebSocketClient.test.ts
```

The integration script is CommonJS and executes the public ESM CLI as a child
process. It verifies bundled metadata through HTTP; the CLI has no public CJS
exports. Both backends use one connection and initialization each. The fixture
checks listener survival after shutdown, not survival of a real Codex process.
No Codex executable or Docker was available for this audit.

Runtime audit: remaining subprocesses run git, ripgrep, filesystem helpers and
the optional `npx skills` installer; these do not manage Codex. Unused local
installer, CLI login probe, write-only authentication cache,
launch-argument helpers and unreachable callback modal have been removed. Legacy
HTTP login routes retain only an external-authentication error for compatibility.
Development preserves `CODEX_HOME`. Schema method metadata is bundled
into the CLI, with no CLI schema-generation dependency at runtime.

## Unix transport verification and performance

Run `pnpm exec vitest run src/server/appServerWebSocketClient.test.ts` for real
AF_UNIX HTTP Upgrade fixtures alongside the TCP fixtures. Coverage includes shared
initialization, RPC replies, notification/approval frames, concurrent reconnects,
initialization deadlines, a missing listener followed by recovery, URL validation,
and an explicit Windows error. Unix listener tests are skipped on Windows.

Performance audit: both transports assert three simultaneous connects create one
socket and one initialize exchange, and three reconnects create one replacement.
Transport setup adds URL parsing and one `net.createConnection` per connection;
there are no filesystem probes, blocking I/O, additional requests, retry loops,
message payload changes, fanout, or new caches. Existing disconnect invalidation
is unchanged. Real Codex latency/throughput and authenticated turns were not
measured; fixtures establish transport/protocol behavior only.

Run the CommonJS entry-point integration fixture for each transport (after build):

```sh
pnpm run test:integration:fixture
CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture
```

Both runs exercise HTTP RPC, browser WebSocket readiness, initialization counts,
and independent listener survival through the built CLI and development server.
The CLI is ESM and has no public CJS export; this CJS fixture launches its public
`dist-cli/index.js` executable instead of using `require()` on the CLI bundle.
