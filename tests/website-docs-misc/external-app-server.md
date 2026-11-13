# External app-server connection

Prerequisites: build with `pnpm run build`; start Codex independently with
`codex app-server --listen ws://127.0.0.1:4500`. The App Server owns paths and credentials; no shared CODEX_HOME is required.

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
   WebSocket client. Expect one JSON `ready` frame with `{ok:true,backendInstanceId:"..."}` and `atIso`.
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
dispose the app-server, and delete its own shared registration.
Disposing either owner ends all of its SSE responses, removes request listeners,
clears heartbeats, and unsubscribes exactly once. Repeat disposal and emit late
close/abort events: expect no further cleanup. Close or abort one stream normally
before disposing its owner: expect only remaining streams to be disposed.
An earlier owner's disposal must leave the other owner's SSE and browser WebSocket
notifications functional and the upstream client alive. Final-owner disposal
releases the runtime once. Replace the global runtime registration, open a new
owner's stream, then dispose the stale owner: only its old stream/runtime may close.

Run `pnpm exec vitest run src/server/bridgeSse.test.ts src/server/sharedBridgeOwnership.test.ts`.
The fake-timer suite also injects disposal during subscription/ready setup, failed
ready writes, throwing unsubscribe and throwing response end. Expect zero retained
SSE timers/listeners after disposal, exactly one release attempt per subscription,
and cleanup of other streams/runtime despite a throwing stream. Requests arriving
after middleware disposal must end without acquiring a subscription or timer.

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
throwing unsubscribe cannot repeat cleanup. Request close/abort and owner disposal
end the response; failed setup leaves
error response ownership with the bridge. A middleware-local Set registers each
successfully set-up stream's idempotent close callback. Cleanup removes that entry
before unsubscribe. Registration checks the released flag after synchronous setup,
so reentrant disposal during setup immediately closes the newly acquired stream.

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

### SSE owner-disposal audit and cleanup

The owner registry adds one Set entry per active SSE stream and removes it on
normal close/abort or disposal, including throwing unsubscribe. Disposal does
O(active owner streams) synchronous cleanup before releasing its runtime reference;
it adds no RPCs, network requests, timers, subscriptions, payload copies, replay,
or cache invalidations. The existing notification path and 15-second cadence are
unchanged. No latency/heap benchmark was run; no performance improvement is claimed.
There is no new import edge or dependency. Browser WebSocket implementation is
unchanged and its independent subscription is covered by the focused suite.

Cleanup: mocks and fake timers restore automatically; no files or configuration
need rollback. For live checks, disconnect test SSE clients and release every
middleware owner. Providers remain responsible for internal unsubscribe failures;
the bridge guarantees one attempt and continues releasing its other resources.

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

### Earlier-history cache invalidation during reads

- Setup: connect to an external app-server and open a thread with enough turns for multiple earlier-history pages. For deterministic races, run `pnpm exec vitest run src/server/appServerClient.test.ts src/server/threadLiveStateRetirement.test.ts` (deferred RPC responses; no credentials required).
- Actions: request earlier history; deliver a thread notification or store a fresh thread snapshot before the read completes; request earlier history again. Repeat with different page cursors, a second thread, repeated invalidations, and a disconnect/reconnect while a read is pending.
- Expected: the original caller receives its response (or the existing disconnect error); stale completion never repopulates the cache or removes a replacement promise. Reads after invalidation issue a fresh RPC, concurrent valid reads share one RPC, and other threads remain independent. Different page cursors share the full per-thread read; ordering and envelopes remain unchanged. Cached results expire exactly 30 seconds after completion. Settled promises leave no pagination epoch records.
- Cleanup: close the test thread; restore normal app-server connectivity. Unit tests restore their mocks and dispose clients.

The pagination cache and in-flight map are keyed only by thread ID. Notifications carrying a thread ID and `storeThreadReadSnapshot` invalidate that thread; TTL expiry removes only a completed cache entry. Transport disconnect clears both maps and increments the connection generation. An in-flight promise's identity serves as its invalidation epoch: removing it detaches the old read without cancelling the original caller. Completion may cache only while that identity and connection generation remain current; cleanup may remove only its own registration. No counter map, timer, retry, or subscription is added.

