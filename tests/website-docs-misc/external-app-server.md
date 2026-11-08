# External app-server connection

Prerequisites: build with `pnpm run build`; start Codex independently with
`codex app-server --listen ws://127.0.0.1:4500`. Use matching CODEX_HOME and paths.

1. Start `node dist-cli/index.js --app-server-url ws://127.0.0.1:4500`.
2. List/read threads, create and resume a thread, send a turn, interrupt a turn,
   and accept/reject a tool approval. Expect correlated replies and one stream.
3. Stop the external server while a turn runs. Expect an actionable connection
   error; restarting it must not replay the turn.
4. POST `/codex-api/reconnect`, then inspect the thread before sending again.
   Expect a fresh handshake and restored subscriptions, without duplicate events.
5. Stop the web backend. Expect the independently started Codex process to survive.
6. Repeat using CODEXUI_APP_SERVER_URL in development; verify CLI overrides env,
   and invalid schemes fail. Verify account status reflects server authentication.
7. Check settings in light/dark themes: login errors must explain external ownership.

Cleanup: stop only test processes manually; remove test threads if desired.
Automated fixture coverage is in `appServerWebSocketClient.test.ts`.

## Disconnect recovery and subscription retirement

Prerequisites: build with `pnpm run build`; install dependencies. For deterministic
coverage without Codex, run `node scripts/test-external-app-server.cjs` (ports
4198 and 4199 must be free), then
`pnpm exec vitest run src/server/appServerClient.test.ts src/server/appServerWebSocketClient.test.ts`.

Actions: start a real external server and the web backend as described in
[the deployment guide](../../docs/external-app-server.md). Start a streaming
turn, stop the external server, then restart it and explicitly reconnect.
Archive a subscribed thread, reconnect again, and reopen another thread.

Expected: the disconnected browser stops showing the turn as running, clears
approvals and warns to inspect the thread before resending. No turn is replayed.
Archived/unsubscribed threads are not resumed; remaining subscriptions resume
once. Connected-server account status is read again after disconnect.
The controlled integration script checks both built and dev entry points,
CLI/environment endpoint precedence, HTTP RPC, browser WebSocket readiness,
bundled method metadata, one upstream connection/initialize per backend,
and fixture listener survival after backend shutdown.

Cleanup: the script terminates only its own backend process groups and fixture.
Real-server checks require stopping the independently launched server separately.
A fixture result does not establish real Codex process survival or authenticated
streaming/approval behavior.

## Shared browser notification transport

Prerequisites: install dependencies; use the independent Codex server setup above
for live notifications. Automated connection/cleanup checks need no credentials:
`pnpm exec vitest run src/server/browserNotificationTransport.test.ts src/api/codexRpcClient.notifications.test.ts`.

1. Start development with `CODEXUI_APP_SERVER_URL=ws://127.0.0.1:4500 pnpm run dev`
   and repeat against the built production CLI. Connect to `/codex-api/ws` using a
   WebSocket client. Expect one JSON `ready` frame with `{ok:true}` and `atIso`.
2. Trigger a turn in another client. Expect unchanged notification methods, params
   and timestamps. Close/reconnect the browser socket repeatedly; expect one active
   subscription per connection and no duplicate notifications.
3. In production with `--password`, connect without a session: expect HTTP 401.
   Log in through `/auth/login`, then connect with its session cookie: expect ready
   and notifications. Development remains unauthenticated. Vite HMR still works.
4. Block the WebSocket handshake in a test proxy, leaving `/codex-api/events`
   available. Expect the existing SSE fallback immediately after handshake failure
   or after the 2500 ms connection timeout. Close the client; expect no reconnect.
5. Stop the web server. Expect notification subscriptions and owned upgrade listeners
   to be released. The external Codex server remains independently managed.

Cleanup: close all test sockets, remove any proxy rules, and stop only test processes.
The automated tests cover repeated error/close/dispose cleanup and host shutdown;
the fixture covers actual development and built production WebSocket readiness.

`browserNotificationTransport.ts` owns upgrade endpoint selection, optional auth
checks, ready/message forwarding and idempotent subscription cleanup. Adapter code
retains Vite's duplicate-attachment guard and production's auth-session predicate.
SSE endpoints, browser reconnect/fallback logic and application messages are unchanged.
Disposal uses `WebSocketServer.close()` without forcing active browser sockets closed.

Performance audit (code-path analysis): each connected browser still creates exactly
one bridge subscription and performs one JSON serialization per notification. Closed
and errored clients retire their subscription; the transport's active cleanup set
shrinks on retirement. No extra upstream connections, requests, timers, blocking I/O,
message queues, payload copies or persistent caches are introduced. Broadcast fanout
remains proportional to connected subscribers; payloads and cache invalidation are
unchanged. Browser render timing and sustained-load throughput were not measured.

## AF_UNIX transport

Prerequisites: Linux/macOS, a Codex version supporting `--listen unix:///path`,
a production build, and matching server/backend users and paths. Use a short
unused socket path, such as `/tmp/codex-uds-test.sock`.

1. Run `codex app-server --listen unix:///tmp/codex-uds-test.sock` independently.
2. Run `node dist-cli/index.js --app-server-url unix:///tmp/codex-uds-test.sock`.
   List/read threads, send a streaming turn, and accept/reject an approval.
   Expect the same replies, notifications, and approval behavior as TCP.
3. Stop the external server. Expect pending operations to fail. Restart it and
   POST `/codex-api/reconnect`; inspect the thread before sending again.
   Expect one handshake with no replay of the previous turn.
4. Repeat using `CODEXUI_APP_SERVER_URL`; supply a CLI URL to verify precedence.
   Try `unix://`, a relative path, query, and fragment; expect clear errors.
   On native Windows expect an unsupported-platform error and use TCP instead.
5. Stop the backend; expect the external server and its socket to remain owned
   by the independently started server.

Automated: `pnpm exec vitest run src/server/appServerWebSocketClient.test.ts`
checks actual Unix WebSocket handshakes and TCP compatibility without Codex.
Cleanup: stop only test processes, remove test threads if desired, and remove
any stale test socket only after its owning server is stopped. Return the URL
configuration to its previous value. No browser UI or theme changes are involved.

Run the CommonJS entry-point integration fixture for each transport (after build):

```sh
pnpm run test:integration:fixture
CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture
```

Both runs exercise HTTP RPC, browser WebSocket readiness, initialization counts,
and independent listener survival through the built CLI and development server.
The CLI is ESM and has no public CJS export; this CJS fixture launches its public
`dist-cli/index.js` executable instead of using `require()` on the CLI bundle.
