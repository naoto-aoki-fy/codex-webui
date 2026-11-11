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

## Bridge HTTP utility compatibility (9-C-3)

Prerequisites: install dependencies and run `pnpm run build` from this checkout.
Run `pnpm exec vitest run src/server/bridgeHttpUtils.test.ts src/server/threadLiveStateRetirement.test.ts src/server/threadFileChangeRetirement.test.ts`.
Expect valid/chunked JSON and whitespace bodies to retain their values, malformed
JSON to map to the existing RPC 502 error envelope, empty RPC bodies to return
400, and stream errors/aborts to reject unchanged. Body readers intentionally
retain their existing lack of an application-level size limit. Error precedence,
nested error classification, status codes, and JSON headers must remain unchanged.
All standard HTTP methods for the three retired history endpoints must terminate
with JSON 404 without invoking RPC or SPA fallback (real HTTP HEAD omits the body).
Then run the WebSocket and Unix fixtures above sequentially to check both public
CLI and dev entry points. Cleanup: tests restore temporary state and stop their
own processes; no persistent configuration changes or rollback are needed.

## External authentication refresh extraction (9-C-10)

Prerequisites: install dependencies; no live Codex credentials are needed.
Run `pnpm exec vitest run src/server/codexAppServerBridge.authRefresh.test.ts src/server/appServerClient.test.ts`.
Expect unchanged URL/form/header construction, token metadata and fallback rules,
credential storage rejection, missing/malformed file errors, HTTP/network errors,
and invalid response rejection. A changed login or credential-store type during
refresh must prevent persistence. Overlapping client refresh requests must issue
one HTTP request; replaced connection generations must receive neither stale
success/error replies nor stale resolution notifications. A later request may retry
after settlement. The lifecycle test checks reconnect and subscription restoration.
Run `pnpm run typecheck`, `pnpm run build`, `pnpm run test:unit`, and both transport
fixtures above sequentially. Expect all checks to pass with unchanged public bridge
exports and CLI behavior. Cleanup: tests remove temporary credentials, restore
fetch/environment overrides, and dispose clients; no real auth files are modified.

## AppServerClient module extraction

- Prerequisites: install dependencies; no credentials or live Codex server required.
- Run `pnpm exec vitest run src/server/appServerClient.test.ts src/server/codexAppServerBridge.authRefresh.test.ts src/server/threadLiveStateRetirement.test.ts`.
- Expected: concurrent RPC correlation, pending-call rejection, approval cleanup,
  reconnect/restoration, auth single-flight/stale-generation suppression, event
  limits, snapshot fallback, cache deduplication/invalidation/expiry, injected
  metadata persistence, shared middleware disposal and legacy runtime retirement
  pass without changed response expectations.
- Run `pnpm run typecheck`, `pnpm run build`, and `pnpm run test:unit`.
  Then run `pnpm run test:integration:fixture` followed by
  `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` sequentially.
- Expected: packaged CLI and dev entry points work with both fixture transports;
  no extra client handshakes or application RPC replay. These are protocol fixtures,
  not proof of live authentication or reconnect against a real Codex installation.
- Cleanup: fixtures stop their child processes and remove temporary Unix sockets;
  no persistent app configuration should be changed.

## SSE notification request cleanup

Prerequisites: dependencies installed; no credentials or live Codex server needed.
Run `pnpm exec vitest run src/server/bridgeSse.test.ts src/server/threadLiveStateRetirement.test.ts src/server/browserNotificationTransport.test.ts`.
Expect exact headers, ready frame, ordered notification envelopes, no historical
replay, and one 15-second `: ping\n\n` timer per SSE request. Request close and
abort clear that timer, release the subscription, and end an unfinished response.
Repeat close, abort, and close followed by abort. Expect unsubscribe, interval
clearing, and response end exactly once, both request listeners detached, and no
later notifications or heartbeats. Bridge response instrumentation retains its
finish/close listeners. Ended/destroyed responses skip notifications; heartbeat
writes remain unguarded until request cleanup.

Inject failures in header setting, subscription acquisition, ready writing,
interval creation, and registration of the second request listener. Expect the
bridge's existing JSON 502 handler to receive the failure, no retained request
listeners/timers, and each acquired subscription released exactly once. Header
and subscription acquisition failures must not attempt unsubscribe. If unsubscribe
throws, expect request listeners and timer already removed, no repeated release,
and response termination still attempted. The subscription provider remains
responsible for its own internal cleanup when acquisition or unsubscribe throws.

Open two mocked SSE connections across two middleware instances plus a browser
WebSocket subscription (covered by the focused suite). Expect one shared runtime,
independent subscriptions, and closure of one connection to leave the others live.
Dispose the final middleware owner while SSE is active: expect the bridge to
stop Telegram, dispose the app-server, and delete its own shared registration.
Disposing an earlier owner leaves the shared runtime active. The SSE timer and
response remain active until request close/abort. Middleware-wide SSE disposal
is deferred; this task introduces no active-connection registry.