Performance audit: deferred tests confirm one RPC for concurrent valid reads and exactly one fresh RPC after invalidation, including different cursors/limits. The changed path adds constant-time map operations and a connection-generation comparison; it adds no blocking work, payload copies, network fanout, timers, or subscriptions. Removed promises remain only with their existing awaiting callers until settlement; no per-thread epoch map is retained. Existing cache TTL eviction remains lazy. Browser latency and heap profiling were not measured; no performance improvement is claimed.


## Two-host SSH tunnel ownership and recovery smoke test

Prerequisites: two separate hosts with different home directories and no shared
mounts; Codex 0.167.2 or a server implementing the APIs in the deployment guide;
Codex-managed login on B; built codexapp on A. Record `codex --version` on B and
both host/home names. Start B's listener and A's tunnel exactly as in
[the deployment guide](../../docs/external-app-server.md). Use a disposable B repo
with a committed file, and set CODEXUI_REMOTE_INITIAL_DIRECTORY on A. Bind A's
HTTP listener with --host 127.0.0.1. Keep the browser reachable through your usual
local access or separate browser tunnel.

1. Create `/tmp/codexapp-smoke/repo` only on B (use an equivalent Windows path
   when appropriate). Browse it, register it and start a thread. Expect success
   with no placeholder created on A. Repeat with an opposite-platform path if
   available; the picker must retain B's drive/separator semantics.
2. Put different sentinel content at the same lexical file path on A and B.
   Browse/read through codexapp, query Git/branches, create a detached worktree,
   and search for a file existing only on B. Expect B's content/results and no
   changed sentinel, repository or worktree on A. Repeat with command/exec
   disabled on B: expect a specific operation error, never local execution.
3. Upload a text file and a PNG. Compare checksums of original bytes and staged
   files on B. Expect successful preview and remote paths in turn input. Deny
   writes to B's staging area and upload again: expect a visible failure and no
   attachment added. Restore permission. Test the 20 MiB file limit.
4. Submit both attachments in an accepted turn. Restart codexapp, reconnect,
   reload history and previews. Expect the files to remain available. Inspect
   A's upload manifest; no cleanup may touch files outside tracked staging paths.
5. Generate an inline image. In light and dark themes, inspect its full image
   request: expect `/codex-app-asset?id=...`, never remote fs/readFile of A's
   temporary path. Verify ordinary uploaded images still read B's staged path.
6. With no Codex credentials, sessions or Skills installed on A, list Skills,
   open SKILL.md and load native history. Expect B's catalog/content. Local-only
   historical metadata may be absent. Expect explicit errors for unsupported
   client-managed token refresh or local history rebuild.
7. Run a long quiet turn. Wait beyond the ordinary RPC deadline; it must continue
   while transport pong replies remain healthy. Break the SSH tunnel during a
   second submission, then restore it. Expect backoff, a refreshed selected
   history and no automatic duplicate submission. Inspect B to reconcile an
   unknown accepted mutation before manually resending.
8. Blackhole transport traffic (rather than closing it) to test missing pong
   detection. Restore traffic and restart B's server. Issue concurrent reconnect
   requests; expect one connection attempt at a time, refreshed selected history,
   and no replay. A missing restored thread must not block models/accounts or
   a healthy thread. Remove subscriptions while restoration is in progress.
9. Disconnect with an approval pending. Attempt an old browser reply after
   reconnect and after a new approval uses the same upstream ID. Expect rejection
   of the stale handle. Record actual server recovery behavior; if no approval
   reappears, inspect/resolve or interrupt the turn on B. This behavior requires
   live verification and is not established by mocked fixtures.
10. Stop codexapp and the tunnel. Expect B's independently managed process and
    repositories to survive. Confirm loopback HTTP is inaccessible via A's LAN
    address; separately verify intentional --host 0.0.0.0 and optional password.

Cleanup/rollback: stop only smoke-test processes and the user-managed tunnel.
Remove disposable B threads, worktrees and repositories deliberately. Remove
tracked uploads only after deleting all histories that reference them. Preserve
A's pre-existing UI state and credentials; restore test permissions/firewall
rules. Record mocked, same-host and real two-host results separately; an unrun
step is not a pass.

## Split-host recovery, first project and Windows paths

Prerequisites: A runs this checkout, B runs Codex 0.167.2 or compatible APIs;
use separate homes/CODEX_HOME with no shared project mount. Keep a TestChat
project on B. Use the deployment guide's SSH tunnel. Test light and dark themes.

1. With no registered projects, no threads and no initial-directory override,
   open the folder picker. Expect a focused editable path and guidance. Enter
   an invalid remote path and Browse: expect the remote error. Enter an existing
   absolute path on B and Select: expect registration without a directory on A.
2. Start a long turn in TestChat. Drop only the SSH tunnel, restore it, and wait
   for automatic recovery. Expect live events, consistent final history, no
   duplicate text and no replayed turn. Repeat with a pending approval: stale
   handles must not be sent again; if it does not reappear, inspect/resolve on B.
3. During another long turn, restart only A's Node backend with the browser open.
   Expect a new backendInstanceId, restored selected/running subscriptions, and
   final history without a browser reload. Repeat reconnects; count turn/start
   and approval replies to confirm no replay. Open an idle cached thread and
   verify it resumes before receiving notifications.
4. Restart only B's app server. Expect automatic handshake, subscription
   restoration and history refresh; persisted history survives but an interrupted
   execution may not. No automatic turn retry is expected. Genuine execution
   errors remain visible; a recovered connection warning clears after history loads.
5. On a Windows B with Linux/macOS A, preview drive and UNC skill paths, images,
   and links containing spaces, # and ?. Expect exact remote filesystem targets.
   In TestChat send a unique marker and representative links; assert hrefOk,
   titleOk and textOk on the actual rendered row and capture light/dark evidence.
6. For MCP OAuth, forward only the WebSocket initially. Expect callback guidance
   in Skills & MCPs. Add the configured callback tunnel from the browser machine,
   explicitly restart login and verify MCP status, or authenticate on B and reload.

Cleanup: stop only test backends/tunnels, remove test registrations/threads and
uploaded fixtures when no longer referenced. Restore original B config after
OAuth testing. Never stop an independently managed non-test server.

### Subscription recovery and uncertain outcomes

Prerequisites: use disposable threads on an independently authenticated server. For
fault injection use the transport fixture, never terminate a production tunnel.

1. Subscribe to three threads, then reconnect. Make the first resume silent and
   let the other two succeed. Expect the healthy threads and an unrelated
   `model/list` request to complete independently. A resume attempt has a 5 second
   deadline; four attempts, 500/1000/2000 ms backoff, three workers and a 30 second
   elapsed budget bound automatic recovery. Backoff does not occupy a worker.
2. Fail one resume once, then succeed. Expect recovering then recovered status,
   refreshed selected history, preserved composer draft and no duplicate items.
3. Fail every resume. Expect the affected thread to show failed and Retry
   subscription. Retry after fixing the fixture; expect a fresh bounded sequence.
4. Disconnect again during backoff or an unanswered resume. Expect old jobs and
   timers to be invalidated, late replies ignored, and no mutation replay.
5. Disconnect during an approval wait or immediately after `turn/start`. Expect
   distinct transport, expired approval and unknown outcome notices. Old approval
   IDs must be rejected. Refresh history explicitly; missing history must not
   clear uncertainty or automatically resend. Only newly delivered upstream
   approval requests are actionable. Check the status banner in light and dark
   themes.

Cleanup: remove only fixture/disposable threads and restore fault injection.
Two-host streaming, live approval redelivery and ambiguous submission behavior
still require the independent-server checklist above; mock transport results do
not establish those upstream behaviors.