Ownership: `bridgeSse.ts` holds only request-local response writes, subscription
release closure, interval, and close callback. The bridge retains shared runtime
reuse, notification timestamp construction, exception mapping, route dispatch,
and middleware disposal. Browser WebSocket transport remains a separate module.
The subscription is created before ready is written, exactly as before; synchronous
subscription delivery can therefore precede ready. No buffering is introduced.

Setup audit: headers acquire no request resources. Subscription acquisition
returns the release closure; ready writing, interval creation, and either listener
registration can then throw with a subscription already acquired. Listener setup
can also fail with a live timer and the first listener attached. One cleanup path
handles these partial states before rethrowing the original error to the bridge.
Cleanup sets its guard before releasing resources, so repeated events and a
throwing unsubscribe cannot repeat cleanup. Only request close/abort ends the
response; failed setup leaves error response ownership with the bridge.

Code-path performance audit: each live request retains one subscription, one
interval, two request listeners, and constant-size cleanup state. Cleanup removes
both listeners and the interval once. Fake-timer tests verify zero remaining
timers after close/abort and setup failures, versus one during a live request.
Notification serialization and fanout are unchanged.
There are no added RPC/network calls, blocking operations, payload expansion,
caches/invalidation, or replay buffers. Fanout remains proportional to live
subscriptions. The new module imports only Node HTTP types, so it cannot create
a runtime import cycle. Live latency and memory profiles were not measured.

Run typecheck, build, full units, then WebSocket and Unix fixtures sequentially as
above. The public CLI is ESM with no CJS exports; verify from CommonJS with
`node -e "const {execFileSync}=require('node:child_process'); const h=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'}); if(!h.includes('--port')) throw Error('Missing --port'); console.log('CLI smoke passed')"`.
Cleanup: focused tests restore the shared runtime and fake clock; fixtures stop
only their child processes and remove their temporary sockets. No persistent
configuration or rollback is needed.


## Shared runtime ownership and disposal safety

Setup: dependencies installed; no credentials or external server required. Run
`pnpm exec vitest run src/server/sharedBridgeOwnership.test.ts src/server/appServerClient.test.ts`.
The controlled local WebSocket fixture seeds a compatible legacy registration
without ownership fields, acquires middleware A and B, and starts a pending RPC.

Actions and expected results:

1. Dispose A twice. Expect no client disposal or service stop; B's HTTP RPC and
   notification listener still work and the fixture records one upstream connection.
2. Dispose B twice. Expect one client disposal and one service stop, rejection of
   the pending RPC, and removal of that runtime's registration.
3. Replace the registration while an old owner remains, then dispose the old owner.
   Expect the replacement registration and client to remain intact.
4. Reload the module with a compatible runtime. Expect the same runtime and owner
   count; only final release disposes it. A single owner also disposes exactly once.
5. Mark an owned runtime incompatible and acquire a replacement. Expect immediate
   retirement, legacy queue cancellation, and rejection of legacy queued RPCs.
   Releasing retired owners must neither dispose again nor remove the replacement.

Original sequence: each middleware looked up/created the global runtime, captured
its client/catalog/service, then unconditionally stopped and disposed those shared
resources and deleted the global key on every disposal. Middleware objects were
independent but ownership was not tracked. Replacement on version mismatch retired
the previous client immediately, leaving old middleware closures alive.

Current sequence: each middleware increments an optional count on the actual
runtime object and releases once. Final release removes only an identical global
registration and retires the captured runtime once. Version mismatch still retires
immediately regardless of owners. The runtime owns the client and service; the
client owns the transport and retains its existing pending-RPC cleanup and
subscription/reconnect behavior. Notification subscription release remains caller
owned; SSE cleanup is unchanged. Delayed configuration cannot restart a released
or retired middleware's service.

Compatibility: registrations without ownership fields are adopted lazily. Ownership
survives compatible reloads because it lives on the shared object. Disposers from
code loaded before this fix cannot be retroactively made ownership aware; restart
the host to eliminate such closures when upgrading.

Performance audit: acquisition/release add constant-time counter/identity checks,
with constant storage per runtime and middleware. The regression fixture measures
one upstream connection across both owners and subsequent RPCs. No added RPCs,
blocking I/O, timers, polling, fanout, payloads, caches, or import edges are introduced;
search invalidation and reconnect paths are unchanged. Live latency/memory profiling
was not performed; no performance improvement is claimed.

Cleanup: tests unsubscribe listeners, dispose middleware, restore global registration
and environment, and close fixture sockets/listeners. No persistent data changes.
